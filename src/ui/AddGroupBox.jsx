// まとまり（公園・路線）を現地で足す（設定 addGroups があるときだけ出す）
//  台帳がなくても、名前などを入れるとその中の1本目の木が開く
//  設定 addGroups.presets があれば一覧から選べる（選ぶと名前などが入る。入れた後も直せる）
import { useState } from 'react';
import { groupKey } from '../core/groups.js';
import { addGroup } from '../store/actions.js';

export default function AddGroupBox({ state, cfg, update, toast, open: openAtStart = false }) {
  const ag = cfg.addGroups;
  const name = ag.label || 'まとまり';
  const [open, setOpen] = useState(openAtStart);
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [preset, setPreset] = useState(''); // 一覧から選んだもの（番号。'' は選んでいない）
  const presets = ag.presets || [];
  // 一覧の各行：もう足してあるまとまりなら、入力した本数を出す
  const doneOf = (p) => {
    const key = groupKey({ siteType: ag.siteType, ...p.values }, cfg);
    const ts = state.trees.filter((t) => !t.deleted && groupKey(t, cfg) === key);
    return ts.length ? ts.filter((t) => t.done).length : null;
  };
  const choose = (i) => {
    setPreset(i);
    setError('');
    setValues(i === '' ? {} : { ...presets[Number(i)].values });
  };

  const submit = () => {
    // まず今の画面の状態で確かめ（入力の不足・同じ名前）、足すのは押した時点の最新の状態に対して行う
    const now = Date.now();
    const first = preset !== '' ? presets[Number(preset)].tree || {} : {};
    const check = addGroup(state, cfg, values, now, first);
    if (check.error) return setError(check.error);
    setError('');
    update((s) => addGroup(s, cfg, values, now, first).state);
    if (check.exists) toast(`同じ名前の${name}があります。その${name}を開きました`);
    setValues({});
    setPreset('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)} data-testid="add-group-open">
        ＋ {name}を足す
      </button>
    );
  }
  return (
    <div className="sec" data-testid="add-group-box">
      <h2>{name}を足す</h2>
      {presets.length > 0 && (
        <div className="row">
          <label className="lbl" htmlFor="ag-preset">
            一覧から選ぶ
          </label>
          <select id="ag-preset" value={preset} onChange={(e) => choose(e.target.value)} data-testid="add-group-preset">
            <option value="">（選ばずに入れる）</option>
            {presets.map((p, i) => {
              const done = doneOf(p);
              return (
                <option key={i} value={String(i)}>
                  {p.label}
                  {p.count != null ? `（${p.count}本）` : ''}
                  {done != null ? ` ・入力済み${done}本` : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}
      {ag.fields.map((f) => (
        <div className="row" key={f.key}>
          <label className="lbl" htmlFor={`ag-${f.key}`}>
            {f.label}
          </label>
          <input
            type="text"
            id={`ag-${f.key}`}
            value={values[f.key] || ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            autoComplete="off"
          />
        </div>
      ))}
      {error && (
        <p className="hint" role="alert" data-testid="add-group-error">
          {error}
        </p>
      )}
      <button type="button" className="btn big" onClick={submit} data-testid="add-group-submit">
        この{name}を足して、1本目を入力する
      </button>
      {!openAtStart && (
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          やめる
        </button>
      )}
    </div>
  );
}
