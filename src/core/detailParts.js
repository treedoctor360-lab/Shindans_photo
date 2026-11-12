// 弱点の「詳細」の文を、数字などの部品から組み立てる
//
// 現場では本数・高さ・大きさなどを部品ごとに入れ、アプリがブックの書き方の文にする。
//   例：本数 1、高さ 2、枝直径 18、枝長 4 → 「1本、地上2m、枝直径18cm、枝長4m」
// 部品の種類と書き方は設定（initialSurvey.detailParts）に置く。項目ごとに使う部品は、
// 項目の parts（部品の名前の並び）か、なければ initialSurvey.detailPartsDefault。
// 組み立てた文は手で直せる。手で直した後は、部品を変えても文を上書きしない（「部品から作り直す」で戻せる）。
//
// 部品の種類（type）と、入れる値の形・文の形：
//   count  … 数 '1'                         → 「1本」（unit 省略時「本」）
//   height … { a: '0', b: '0.7' }（b は省略可）→ 「地上0～0.7m」（prefix 省略時「地上」、unit 省略時「m」、sep 省略時「～」）
//   size   … [{ w: '20', h: '40' }, …]       → 「20×40cm、7×7cm（2箇所）」（unit 省略時「cm」。places を付けると2つ以上のとき箇所の数）
//              depth: true で奥行も（{ w, h, d }）。unitEach: true で数ごとに単位（「20cm×50cm×15cm」）
//              depthInput: true なら奥行も入れられるが、文には出さない（確認用カルテにだけ【奥行15cm】と足す）
//   number … '18'                            → prefix＋値＋unit（例「枝直径18cm」）
//   choice … '＜1/3'（options から選ぶ）       → prefix＋値（例「周囲長比＜1/3」）
//   text   … '（種名など）'                    → そのまま
//   pair   … { a: '35', b: '100' }            → 「35cm/100cm」（unit・sep 省略時「/」。片方だけなら「35cm/」）
//   flag   … true（押してあるか）               → text（例「（芯達）」）。「、」でつながず、前の文のすぐ後ろに付ける
//              attach: false なら、ほかの部品と同じく「、」でつなぐ（例「長さ1.5m、芯達」）
//              required：簡易診断の寸法を入れるとき、付けるか付けないか（offLabel。例「芯未達」）を必ず選ぶ。
//                true（いつも）か、部位の並び（例 ["幹", "根株"]。その部位のときだけ）。付けないを選ぶと false を入れる（文には出さない）
//   どの種類も noText: true なら文に出さず、確認用カルテにだけ【】で足す（高さ・大きさ・数は checkPrefix を前に付ける。例「子実体 地上1.5m」）
//   どの種類も whole: true なら「項目全体で1つ」の部品（例 子実体の種名）。箇所が2つ以上あっても最後に1回だけ書く
//
// 箇所が2つ以上あるとき（例 幹の腐朽が3か所）：1か所目は今までどおり部品の値に、2か所目からは more（[{…}, …]）に入れる。
//   文は「①地上1m、20×50cm ②地上2m、10×30cm、（項目全体の部品）」のように箇所ごとに①②…を付けて並べる

import { toHalf } from './text.js';

export const PART_TYPES = ['count', 'height', 'size', 'number', 'choice', 'text', 'pair', 'flag'];

// 部品の値を入れておく項目の名前（例 b4DetailParts）と、手で直したかの印の名前
export const partsKeyOf = (detailKey) => `${detailKey}Parts`;
export const manualKeyOf = (detailKey) => `${detailKey}Manual`;
// 弱点の項目の、詳細を入れる項目の名前（initial.js の detailKeyOf と同じ）
export const detailKeyOfItem = (item) => item.detailKey || `${item.key}Detail`;

const clean = (v) => toHalf(String(v ?? '')).trim();

