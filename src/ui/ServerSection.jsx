// 設定画面の「サーバー」欄：URL と合言葉、接続の確認、設定・原本・台帳の受け渡し
import { useState } from 'react';
import { idbGet } from '../store/idb.js';
import { bookCount } from '../store/initial.js';
import { applyLedger, importInitialBook, loadConfigText, readLedgerFile, saveTemplate } from '../store/state.js';
import { callServer, getFile, putFile } from '../store/sync.js';
import { getPreviousIndex, getPreviousPhotos, loadIndex, putPrevious } from '../store/previous.js';
import { todayYmd } from './SettingsView.jsx';

export default function ServerSection({ state, update, config, setConfig, toast }) {
  const [busy, setBusy] = useState('');
  const [askPut, setAskPut] = useState(false); // 「サーバーに置く」の確かめ中か
  const sv = state.server || {};
  const setServer = (k, v) => update((s) => ({ ...s, server: { ...s.server, [k]: v.trim() } }));
  const user = state.user || { role: 'surveyor', name: '' };
  const setUser = (k, v) => update((s) => ({ ...s, user: { ...s.user, [k]: v } }));

  const run = async (name, fn) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(e.message || `${name}できませんでした`);
    } finally {
      setBusy('');
    }
  };

  const onPing = () =>
    run('接続の確認', async () => {
      await callServer(sv, { action: 'ping' });
      toast('サーバーにつながりました');
    });

  // この端末の設定・原本・台帳を、サーバーに置く（事務所の PC から）
  const onPut = () =>
    run('サーバーに置く', async () => {
      if (!config) throw new Error('先に設定ファイルを読み込んでください');
      const enc = new TextEncoder();
      await putFile(sv, 'config', 'config.json', enc.encode(JSON.stringify(config)).buffer);
      const tpl = await idbGet('template');
      if (tpl) await putFile(sv, 'template', tpl.name, tpl.buffer);
      const ledger = await idbGet('ledger');
      if (ledger) await putFile(sv, 'ledger', ledger.name, ledger.buffer);
      const book = config.initialSurvey ? await idbGet('initialBook') : null;
      if (book) await putFile(sv, 'initialBook', book.name, book.buffer);
      // 前回の調査（要点と、場所ごとの写真）
      const nPrev = await putPrevious(sv, (d, n) => setBusy(`サーバーに置く ${d}/${n}`));
      toast(`サーバーに置きました（設定${tpl ? '・原本' : ''}${ledger ? '・台帳' : ''}${book ? '・データ入力用ブック' : ''}${nPrev ? `・前回の調査${nPrev}本` : ''}）`);
    });

  // サーバーから設定・原本・台帳を受け取る（スマホで）
  const onGet = () =>
    run('サーバーから受け取る', async () => {
      const got = [];
      let cfg = config;
      const c = await getFile(sv, 'config');
      if (c) {
        const r = await loadConfigText(new TextDecoder().decode(c.buffer), config);
        if (r.errors.length) throw new Error(`サーバーの設定ファイルに誤りがあります：${r.errors[0]}`);
        cfg = r.config;
        setConfig(cfg);
        got.push('設定');
      }
      const tpl = await getFile(sv, 'template');
      if (tpl) {
        await saveTemplate(tpl.name, tpl.buffer);
        await update((s) => ({ ...s, templateName: tpl.name }), { now: true });
        got.push('原本');
      }
      const ledger = await getFile(sv, 'ledger');
      if (ledger && cfg) {
        // 読み終わってから、その時点の最新の状態に入れる（読んでいる間に届いた変更を上書きしないように）
        const parsed = await readLedgerFile(ledger.name, ledger.buffer, cfg, todayYmd());
        let r;
        await update((s) => {
          r = applyLedger(s, parsed, cfg);
          return r.state;
        }, { now: true });
        got.push(`台帳（${r.stats.all}本）`);
      }
      if (cfg?.initialSurvey) {
        const book = await getFile(sv, 'initialBook');
        if (book) {
          const r = await importInitialBook(state, book.name, book.buffer, cfg, todayYmd());
          await update((s) => ({ ...s, initialBookInfo: r.state.initialBookInfo }), { now: true });
          got.push(`データ入力用ブック（入力済み${bookCount(r.state.initialBookInfo)}本）`);
        }
      }
      const nPrev = await getPreviousIndex(sv);
      if (nPrev) got.push(`前回の調査（${nPrev}本）`);
      toast(got.length ? `受け取りました：${got.join('・')}` : 'サーバーにはまだ何も置かれていません');
    });

  // 前回の写真を、全部の場所の分まとめて端末に入れる（Wi-Fi のある所で）
  const onGetPhotos = () =>
    run('前回の写真', async () => {
      const index = await loadIndex();
      const ids = Object.keys(index?.packs || {});
      if (!ids.length) throw new Error('前回の調査がまだありません。先に「サーバーから受け取る」を押してください');
      for (let i = 0; i < ids.length; i++) {
        setBusy(`前回の写真 ${i + 1}/${ids.length}`);
        await getPreviousPhotos(sv, ids[i]);
      }
      toast(`前回の写真を端末に入れました（${ids.length}か所）`);
    });

  const ready = !!(sv.url && sv.pass);
  // サーバーに置くのは事務の端末だけ（調査者の端末から古い台帳などを置いて、全員の台帳が入れ替わる事故を防ぐ）
  const office = user.role === 'office';
  const putList = [
    config && `設定ファイル（${config.job?.title || ''} 版${config.version}）`,
    state.ledgerInfo && `台帳「${state.ledgerInfo.name}」（${state.ledgerInfo.date} に読み込み）`,
    config?.initialSurvey && state.initialBookInfo && `データ入力用ブック「${state.initialBookInfo.name}」（${state.initialBookInfo.date} に読み込み）`,
    '野帳の原本・前回の調査（この端末に読み込んであれば）',
  ].filter(Boolean);
  return (
    <div className="sec">
      <h2>サーバー</h2>
      <div className="row">
        <div className="lbl">この端末を使う人</div>
        <div className="chips" role="radiogroup">
          {[
            ['surveyor', '調査者'],
            ['office', '事務'],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={user.role === v}
              className={`chip${user.role === v ? ' on' : ''}`}
              onClick={() => setUser('role', v)}
              data-testid={`role-${v}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <label className="lbl" htmlFor="s-user">
          名前 <small>付箋や確定に「誰が」として残ります</small>
        </label>
        <input type="text" id="s-user" autoComplete="off" value={user.name || ''} onChange={(e) => setUser('name', e.target.value)} />
      </div>
      <div className="row">
        <label className="lbl" htmlFor="s-url">
          URL <small>サーバーの公開時に表示されるもの（https://script.google.com/…/exec）</small>
        </label>
        <input type="text" id="s-url" inputMode="url" autoComplete="off" value={sv.url || ''} onChange={(e) => setServer('url', e.target.value)} />
      </div>
      <div className="row">
        <label className="lbl" htmlFor="s-pass">
          合言葉
        </label>
        <input type="password" id="s-pass" autoComplete="off" value={sv.pass || ''} onChange={(e) => setServer('pass', e.target.value)} />
      </div>
      <p className="hint">URL と合言葉は、この端末の中にだけ保存します。</p>
      <button type="button" className="btn" disabled={!ready || !!busy} onClick={onPing}>
        {busy === '接続の確認' ? '確認中…' : '接続を確認する'}
      </button>
      <button type="button" className="btn big" disabled={!ready || !!busy} onClick={onGet} data-testid="server-get">
        {busy === 'サーバーから受け取る' ? '受け取り中…' : 'サーバーから設定・原本・台帳・前回の調査を受け取る'}
      </button>
      {office &&
        (askPut ? (
          <div className="alert danger" data-testid="server-put-ask">
            <span>
              サーバーにある次のファイルを、この端末のもので置き換えます。この後に「受け取る」を押したすべての端末が、これを使います（入力した内容は消えません。前のファイルはサーバーのごみ箱に30日残ります）。
              {putList.map((t) => (
                <span key={t}>
                  <br />・{t}
                </span>
              ))}
            </span>
            <div className="acts">
              <button
                type="button"
                className="btn fill"
                onClick={() => {
                  setAskPut(false);
                  onPut();
                }}
                data-testid="server-put-ok"
              >
                置き換える
              </button>
              <button type="button" className="btn" onClick={() => setAskPut(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn big" disabled={!ready || !!busy || !config} onClick={() => setAskPut(true)} data-testid="server-put">
            {busy.startsWith('サーバーに置く') ? `送信中…${busy.slice(8)}` : 'この端末の設定・原本・台帳・前回の調査をサーバーに置く'}
          </button>
        ))}
      {!office && <p className="hint" data-testid="server-put-office-only">設定・台帳などをサーバーに置くのは、事務の端末だけです。</p>}
      <button type="button" className="btn" disabled={!ready || !!busy} onClick={onGetPhotos} data-testid="prev-get-all">
        {busy.startsWith('前回の写真') ? `受け取り中…${busy.slice(5)}` : '前回の写真をすべて端末に入れる（Wi-Fi のある所で）'}
      </button>
      <p className="hint">
        事務所の PC で設定・原本・台帳を読み込み、「サーバーに置く」を押します。スマホでは「サーバーから受け取る」を押すだけで、同じものが使えます。台帳を置き直したら、スマホでもう一度受け取ってください（アプリで入力した内容は消えません）。
      </p>
    </div>
  );
}
