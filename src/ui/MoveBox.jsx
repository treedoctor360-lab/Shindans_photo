// 木を別の公園・路線へ移す（設定 addGroups があるとき・追加した木・調査者だけ）
//  例 ある路線だと思って入れた木が、実は別の路線だった。移す先は、今ある路線と設定の一覧（presets）から選ぶ
//  「この木だけ」か「この木から後ろの木すべて」を、移す先の最後に続き番号で並べる（番号は後で振り直せる）
import { useState } from 'react';
import { groupKey, groupKeys, groupLabel } from '../core/groups.js';
import { currentGroupTrees, moveTrees } from '../store/actions.js';

export default function MoveBox({ state, cfg, tree, update, send, toast }) {
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState('');
  const [rest, setRest] = useState(false);
  const ag = cfg.addGroups;
  const copyKeys = ['siteType', ...cfg.dbFormat.infoKeys];
  const here = groupKey(tree, cfg);
  // 移す先の候補：今ある路線（今の路線を除く）と、まだない一覧の路線
  const valuesOf = (t) => Object.fromEntries(copyKeys.map((k) => [k, t[k] ?? '']));
  const existing = groupKeys(state.trees, cfg)
    .filter((k) => k !== here && k.startsWith(`${ag.siteType}:`))
    .map((k) => ({ key: k, label: groupLabel(state.trees, k, cfg), values: valuesOf(state.trees.find((t) => !t.deleted && groupKey(t, cfg) === k) || {}) }));
  const known = new Set([here, ...existing.map((x) => x.key)]);
  const presets = (ag.presets || [])
    .map((p) => ({ values: { siteType: ag.siteType, ...p.values }, label: p.label }))
    .map((p) => ({ ...p, key: groupKey(p.values, cfg) }))
    .filter((p) => !known.has(p.key) && known.add(p.key));
  const options = [...existing, ...presets];
  const after = (() => {
    const ts = currentGroupTrees({ ...state, group: here }, cfg).filter((t) => !t.deleted);
    return ts.length - ts.findIndex((t) => t.id === tree.id);
  })();
  const go = () => {
    const d = options.find((o) => o.key === dest);
    if (!d) return;
    let res = null;
    update((cur) => {
      res = moveTrees({ ...cur, group: here }, cfg, { id: tree.id, rest, values: d.values, now: new Date().toISOString() });
      return res.error ? cur : res.state;
    }, { now: true }).then(() => {
      if (res?.error) return toast(res.error);
      toast(`${res.moved.length}本を「${d.label}」へ移しました。番号は一覧の「番号を並び順に振り直す」で整えられます`);
      send?.();
    });
    setOpen(false);
  };
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)} data-testid="move-open">
        別の{ag.label || 'まとまり'}へ移す
      </button>
    );
  return (
    <div className="alert info" data-testid="move-box">
      <span>この木を別の{ag.label || 'まとまり'}へ移します。移す先の最後に、続きの番号で並びます。</span>
      <label className="lbl" htmlFor="f-move-dest">
        移す先
      </label>
      <select id="f-move-dest" value={dest} onChange={(e) => setDest(e.target.value)} data-testid="move-dest">
        <option value="">選んでください</option>
        {existing.length > 0 && (
          <optgroup label={`入力中の${ag.label || 'まとまり'}`}>
            {existing.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
        {presets.length > 0 && (
          <optgroup label="一覧から">
            {presets.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <div className="chips" role="group" aria-label="移す木">
        <button type="button" className={`chip${!rest ? ' on' : ''}`} onClick={() => setRest(false)} data-testid="move-one">
          この木だけ
        </button>
        <button type="button" className={`chip${rest ? ' on' : ''}`} onClick={() => setRest(true)} data-testid="move-rest">
          この木から後ろすべて（{after}本）
        </button>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          やめる
        </button>
        <button type="button" className="btn fill" disabled={!dest} onClick={go} data-testid="move-apply">
          移す
        </button>
      </div>
    </div>
  );
}