// 項目で使う部品（設定の部品の定義に名前を付けたもの）。部品がなければ空
export function partsOf(item, cfg) {
  const defs = cfg.initialSurvey?.detailParts || {};
  const names = item.parts || cfg.initialSurvey?.detailPartsDefault || [];
  return names.filter((n) => defs[n]).map((n) => ({ name: n, ...defs[n] }));
}

// 部品1つの文（値がなければ空）。noText の部品は計算だけに使い、文には出さない
//  fixed：数を小数点以下この桁で出す（height・number・pair。例 1 で「1.7」「0.0」。入れた値そのものは変えない）
export function partText(part, v) {
  if (part.noText) return '';
  const unit = (d) => (part.unit != null ? part.unit : d);
  const fx = (x) => (part.fixed != null && x !== '' && Number.isFinite(Number(x)) ? Number(x).toFixed(part.fixed) : x);
  switch (part.type) {
    case 'count':
      return clean(v) ? `${clean(v)}${unit('本')}` : '';
    case 'height': {
      const a = fx(clean(v?.a));
      const b = fx(clean(v?.b));
      if (!a && !b) return '';
      const pre = part.prefix != null ? part.prefix : '地上';
      return a && b ? `${pre}${a}${part.sep || '～'}${b}${unit('m')}` : `${pre}${a || b}${unit('m')}`;
    }
    case 'size': {
      const u = unit('cm');
      const list = (Array.isArray(v) ? v : [])
        .map((x) => [clean(x?.w), clean(x?.h), part.depth ? clean(x?.d) : ''].filter(Boolean))
        .filter((x) => x.length)
        .map((x) => (part.unitEach ? x.map((n) => n + u).join('×') : `${x.join('×')}${u}`));
      if (!list.length) return '';
      return list.join('、') + (part.places && list.length > 1 ? `（${list.length}${part.places}）` : '');
    }
    case 'number':
      return clean(v) ? `${part.prefix || ''}${fx(clean(v))}${unit('')}` : '';
    case 'choice':
      return clean(v) ? `${part.prefix || ''}${clean(v)}` : '';
    case 'text':
      return String(v ?? '').trim();
    case 'flag':
      // offText：付けない（false）を選んだときの文（例「（芯未達）」）。選んでいない（undefined）なら何も出さない
      return v ? part.text || '' : v === false && part.offText ? part.offText : '';
    case 'pair': {
      const a = fx(clean(v?.a));
      const b = fx(clean(v?.b));
      if (!a && !b) return '';
      // 片方が空なら、その側は単位も出さない（「2cm/cm」にしない。例「2cm/」「/50cm」）
      return `${a ? a + unit('') : ''}${part.sep || '/'}${b ? b + unit('') : ''}`;
    }
    default:
      return '';
  }
}

// 部品の値から文を作る（部品の並び順に、つなぎの文字でつなぐ。印（flag）は前の文のすぐ後ろに付ける。
//  glue: true の部品は、次の文をつなぎの文字なしですぐ後ろに付ける（例「（大）H1.5m」））
export function buildText(values, parts, join = '、') {
  let out = '';
  let glued = false; // 前の部品が glue（後ろの文につなぎの文字なしでつなぐ）
  for (const p of parts) {
    const t = partText(p, values?.[p.name]);
    if (!t) continue;
    const attach = p.type === 'flag' && p.attach !== false;
    out += out && !attach && !glued ? join + t : t;
    glued = p.glue === true;
  }
  return out;
}

// ---------- 箇所が2つ以上のとき ----------
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circled = (i) => CIRCLED[i] || `(${i + 1})`;

// 箇所ごとの値の並び（1か所目＋more）。1か所目からは more を除く
export function entriesOf(values) {
  const { more, ...first } = values || {};
  return [first, ...(Array.isArray(more) ? more : [])];
}

// 箇所ごとの値の並びから、部品の値（1か所目＋more）に戻す。項目全体の部品（whole）は1か所目に残す
export function fromEntries(entries) {
  const [first = {}, ...rest] = entries;
  return rest.length ? { ...first, more: rest } : { ...first };
}

