// 詳しい診断の記録を、確認用カルテの形で画面に出す（見るだけ。ダウンロードしなくても確かめられる）
//  ダウンロードと同じ仕組み（exportKarte）でその1本のカルテを作り、画面の表にする（src/excel/sheetView.js）。
//  入力中の記録でも、今の入力内容で作る。図形・画像は出ない
import { useEffect, useRef, useState } from 'react';
import { exportKarte } from '../excel/karteExport.js';
import { bookView } from '../excel/sheetView.js';
import { karteRecords } from '../store/initial.js';
import { loadKarteTemplateFile } from '../store/state.js';

export default function KarteView({ state, cfg, rec, form, onClose }) {
  const [views, setViews] = useState(null); // [{ name, form, width, cols, rows }]
  const [error, setError] = useState('');
  const [notes, setNotes] = useState([]); // 収まらなかった欄など
  const [at, setAt] = useState(0); // 出しているシート
  const [zoom, setZoom] = useState(null); // null：画面の幅に合わせる
  const [fit, setFit] = useState(1);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const file = await loadKarteTemplateFile();
        if (!file) throw new Error('この端末にカルテの様式がありません。設定の「サーバーから受け取る」で受け取ってください（事務の端末では「カルテの様式」を読み込んでください）');
        const r = await exportKarte(file.buffer.slice(0), karteRecords(state, [rec], cfg), cfg);
        if (r.errors.length) throw new Error(`カルテを作れませんでした：${r.errors[0]}`);
        if (!r.buffer) throw new Error('この木の種類のカルテの様式がありません');
        const vs = await bookView(r.buffer);
        const forms = r.stats.sheets.map((s) => s.form);
        if (!alive) return;
        setViews(vs.map((v, i) => ({ ...v, form: forms[i] })));
        setAt(Math.max(0, forms.indexOf(form)));
        setNotes(r.stats.tooLong.map((x) => `${x.cell} の文が枠に収まりません`));
      } catch (e) {
        if (alive) setError(e.message || 'カルテを作れませんでした');
      }
    })();
    return () => {
      alive = false;
    };
    // 開いたときの入力内容で1回だけ作る（入力を直したら、閉じて開き直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = views?.[at];
  // 画面の幅に合わせる大きさ
  useEffect(() => {
    if (!view || !box.current) return undefined;
    const calc = () => setFit(Math.min(1.5, Math.max(0.3, (box.current.clientWidth - 16) / view.width)));
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [view]);
  const scale = zoom ?? fit;
  const step = (d) => setZoom(Math.min(3, Math.max(0.3, Math.round((scale + d) * 10) / 10)));

  return (
    <div className="kv" role="dialog" aria-label="カルテで見る" data-testid="karte-view">
      <div className="kv-bar">
        <b>カルテ（確認用）</b>
        {views && views.length > 1 && (
          <span className="kv-tabs">
            {views.map((v, i) => (
              <button key={v.name} type="button" className={`btn${i === at ? ' fill' : ''}`} onClick={() => setAt(i)} data-kv-sheet={v.name}>
                {v.name}
              </button>
            ))}
          </span>
        )}
        <span className="kv-zoom">
          <button type="button" className="btn" onClick={() => step(-0.1)} aria-label="小さく">
            －
          </button>
          <button type="button" className="btn" onClick={() => setZoom(null)} data-testid="kv-fit">
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className="btn" onClick={() => step(0.1)} aria-label="大きく">
            ＋
          </button>
        </span>
        <button type="button" className="btn" onClick={onClose} data-testid="kv-close">
          閉じる
        </button>
      </div>
      <div className="kv-body" ref={box}>
        {error && <div className="alert warn" data-testid="kv-error">{error}</div>}
        {!error && !views && <div className="hint">カルテを作っています…</div>}
        {notes.length > 0 && (
          <div className="alert warn">
            {notes.join('・')}
          </div>
        )}
        {view && (
          <div className="kv-page" style={{ zoom: scale }}>
            <table className="kv-t" style={{ width: view.width }} data-testid="kv-table">
              <colgroup>
                {view.cols.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.key} style={{ height: r.height }}>
                    {r.cells.map((c) => (
                      <td
                        key={c.key}
                        rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined}
                        colSpan={c.colSpan > 1 ? c.colSpan : undefined}
                        style={c.spill ? { ...c.style, overflow: 'visible' } : c.style}
                        data-cell={c.key}
                      >
                        {/* 右の空いたセルまではみ出して見せる（Excel と同じ） */}
                        {c.spill ? <div className="kv-spill" style={{ width: c.spill - 4 }}>{c.text}</div> : c.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">見るだけの画面です。直すときは閉じて入力画面で直し、もう一度開いてください。図形・画像は出ません。</p>
      </div>
    </div>
  );
}
