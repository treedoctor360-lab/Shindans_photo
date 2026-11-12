// 番号を並び順に振り直す（今の公園・路線。設定 numbering があるとき・調査者だけ）
//  例 1番より前に抜けていた木を「この木の前に木を追加」で入れたあと、入れた木を 1〜、元の 1 を 6 にする
//  押すと変わる番号の一覧を見せ、「振り直す」で決める。変わった入力済みの木はサーバーへ送り直す
import { useState } from 'react';
import { renumberGroup } from '../store/actions.js';
import { toHalf } from '../core/text.js';

export default function RenumberBox({ state, cfg, update, send, toast, groupName }) {
  const [plan, setPlan] = useState(null); // { changes, error }（確かめ中）
  const open = () => {
    const r = renumberGroup(state, cfg);
    if (r.error) return toast(r.error);
    if (!r.changes.length) return toast('番号はもう並び順です');
    setPlan(r);
  };
  const apply = () => {
    let res = null;
    update((cur) => {
      res = renumberGroup(cur, cfg, new Date().toISOString()); // その時点の最新の状態で振り直す
      return res.error ? cur : res.state;
    }, { now: true }).then(() => {
      if (res?.error) toast(res.error);
      else toast(`${res.changes.length}本の番号を振り直しました`);
      send?.();
    });
    setPlan(null);
  };
  const name = (c) => (c.from ? toHalf(c.from) : '番号なし');
  return (
    <div className="sec" data-testid="renumber-box">
      {!plan ? (
        <button type="button" className="btn" onClick={open} data-testid="renumber-open">
          番号を並び順に振り直す（{groupName}）
        </button>
      ) : (
        <div className="alert info" data-testid="renumber-plan">
          <span>
            {groupName}の番号を、今の並び順で振り直します（{plan.changes.length}本）。紙の地図の番号は手で直してください。入力済みの木はサーバーへ送り直し、確定していた木は確定が外れます。
          </span>
          <div className="hint" data-testid="renumber-list">
            {plan.changes.slice(0, 40).map((c) => `${name(c)}→${c.to}`).join('、')}
            {plan.changes.length > 40 ? `ほか${plan.changes.length - 40}本` : ''}
          </div>
          <div className="acts">
            <button type="button" className="btn" onClick={() => setPlan(null)}>
              やめる
            </button>
            <button type="button" className="btn fill" onClick={apply} data-testid="renumber-apply">
              振り直す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