// 部品の値から、詳細の文を作る（箇所が2つ以上なら①②…で並べ、項目全体の部品は最後に1回）
export function buildDetail(values, parts, cfg) {
  const join = cfg.initialSurvey?.detailJoin ?? '、';
  const es = entriesOf(values);
  if (es.length < 2) return buildText(values, parts, join);
  const each = parts.filter((p) => !p.whole);
  const whole = parts.filter((p) => p.whole);
  const body = es
    .map((e) => buildText(e, each, join))
    .map((t, i) => (t ? circled(i) + t : ''))
    .filter(Boolean)
    .join(' ');
  const tail = buildText(es[0], whole, join);
  return [body, tail].filter(Boolean).join(join);
}

// ---------- 自動で決まる値 ----------
//  pair の circ：「周囲長」の欄を出し、入れると b（直径）を 周囲長÷円周率 で入れる（b を手で入れてもよい。digits：小数点以下の桁、既定は整数）
//  pair の slant：{ label, angle }「斜めの長さ」の欄を出し、入れると a（水平距離）を 長さ×cos(angle) で入れる（a を手で入れてもよい）
//  flag の coreFrom：pair の名前。その a（例 貫入深）が b（例 直径）の半分（半径）以上なら印を付け、未満なら外す
//                     pair を変えたときに決め直す。その後で印を手で付け外ししてもよい

const numOf = (v) => {
  const s = clean(v);
  return s !== '' && !Number.isNaN(Number(s)) ? Number(s) : null;
};

// 周囲長から直径（digits：小数点以下の桁。既定は整数）
export function diameterOf(circ, pi = Math.PI, digits = 0) {
  const c = numOf(circ);
  if (c == null || c <= 0) return '';
  const k = 10 ** digits;
  return String(Math.round((c / pi) * k) / k);
}

// 斜めに測った長さから水平距離（angle：水平からの角度（度）。digits：小数点以下の桁。既定は整数）
//  例 鋼棒を45度で差し込んだ長さ 30 → 水平距離 21
export function horizontalOf(len, angle, digits = 0) {
  const l = numOf(len);
  if (l == null || l <= 0 || !(angle > 0 && angle < 90)) return '';
  const k = 10 ** digits;
  return String(Math.round(l * Math.cos((angle * Math.PI) / 180) * k) / k);
}

// 芯達か（a が b の半分以上）。数がそろっていなければ null
export function coreReached(pair) {
  const a = numOf(pair?.a);
  const b = numOf(pair?.b);
  if (a == null || b == null || b <= 0) return null;
  return a * 2 >= b;
}

// 2つの数（a/b）の比を選択肢にする。比が num/den 以上なら ge、未満なら lt。数がそろっていなければ ''
//  例 周囲長比：腐朽部分の周囲長 / 腐朽部位の幹周 が 1/3 以上か
export function ratioChoice(pair, r) {
  const a = numOf(pair?.a);
  const b = numOf(pair?.b);
  if (a == null || b == null || !(a > 0 && b > 0)) return '';
  return a * r.den >= b * r.num ? r.ge : r.lt;
}

// 簡易診断の寸法で、必ず選ぶ印（flag の required）の名前。place：寸法の部位
export function requiredFlags(parts, place) {
  return parts.filter((p) => p.type === 'flag' && (p.required === true || (Array.isArray(p.required) && p.required.includes(place)))).map((p) => p.name);
}

// まだ選んでいない、必ず選ぶ印の欄（ラベルの並び）。空なら選び終わっている
export function unchosenFlags(values, parts, place) {
  const names = new Set(requiredFlags(parts, place));
  return parts.filter((p) => names.has(p.name) && typeof values?.[p.name] !== 'boolean').map((p) => p.label);
}

