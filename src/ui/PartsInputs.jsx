// 数値などの入力欄の並び（詳しい診断の弱点の詳細・簡易診断の特記事項の寸法で使う）
//  parts：欄の定義（detailParts.js の PART_TYPES）、values：入れた値、onPut(名前, 値)：値が変わったとき
//  Choice：選択肢のボタンの部品（呼ぶ側の見た目に合わせる）
//  pi：周囲長から直径を出すときの円周率（設定の calc.pi）
//  required：必ず選ぶ印の名前の並び（簡易診断の寸法。detailParts.js の requiredFlags）。その印は「芯達」「芯未達」の2つのボタンで選ぶ
import { coreReached, diameterOf, horizontalOf, ratioChoice } from '../core/detailParts.js';

//  rows：1つの欄を1行に（左に短い名前、右に入力）。詳しい診断の画面用。短い名前は部品の short か、名前の「（」より前
//  noAddSize：大きさの「＋ 大きさを足す」を出さない（箇所は、詳しい診断では「別の箇所を足す」、簡易診断では寸法を足して増やすため）
export default function PartsInputs({ parts, values, onPut, testId, Choice, pi = Math.PI, required = [], rows = false, noAddSize = false }) {
  const put = onPut;
  const dk = testId;
  const num = (name, v, onChange, ph) => (
    <input type="text" inputMode="decimal" value={v ?? ''} placeholder={ph} onChange={(e) => onChange(e.target.value)} data-part={name} />
  );
  return (
    <div className={`parts${rows ? ' rows' : ''}`} data-parts={dk}>
      {parts.map((p) => {
        const v = values[p.name];
        let input;
        if (p.type === 'height' || p.type === 'pair') {
          const x = v || {};
          input = (
            <span className="pair">
              {/* 水平距離を手で入れたら、斜めの長さからの計算はやめる */}
              {num(`${p.name}.a`, x.a, (a) => put(p.name, { ...x, a, ...(p.slant ? { s: '' } : {}) }), p.type === 'height' ? '例 2' : '')}
              <span>{p.type === 'height' ? p.sep || '～' : p.sep || '/'}</span>
              {/* 直径を手で入れたら、周囲長からの計算はやめる */}
              {num(`${p.name}.b`, x.b, (b) => put(p.name, { ...x, b, c: '' }), p.type === 'height' ? '上端' : '')}
              <span>{p.unit ?? (p.type === 'height' ? 'm' : '')}</span>
            </span>
          );
          // 2つの数の比から決まる選択肢（例 周囲長比≧1/3）を示す。ratio.to があれば、その選択肢にも自動で入る
          const rc = p.ratio ? ratioChoice(x, p.ratio) : '';
          if (rc)
            input = (
              <>
                {input}
                <small className="auto" data-auto={p.name}>
                  計算では{rc}
                </small>
              </>
            );
          // 斜めの長さを入れると水平距離を計算して a に入れる（設定の slant があるとき。例 鋼棒を45度で差し込んだ長さ）
          if (p.slant)
            input = (
              <>
                {input}
                <span className="pair circ">
                  <small>{p.slant.label}</small>
                  {num(`${p.name}.s`, x.s, (s) => put(p.name, { ...x, s, a: horizontalOf(s, p.slant.angle, p.digits) }), `入れると水平距離（${p.slant.angle}°）`)}
                  <span>{p.unit ?? ''}</span>
                </span>
              </>
            );
          // 周囲長を入れると直径を計算して入れる（設定の circ があるとき）
          if (p.circ)
            input = (
              <>
                {input}
                <span className="pair circ">
                  <small>{p.circ}</small>
                  {num(`${p.name}.c`, x.c, (c) => put(p.name, { ...x, c, b: diameterOf(c, pi, p.digits) }), '入れると直径を計算')}
                  <span>{p.unit ?? ''}</span>
                </span>
              </>
            );
        } else if (p.type === 'size') {
          const list = Array.isArray(v) && v.length ? v : [{}];
          const setAt = (i, patch) => put(p.name, list.map((y, j) => (j === i ? { ...y, ...patch } : y)));
          input = (
            <span className="sizes">
              {list.map((y, i) => (
                <span className="pair" key={i}>
                  {num(`${p.name}.${i}.w`, y.w, (w) => setAt(i, { w }), '縦')}
                  <span>×</span>
                  {num(`${p.name}.${i}.h`, y.h, (h) => setAt(i, { h }), '横')}
                  {/* depthInput：奥行も入れられるが文には出さない（確認用カルテだけ） */}
                  {(p.depth || p.depthInput) && (
                    <>
                      <span>×</span>
                      {num(`${p.name}.${i}.d`, y.d, (d) => setAt(i, { d }), p.depth ? '奥行' : '奥行(確認用)')}
                    </>
                  )}
                  <span>{p.unit ?? 'cm'}</span>
                </span>
              ))}
              {!noAddSize && (
                <button type="button" className="btn" onClick={() => put(p.name, [...list, {}])} data-add-size={p.name}>
                  ＋ 大きさを足す
                </button>
              )}
            </span>
          );
        } else if (p.type === 'flag') {
          // 印（芯達など）：押すたびに付ける／外す
          const auto = p.coreFrom ? coreReached(values[p.coreFrom]) : null;
          const must = required.includes(p.name);
          input = (
            <>
              {must ? (
                // 必ず選ぶ印：付ける（true）か付けない（false）かを選ぶ。どちらも押していなければ未選択
                <span className="seg" role="group" aria-label={p.label}>
                  <button type="button" className={`seg-b${v === true ? ' on' : ''}`} aria-pressed={v === true} onClick={() => put(p.name, true)} data-part={p.name} data-v="1">
                    {p.label}
                  </button>
                  <button type="button" className={`seg-b${v === false ? ' on' : ''}`} aria-pressed={v === false} onClick={() => put(p.name, false)} data-part={p.name} data-v="0">
                    {p.offLabel || `${p.label}でない`}
                  </button>
                </span>
              ) : (
                <button type="button" className={`seg-b${v ? ' on' : ''}`} aria-pressed={!!v} onClick={() => put(p.name, !v)} data-part={p.name}>
                  {p.label}
                </button>
              )}
              {/* 自動で決めた結果（数を変えると決め直す。手で押して変えてもよい） */}
              {auto != null && (
                <small className="auto" data-auto={p.name}>
                  計算では{auto ? '芯達' : '未達'}
                </small>
              )}
            </>
          );
        } else if (p.type === 'choice') {
          input = <Choice k={`${dk}.${p.name}`} opts={p.options} value={v ?? ''} onPress={(_, o) => put(p.name, v === o ? '' : o)} />;
        } else if (p.type === 'text') {
          input = <input type="text" value={v ?? ''} onChange={(e) => put(p.name, e.target.value)} data-part={p.name} />;
        } else {
          input = (
            <span className="pair">
              {num(p.name, v, (x) => put(p.name, x))}
              <span>{p.unit ?? (p.type === 'count' ? '本' : '')}</span>
            </span>
          );
        }
        return (
          <label className="part" key={p.name}>
            <small>
              {p.type === 'flag'
                ? required.includes(p.name)
                  ? `${p.label}か（必ず選ぶ）`
                  : '\u00a0'
                : rows
                  ? p.short || String(p.label).split(/[（(]/)[0] || p.label
                  : p.label}
            </small>
            {input}
          </label>
        );
      })}
    </div>
  );
}
