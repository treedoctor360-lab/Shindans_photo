// 一覧画面の「調査日・調査者をまとめて直す」（調査者だけ）
//  設定の調査日・調査者を間違えたまま保存した木を、この公園・路線でまとめて直す。直すのは調査日・調査者だけ（redate.js）
//  「調査日＋調査者」の組を選び、直す木を選び（はじめは組の木を全部）、正しい調査日・調査者を入れる
import { useState } from 'react';
import { fixDateInspector, fixTargets, pairsOf } from '../store/redate.js';
import { toHalf } from '../core/text.js';

const slash = (d) => String(d || '').replace(/-/g, '/') || '（調査日なし）';
const pairKey = (p) => `${p.date}\u0000${p.inspector}`;

export default function RedateBox({ state, update, cfg, trees, groupName, send, toast }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(''); // 選んだ組の鍵
  const [off, setOff] = useState([]); // 組の中で外した木の id
  const [toDate, setToDate] = useState('');
  const [toInsp, setToInsp] = useState('');
  const pairs = pairsOf(state, cfg, trees);
  if (!pairs.length) return null;
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)} data-testid="redate-open">
        調査日・調査者をまとめて直す
      </button>
    );

  const pair = pairs.find((p) => pairKey(p) === sel) || null;
  const choose = (key) => {
    const p = pairs.find((x) => pairKey(x) === key);
    setSel(key);
    setOff([]);
    setToDate(p?.date || '');
    setToInsp(p?.inspector || '');
  };
  const chosen = pair ? pair.trees.filter((t) => !off.includes(t.id)) : [];
  const from = pair ? { date: pair.date, inspector: pair.inspector } : null;
  const to = {
    date: pair && toDate && toDate !== pair.date ? toDate : undefined,
    inspector: pair && toInsp.trim() && toInsp.trim() !== pair.inspector ? toInsp.trim() : undefined,
  };
  const tg = pair ? fixTargets(state, cfg, chosen, from, to) : { trees: [], initials: [], conflicts: [] };
  const iniLabel = cfg.initialSurvey?.label || '詳しい診断';
  const ready = pair && (to.date || to.inspector) && tg.trees.length + tg.initials.length > 0;
  // 調査者の候補：この公園・路線の調査者と、設定の調査者
  const names = [...new Set([...pairs.map((p) => p.inspector), state.session?.inspector].filter(Boolean))];
  const close = () => {
    setOpen(false);
    setSel('');
    setOff([]);
  };
  const onRun = () => {
    let done = null;
    update(
      (s) => {
        // 実行の時点の最新の状態から、対象を選び直して直す
        const r = fixDateInspector(s, cfg, chosen.map((t) => t.id), from, to);
        done = r;
        return r.state;
      },
      { now: true },
    ).then(() => {
      if (!done) return;
      send?.();
      const what = [to.date && `調査日 ${slash(pair.date)} → ${slash(to.date)}`, to.inspector && `調査者 ${pair.inspector || '（なし）'} → ${to.inspector}`].filter(Boolean).join('、');
      toast?.(
        `${what} に直しました（${done.trees}本` +
          (done.initials ? `・${iniLabel}${done.initials}件` : '') +
          `）` +
          (done.conflicts ? `。食い違いのある${done.conflicts}件は直していません（先にどちらを使うか選んでください）` : ''),
      );
    });
    close();
  };

  return (
    <div className="sec" data-testid="redate">
      <h2>調査日・調査者をまとめて直す（{groupName}）</h2>
      <p className="hint">
        設定の調査日・調査者を間違えたまま保存した木の、調査日・調査者だけを直します（ほかの入力は変えません。確定も外れません）。
        {cfg.initialSurvey ? `${iniLabel}の記録も、直す前の調査日・調査者が同じなら一緒に直します。` : ''}台帳で入力済みの木は直せません（台帳を直してください）。
      </p>
      <div className="row">
        <label className="lbl" htmlFor="redate-from">
          直す組
        </label>
        <select id="redate-from" value={sel} onChange={(e) => choose(e.target.value)} data-testid="redate-from">
          <option value="">選んでください</option>
          {pairs.map((p) => (
            <option key={pairKey(p)} value={pairKey(p)}>
              {slash(p.date)}・{p.inspector || '（調査者なし）'}（{p.trees.length}本）
            </option>
          ))}
        </select>
      </div>
      {pair && (
        <>
          <div className="row">
            <span className="lbl">直す木（押すと外す・戻す）</span>
            <div className="chips" data-testid="redate-trees">
              {pair.trees.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip${off.includes(t.id) ? '' : ' on'}`}
                  onClick={() => setOff((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
                  data-tree-chip={toHalf(t.treeNo)}
                >
                  {toHalf(t.treeNo) || '(番号なし)'}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <label className="lbl" htmlFor="redate-to">
              正しい調査日
            </label>
            <input id="redate-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} data-testid="redate-to" />
          </div>
          <div className="row">
            <label className="lbl" htmlFor="redate-insp">
              正しい調査者
            </label>
            <input id="redate-insp" type="text" list="redate-names" value={toInsp} onChange={(e) => setToInsp(e.target.value)} data-testid="redate-insp" />
            <datalist id="redate-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <p className="hint" data-testid="redate-preview">
            {ready
              ? `${chosen.length}本のうち、直す木：${tg.trees.length}本` + (cfg.initialSurvey ? `・${iniLabel}${tg.initials.length}件` : '')
              : '正しい調査日か調査者を、今と違う値にしてください'}
            {tg.conflicts.length ? `。食い違いのある${tg.conflicts.length}件は直せません` : ''}
          </p>
        </>
      )}
      <div className="acts">
        <button type="button" className="btn fill" disabled={!ready} onClick={onRun} data-testid="redate-run">
          直す
        </button>
        <button type="button" className="btn" onClick={close}>
          やめる
        </button>
      </div>
    </div>
  );
}