// 詳しい診断で、必ず選ぶ印（required: true）を選んでいない箇所（0始まりの番号の並び）
//  部品の standalone: true の欄（例 子実体の種名）が入っていて、比を出す数（pair）も選択肢（choice）も入っていない箇所
//  （例 子実体だけの箇所）は聞かない
export function unchosenEntries(values, parts) {
  const must = parts.filter((p) => p.type === 'flag' && p.required === true);
  if (!must.length || values == null) return [];
  const filled = (v) => v != null && v !== '' && !(typeof v === 'object' && !Object.values(v).some((x) => String(x ?? '').trim() !== ''));
  const out = [];
  entriesOf(values).forEach((e, i) => {
    const hasAny = parts.some((p) => !p.whole && p.type !== 'flag' && filled(e[p.name]));
    if (!hasAny && !must.some((p) => typeof e[p.name] === 'boolean')) return; // 何も入れていない箇所
    const alone = parts.some((p) => p.standalone && filled(e[p.name])) && !parts.some((p) => ['pair', 'choice'].includes(p.type) && filled(e[p.name]));
    if (alone) return;
    if (must.some((p) => typeof e[p.name] !== 'boolean')) out.push(i);
  });
  return out;
}

// 弱点の項目の有無（選択肢）を、詳細の数値から決める（項目の valueFrom。例 開口空洞の「有（芯到達・周囲≧1/3）」）
//  valueFrom：{ ratio: 比を出す pair の名前, core: 芯達の印（flag）の名前, values: { lt, ge, coreLt, coreGe } }
//         か { choice: 選択肢の部品の名前, values: { 部品の選択肢: 有無の選択肢 } }（例 打診音異常の「(大)」→「有（大）」）
//           箇所が2つ以上なら、values の先に書いたもの（重い方）を使う
//  比が出せない・選択肢を選んでいなければ ''（決めない）
export function itemValueOf(item, values, cfg) {
  const vf = item?.valueFrom;
  if (!vf) return '';
  const es = entriesOf(values);
  if (vf.choice) {
    const got = es.map((e) => vf.values[clean(e?.[vf.choice])]).filter(Boolean);
    return Object.values(vf.values).find((v) => got.includes(v)) || '';
  }
  if (es.length > 1) {
    // 箇所が2つ以上なら、いちばん重いもの（芯到達・周囲≧1/3 → 芯到達・周囲＜1/3 → 周囲≧1/3 → 周囲＜1/3）
    const order = [vf.values.coreGe, vf.values.coreLt, vf.values.ge, vf.values.lt];
    const got = es.map((e) => itemValueOf(item, e, cfg)).filter(Boolean);
    return order.find((v) => got.includes(v)) || '';
  }
  const pair = (cfg.initialSurvey?.detailParts || {})[vf.ratio];
  const r = pair?.ratio ? ratioChoice(values?.[vf.ratio], pair.ratio) : '';
  if (!r) return '';
  const ge = r === pair.ratio.ge;
  return values?.[vf.core] === true ? (ge ? vf.values.coreGe : vf.values.coreLt) : ge ? vf.values.ge : vf.values.lt;
}

// 部品を1つ変えたあとの値（自動で決まる印・選択肢を決め直す）
//  flag の coreFrom：芯達の印。pair の ratio.to：比から選んだ選択肢を、その choice の部品に入れる
export function withAuto(values, parts, changed) {
  const next = { ...values };
  const ch = parts.find((p) => p.name === changed);
  if (ch?.type === 'pair' && ch.ratio?.to) {
    const r = ratioChoice(next[changed], ch.ratio);
    if (r) next[ch.ratio.to] = r;
  }
  for (const p of parts) {
    if (p.type !== 'flag' || !p.coreFrom || p.coreFrom !== changed) continue;
    const r = coreReached(next[p.coreFrom]);
    if (r != null) next[p.name] = r;
  }
  return next;
}

