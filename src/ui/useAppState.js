// 画面全体で使う状態の入れ物（React のフック：画面の部品から状態を読み書きする仕組み）
//
// 状態を変えたら、すぐに端末内（IndexedDB）にも保存する。
// 保存に失敗したら saveError に入れて、画面で知らせる（入力が消えたことに気付けるように）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { initialState, loadAll, saveState } from '../store/state.js';
import { applyPull, applyPush, pull, push, rejectedMessage, unsentCount } from '../store/sync.js';
import { recoverPhotos, requestPersist, syncPhotos } from '../store/photos.js';

export function useAppState() {
  const [state, setState] = useState(initialState);
  const [config, setConfig] = useState(null);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState('');
  const latest = useRef(state);

  // 起動時に端末から読み込む
  useEffect(() => {
    loadAll()
      .then(({ state: s, config: c }) => {
        latest.current = s;
        setState(s);
        setConfig(c);
      })
      .catch((e) => setSaveError(`端末の保存領域を開けませんでした：${e.message}`))
      .finally(() => setReady(true));
  }, []);

  // 端末への保存。文字を打つたびに全部を書くと重いので、最後の変更から 300ミリ秒後にまとめて保存する。
  // 画面を閉じる・裏に回すときは、待たずにすぐ保存する。
  const timer = useRef(null);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    try {
      await saveState(latest.current);
      setSaveError('');
    } catch (e) {
      setSaveError(`端末に保存できませんでした：${e.message}`);
    }
  }, []);
  useEffect(() => {
    const now = () => timer.current && flush();
    const onHide = () => document.visibilityState === 'hidden' && now();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', now);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', now);
    };
  }, [flush]);

  // 状態を変える。fn は「今の状態 → 新しい状態」を返す関数
  //  { now: true } を付けると、待たずにすぐ保存する（「保存」ボタンなど大事な操作）
  const update = useCallback(
    (fn, { now = false } = {}) => {
      const next = fn(latest.current);
      latest.current = next;
      setState(next);
      clearTimeout(timer.current);
      if (now) return flush();
      timer.current = setTimeout(flush, 300);
      return Promise.resolve();
    },
    [flush],
  );

  // ---------- サーバーとのやり取り（送信と受信） ----------
  // 端末に保存してから送る。失敗しても入力は端末に残り、次の機会（保存のたび・電波が戻ったとき・起動時）に送り直す。
  // 送ったあとは、他の端末で変わった記録（事務の付箋・修正など）を受け取る。
  const configRef = useRef(config);
  configRef.current = config;
  const syncing = useRef(false);
  const again = useRef(false); // やり取りの最中に頼まれたら、終わってからもう一度行う
  const [sendStatus, setSendStatus] = useState({ busy: false, error: '', last: null });
  // 写真の送受信の結果（入力内容の送受信とは別に知らせる。写真で失敗しても入力内容の送受信は済んでいる）
  const [photoStatus, setPhotoStatus] = useState({ busy: false, error: '', sent: 0 });
  const getState = useCallback(() => latest.current, []);
  const send = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || !latest.current.server?.url) return null;
    if (syncing.current) {
      again.current = true;
      return null;
    }
    syncing.current = true;
    setSendStatus((x) => ({ ...x, busy: true, error: '' }));
    try {
      await flush(); // 先に端末へ保存
      let saved = 0;
      let conflicts = [];
      let rejected = [];
      if (unsentCount(latest.current)) {
        const r = await push(latest.current, cfg);
        let applied;
        await update((cur) => {
          applied = applyPush(cur, r.results, r.tokens, cfg);
          return { ...applied.state, server: { ...applied.state.server, lastSent: new Date().toISOString() } };
        }, { now: true });
        saved = applied.saved;
        conflicts = applied.conflicts;
        rejected = applied.rejected || [];
      }
      const p = await pull(latest.current, cfg);
      let got;
      await update((cur) => {
        got = applyPull(cur, p.records, p.lastSeq, cfg);
        return { ...got.state, server: { ...got.state.server, lastFetched: new Date().toISOString() } };
      }, { now: true });
      const last = { saved, conflicts: [...conflicts, ...got.conflicts], changedTrees: got.changedTrees, newStickies: got.newStickies };
      // サーバーに断られた記録があれば、どれが・なぜかを知らせる（その記録は未送信のまま残る）
      setSendStatus({ busy: false, error: rejectedMessage(rejected), last });
      // 写真は入力内容の後に送る（写真の失敗が、入力内容の送受信を止めないように）
      setPhotoStatus((x) => ({ ...x, busy: true }));
      try {
        const ph = await syncPhotos({ getState, update, cfg });
        setPhotoStatus({ busy: false, error: '', sent: ph.sent });
      } catch (e) {
        setPhotoStatus({ busy: false, error: e.message || '写真を送れませんでした', sent: 0 });
      }
      return last;
    } catch (e) {
      setSendStatus((x) => ({ ...x, busy: false, error: e.message || '送信できませんでした' }));
      return null;
    } finally {
      syncing.current = false;
      if (again.current) {
        again.current = false;
        setTimeout(() => sendRef.current?.(), 0);
      }
    }
  }, [flush, update, getState]);
  const sendRef = useRef(null);
  sendRef.current = send;

  // 起動時・電波が戻ったとき・画面に戻ってきたときにやり取りする
  // 起動時：写真の記録の救い（写真を置いたのに記録が保存できなかったもの）と、データを勝手に消さないようにする申し出
  const [persisted, setPersisted] = useState(null);
  useEffect(() => {
    if (!ready) return;
    recoverPhotos({ getState, update }).catch(() => 0);
    requestPersist().then(setPersisted);
  }, [ready, getState, update]);

  useEffect(() => {
    if (!ready) return undefined;
    send();
    const onOnline = () => send();
    // 画面に戻ってきたとき（別のアプリから切り替えたときなど）にも受け取る。事務の返事・付箋に早く気付けるように
    const onShow = () => document.visibilityState === 'visible' && send();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [ready, send]);

  return { state, update, config, setConfig, ready, saveError, send, sendStatus, photoStatus, getState, persisted };
}