// 確認用に出す、入力した数（文に出さない欄の数・直径を出すのに入れた周囲長・文に出さない奥行）。返す形：[文…]
//  例 ["110cm/2.1m", "貫入部の周囲長141cm", "奥行10cm"]。提出用の文には入れない（確認用カルテにだけ足す）
//  奥行：簡易診断の寸法で入れた奥行が、奥行を出さない大きさの欄（depth のない size）に写ったとき
//  言葉：文に出さない text の欄（noText。例 簡易診断の寸法の備考）
export function checkNumbers(values, parts) {
  const es = entriesOf(values);
  if (es.length > 1)
    return es.flatMap((e, i) =>
      checkNumbers(
        e,
        parts.filter((p) => i === 0 || !p.whole),
      ).map((t) => circled(i) + t),
    );
  const out = [];
  for (const p of parts) {
    const v = values?.[p.name];
    // 文に出さない高さ・大きさ・数（例 子実体の発生高さ・範囲）：checkPrefix を付けて、文にしたときの形で
    if (p.noText && ['height', 'size', 'number', 'count'].includes(p.type)) {
      const t = partText({ ...p, noText: false }, v);
      if (t) out.push(`${p.checkPrefix || ''}${t}`);
      continue;
    }
    // 文に出さない言葉（例 簡易診断の寸法の備考）：prefix を付けてそのまま
    if (p.type === 'text' && p.noText) {
      const t = String(v ?? '').trim();
      if (t) out.push(`${p.prefix || ''}${t}`);
      continue;
    }
    if (p.type === 'size' && !p.depth && Array.isArray(v)) {
      const ds = v.map((x) => clean(x?.d)).filter(Boolean);
      if (ds.length) out.push(`奥行${ds.join('・')}${p.unit ?? 'cm'}`);
      continue;
    }
    if (p.type !== 'pair' || !v) continue;
    if (p.noText) {
      const t = partText({ ...p, noText: false }, v);
      if (t) out.push(t);
    }
    const c = clean(v.c);
    if (p.circ && c) out.push(`${p.circ}${c}${p.unit ?? ''}`);
    const s = clean(v.s);
    if (p.slant && s) out.push(`${p.slant.label}${s}${p.unit ?? ''}`);
  }
  return out;
}

// 部品を1つ変えた記録を返す。手で直していなければ、詳細の文も作り直す
export function setPart(record, item, detailKey, name, value, cfg, at = 0) {
  const pk = partsKeyOf(detailKey);
  const es = entriesOf(record[pk]);
  while (es.length <= at) es.push({});
  es[at] = withAuto({ ...es[at], [name]: value }, partsOf(item, cfg), name);
  return withParts(record, item, detailKey, fromEntries(es), cfg);
}

// 箇所を1つ足す（空の箇所を最後に）・消す（at：0始まり。1か所目を消すと2か所目が1か所目になる。項目全体の部品は残す）
export function addEntry(record, item, detailKey, cfg) {
  const es = entriesOf(record[partsKeyOf(detailKey)]);
  return withParts(record, item, detailKey, fromEntries([...es, {}]), cfg);
}
export function removeEntry(record, item, detailKey, at, cfg) {
  const es = entriesOf(record[partsKeyOf(detailKey)]);
  if (es.length < 2) return record;
  const wholeNames = partsOf(item, cfg).filter((p) => p.whole).map((p) => p.name);
  const keep = Object.fromEntries(wholeNames.filter((n) => es[0][n] !== undefined).map((n) => [n, es[0][n]]));
  const rest = es.filter((_, i) => i !== at);
  rest[0] = { ...rest[0], ...keep };
  return withParts(record, item, detailKey, fromEntries(rest), cfg);
}

// 部品の値を入れ替えた記録（有無の選択肢・詳細の文も決め直す）
function withParts(record, item, detailKey, values, cfg) {
  const pk = partsKeyOf(detailKey);
  const next = { ...record, [pk]: values };
  // 有無の選択肢を数値から決める項目（valueFrom）なら、決まったときに入れる
  const iv = itemValueOf(item, values, cfg);
  if (iv) next[item.key] = iv;
  // 数値をまだ使っていないのに詳細の文がある（数値の欄ができる前に手で書いた・ブックから写した）なら、その文を消さない
  const handWritten = !record[pk] && String(record[detailKey] ?? '').trim() !== '';
  if (handWritten) next[manualKeyOf(detailKey)] = true;
  else if (!record[manualKeyOf(detailKey)]) next[detailKey] = buildDetail(values, partsOf(item, cfg), cfg);
  return next;
}

// 詳細の文を手で直した記録を返す（部品を変えても上書きしない印を付ける）
export function setDetailText(record, detailKey, text) {
  return { ...record, [detailKey]: text, [manualKeyOf(detailKey)]: true };
}

// 部品から作り直した記録を返す（手で直した印を外す）
export function rebuildDetail(record, item, detailKey, cfg) {
  const next = { ...record, [detailKey]: buildDetail(record[partsKeyOf(detailKey)], partsOf(item, cfg), cfg) };
  delete next[manualKeyOf(detailKey)];
  return next;
}

// 部品の定義の一覧 { 名前: { type, label, … } } を確かめる（ほかの設定からも使う）。形が正しければ true
export function validatePartDefs(defs, at0, need) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!need(isObj(defs), `${at0} の形が違います`)) return false;
  for (const [name, p] of Object.entries(defs)) {
    const at = `${at0}.${name}`;
    if (!need(isObj(p) && PART_TYPES.includes(p.type) && typeof p.label === 'string' && p.label, `${at} は { type（${PART_TYPES.join('・')}）, label } の形にしてください`)) continue;
    if (p.type === 'choice') need(Array.isArray(p.options) && p.options.length > 0 && p.options.every((o) => typeof o === 'string'), `${at}：choice には options が必要です`);
    if (p.type === 'flag') need(typeof p.text === 'string' && p.text.length > 0, `${at}：flag には text（押したときに付ける文字）が必要です`);
    if (p.required != null)
      need(p.type === 'flag' && (p.required === true || (Array.isArray(p.required) && p.required.every((x) => typeof x === 'string'))), `${at}.required は flag に付け、true か部位の並びにしてください`);
    need(p.whole == null || typeof p.whole === 'boolean', `${at}.whole は true か false にしてください`);
    need(p.standalone == null || typeof p.standalone === 'boolean', `${at}.standalone は true か false にしてください`);
    for (const k of ['prefix', 'unit', 'sep', 'places', 'text', 'circ', 'coreFrom', 'offLabel', 'offText', 'checkPrefix', 'short']) need(p[k] == null || typeof p[k] === 'string', `${at}.${k} は文字にしてください`);
    if (p.circ != null) need(p.type === 'pair', `${at}.circ（周囲長の欄）は pair だけに付けられます`);
    if (p.slant != null)
      need(
        p.type === 'pair' && isObj(p.slant) && typeof p.slant.label === 'string' && p.slant.label && typeof p.slant.angle === 'number' && p.slant.angle > 0 && p.slant.angle < 90,
        `${at}.slant（斜めの長さの欄）は pair に付け、{ label, angle（0〜90 の角度） } の形にしてください`,
      );
    if (p.digits != null) need(Number.isInteger(p.digits) && p.digits >= 0 && p.digits <= 3, `${at}.digits は 0〜3 の整数にしてください`);
    if (p.fixed != null) need(Number.isInteger(p.fixed) && p.fixed >= 0 && p.fixed <= 3, `${at}.fixed（文に出す小数点以下の桁）は 0〜3 の整数にしてください`);
    if (p.offText != null) need(p.type === 'flag', `${at}.offText（付けないときの文）は flag だけに付けられます`);
    if (p.coreFrom != null) need(p.type === 'flag' && defs[p.coreFrom]?.type === 'pair', `${at}.coreFrom は flag に付け、pair の名前にしてください`);
    if (p.noText != null) need(typeof p.noText === 'boolean', `${at}.noText は true か false にしてください`);
    if (p.ratio != null) {
      const q = p.ratio;
      const okShape = p.type === 'pair' && q && typeof q === 'object' && q.num > 0 && q.den > 0 && typeof q.lt === 'string' && typeof q.ge === 'string';
      need(okShape, `${at}.ratio は pair に付け、{ num, den, lt, ge, to? } の形にしてください`);
      if (okShape && q.to != null)
        need(defs[q.to]?.type === 'choice' && defs[q.to].options.includes(q.lt) && defs[q.to].options.includes(q.ge), `${at}.ratio.to は choice の名前にし、lt・ge をその選択肢にしてください`);
    }
    if (p.depthInput != null) need(p.type === 'size' && typeof p.depthInput === 'boolean', `${at}.depthInput は size に付け、true か false にしてください`);
    for (const k of ['depth', 'unitEach', 'attach', 'glue']) need(p[k] == null || typeof p[k] === 'boolean', `${at}.${k} は true か false にしてください`);
  }
  return true;
}

// 設定の部品の定義を確かめる（config.js から呼ぶ）。need(条件, 誤りの文)
export function validateDetailParts(s, need) {
  if (s.detailParts == null) {
    const used = Object.values(s.forms || {}).some((f) => (f?.sections || []).some((sec) => (sec?.items || []).some((it) => it?.parts != null)));
    need(s.detailPartsDefault == null && !used, 'initialSurvey.detailPartsDefault や項目の parts を使うときは detailParts（部品の定義）が必要です');
    return;
  }
  if (!validatePartDefs(s.detailParts, 'initialSurvey.detailParts', need)) return;
  const names = new Set(Object.keys(s.detailParts));
  const check = (list, at) => need(Array.isArray(list) && list.every((n) => names.has(n)), `${at} に、detailParts にない部品があります`);
  if (s.detailPartsDefault != null) check(s.detailPartsDefault, 'initialSurvey.detailPartsDefault');
  for (const [form, f] of Object.entries(s.forms || {}))
    (f?.sections || []).forEach((sec, i) =>
      (sec?.items || []).forEach((it, j) => {
        if (it?.parts == null) return;
        need(it.type === 'weak', `initialSurvey.forms.${form}.sections[${i}].items[${j}]：parts は弱点の項目（weak）にだけ付けられます`);
        check(it.parts, `initialSurvey.forms.${form}.sections[${i}].items[${j}].parts`);
        const vf = it.valueFrom;
        if (vf != null) {
          const at = `initialSurvey.forms.${form}.sections[${i}].items[${j}].valueFrom`;
          const v = vf?.values;
          if (vf?.choice != null) {
            const ch = s.detailParts[vf.choice];
            need(
              it.parts.includes(vf.choice) && ch?.type === 'choice' && v && typeof v === 'object' && Object.keys(v).length > 0 &&
                Object.entries(v).every(([k, x]) => ch.options.map(clean).includes(clean(k)) && typeof x === 'string' && x),
              `${at} は { choice: 選択肢の部品（項目の parts にあるもの）, values: { 部品の選択肢: 有無の選択肢 } } の形にしてください`,
            );
            return;
          }
          need(
            vf && typeof vf === 'object' && it.parts.includes(vf.ratio) && s.detailParts[vf.ratio]?.type === 'pair' && !!s.detailParts[vf.ratio].ratio &&
              it.parts.includes(vf.core) && s.detailParts[vf.core]?.type === 'flag' &&
              v && ['lt', 'ge', 'coreLt', 'coreGe'].every((k) => typeof v[k] === 'string' && v[k]),
            `${at} は { ratio: 比のある pair, core: flag（どちらも項目の parts にあるもの）, values: { lt, ge, coreLt, coreGe } } の形にしてください`,
          );
        }
      }),
    );
  need(s.detailJoin == null || typeof s.detailJoin === 'string', 'initialSurvey.detailJoin は文字にしてください');
}
