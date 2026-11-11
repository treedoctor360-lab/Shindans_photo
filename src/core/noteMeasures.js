// 簡易診断の特記事項に足す「寸法」の1行を、数字から作る
//
// 腐朽・空洞・鋼棒貫入などの大きさを、数字の欄に入れるだけで決まった書き方の1行にする
// （記号や単位を打つ手間を省く）。書き方は設定 noteMeasures に置く：
//   places … 部位の選択肢（例 ["枝", "幹"]）
//   parts  … 数字の欄の定義（種類は detailParts.js の PART_TYPES と同じ）
//   kinds  … 寸法の種類 [{ key, label, parts: [欄の名前…], places?, line?, prefill? }]
//              places：その種類の部位の選択肢（[] なら部位を選ばない）。line：その種類の1行の形
//              prefill：{ 欄の名前: 木の項目 } 開いたときに木の入力から入れておく（例 本数 ← 枯れ枝の本数）
//              photo：その1行があるときに撮る弱点写真の名前（{place} で部位を入れられる）。fullOnly：true なら全景だけ要る
//              db：その1行があるときに一覧表用の特記に入れる言い回し（{place} で部位。notes.js の autoDbNote）
//   line   … 1行の形（省略時「{place}の{kind}：{text}」）
// 作った1行は特記事項（野帳）に足すだけで、ほかの項目は変えない。足した後は手で直せる。
// 足した1行の元の数字は木の measures に残し、詳しい診断の記録を作るときに弱点の詳細へ写す
// （設定 initialSurvey.fromMeasures。measuresToInitial）。

import { buildDetail, detailKeyOfItem, fromEntries, itemValueOf, partsKeyOf, partsOf, buildText, ratioChoice, validatePartDefs } from './detailParts.js';
import { toHalf } from './text.js';

export const measureKinds = (cfg) => cfg.noteMeasures?.kinds || [];

// 種類で使う数字の欄（定義に名前を付けたもの）
export function measureParts(kindKey, cfg) {
  const m = cfg.noteMeasures;
  const kind = (m?.kinds || []).find((k) => k.key === kindKey);
  if (!kind) return [];
  return kind.parts.filter((n) => m.parts?.[n]).map((n) => ({ name: n, ...m.parts[n] }));
}

const kindOf = (kindKey, cfg) => (cfg.noteMeasures?.kinds || []).find((k) => k.key === kindKey);

// 種類の部位の選択肢（種類に places があればそれ。[] なら部位を選ばない）
export function measurePlaces(kindKey, cfg) {
  const kind = kindOf(kindKey, cfg);
  return kind?.places ?? cfg.noteMeasures?.places ?? [];
}

// 種類を選んだときに、木の入力から入れておく値（例 本数 ← 枯れ枝の本数）
export function measurePrefill(kindKey, tree, cfg) {
  const out = {};
  for (const [part, field] of Object.entries(kindOf(kindKey, cfg)?.prefill || {})) {
    const v = toHalf(String(tree?.[field] ?? '')).trim();
    if (v) out[part] = v;
  }
  return out;
}

// ---------- 寸法の記録の置き場所 ----------
//  新しい形（木の measuresV が 2）：寸法は木の measures の一覧だけに置き、特記事項（notes）の文字には入れない。
//    1行の文は数字から毎回作る（野帳・一覧表用の特記・写真などで使うときに足す）。直すときは数字の画面で直す
//  前の形（measuresV なし）：寸法の1行を特記事項の文字に足していた。文字に残っている1行の寸法だけを使う
//    （手で直した・消した1行は、ふつうの文として扱う）。木を直したときに新しい形に移す（toMeasuresV2）
export const isMeasuresV2 = (tree) => tree?.measuresV === 2;
const bareLine = (l) => String(l).replace(/^[・･\-\s]+/, '').trim();

// 使う寸法の記録（新しい形はすべて、前の形は特記事項に1行が残っているものだけ）
export function activeMeasures(tree) {
  const ms = (tree?.measures || []).filter((m) => m && m.kind);
  if (isMeasuresV2(tree)) return ms;
  const notes = String(tree?.notes || '');
  return ms.filter((m) => m.line && notes.includes(m.line)); // 前と同じ見分け方（1行が文字の中に残っていれば使う）
}

// 使う寸法の記録に、野帳などに出す1行（line）を付けたもの
//  新しい形は数字から作る。merge なら同じ部位・種類を「①…②…」の1行にまとめ、その中の記録すべてに同じ line を付ける
export function measuresWithLines(tree, cfg) {
  const ms = activeMeasures(tree);
  if (!isMeasuresV2(tree)) return ms;
  const one = (m) => ({ ...m, line: measureLine(cfg, m.kind, m.place, m.values) });
  if (!cfg.noteMeasures?.merge) return ms.map(one).filter((m) => m.line);
  const groups = new Map();
  for (const m of ms) {
    const k = `${m.kind}|${m.place || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const out = [];
  for (const g of groups.values()) {
    const kind = kindOf(g[0].kind, cfg);
    const texts = g.map((m) => measureText(cfg, m.kind, m.values)).filter(Boolean);
    if (!kind || !texts.length) continue;
    const line = lineOf(cfg, kind, measurePlaces(g[0].kind, cfg).length ? g[0].place || '' : '', texts.length > 1 ? texts.map((t, i) => circled(i) + t).join(' ') : texts[0]);
    for (const m of g) out.push({ ...m, line });
  }
  return out;
}

// 寸法の1行（野帳の特記事項の最後に並べる。まとめた1行は1回だけ）
export const measureLinesOf = (tree, cfg) => [...new Set(measuresWithLines(tree, cfg).map((m) => m.line))];

// 特記事項の文字欄に出す文（定型文と自由に書く文。前の形の木は、新しい形に移したときの文）
export const freeNotesOf = (tree, cfg) => String(toMeasuresV2(tree, cfg).notes || '');

// 野帳などに出す特記事項の全文（文字欄の文＋寸法の1行）
export function fullNotesOf(tree, cfg) {
  if (!isMeasuresV2(tree)) return String(tree?.notes || '');
  const base = String(tree?.notes || '').replace(/\s+$/, '');
  const add = measureLinesOf(tree, cfg).map((l) => `・${l}`);
  return [base, ...add].filter(Boolean).join('\n');
}

// 新しい形に移した木（特記事項から寸法の1行を外し、手で直した・消した1行の記録は捨てる）。すでに新しい形ならそのまま
//  1行そのままの行 → 文字から外す。1行の後ろに言葉を足した行（例「…、北側」）→ 種類に備考（memo）の欄があれば、
//  足した言葉を備考にして文字から外す。それ以外（1行の前や途中を直した行）→ 文字はそのまま残し、寸法の記録も残す
//  （どちらも消さない。野帳に2行出るので、見て片方を消してもらう）
export function toMeasuresV2(tree, cfg) {
  if (isMeasuresV2(tree)) return tree;
  const lines = String(tree?.notes || '').split('\n');
  const drop = new Set();
  const ms = [];
  for (const m of activeMeasures(tree)) {
    const rec = { kind: m.kind, place: m.place || '', values: { ...(m.values || {}) } };
    const at = lines.findIndex((l, i) => !drop.has(i) && bareLine(l).includes(m.line));
    if (at >= 0) {
      const body = bareLine(lines[at]);
      const rest = body.startsWith(m.line) ? body.slice(m.line.length).replace(/^[、,，\s]+/, '').trim() : null;
      const hasMemo = (kindOf(m.kind, cfg)?.parts || []).includes('memo') && cfg.noteMeasures?.parts?.memo;
      if (rest === '') drop.add(at);
      else if (rest != null && hasMemo) {
        rec.values.memo = [rec.values.memo, rest].filter(Boolean).join('、');
        drop.add(at);
      }
      // まとめた1行（①②）は、同じ行の記録がいくつもある。2つ目からは同じ行を見つけて外す
      for (let i = 0; i < lines.length; i++) if (!drop.has(i) && bareLine(lines[i]) === m.line) drop.add(i);
    }
    ms.push(rec);
  }
  const notes = lines.filter((_, i) => !drop.has(i)).join('\n').replace(/\s+$/, '');
  return { ...tree, notes, measures: ms, measuresV: 2 };
}

// 寸法を足す・直す・消す（新しい形の木を返す）。i：直す・消す記録の番号（measures の並び）
export const putMeasure = (tree, cfg, rec, i = -1) => {
  const t = toMeasuresV2(tree, cfg);
  const m = { kind: rec.kind, place: rec.place || '', values: rec.values };
  const ms = [...t.measures];
  if (i >= 0 && i < ms.length) ms[i] = m;
  else ms.push(m);
  return applyToTree({ ...t, measures: ms }, m, cfg);
};

// 寸法を入れたときに、簡易診断の項目にも入れる（種類の toTree。例 子実体の寸法 → ⑦子実体を「有」、種名を足す）
//  toTree：{ 木の項目: 決まった値 か { from: その種類の欄の名前 } }。from の値は、まだ入っていなければ「、」でつないで足す
//  寸法を消しても、木の項目は戻さない（ほかの寸法や手で入れた値かもしれないため）
// 「、」などで区切った名前の並び（空は除く）
export const splitNames = (v) => String(v ?? '').split(/[、,，]/).map((x) => toHalf(x).trim()).filter(Boolean);

function applyToTree(tree, m, cfg) {
  const kind = kindOf(m.kind, cfg);
  if (!kind?.toTree) return tree;
  const next = { ...tree };
  for (const [field, spec] of Object.entries(kind.toTree)) {
    if (typeof spec === 'string') {
      next[field] = spec;
      continue;
    }
    const v = toHalf(String(m.values?.[spec.from] ?? '')).trim();
    if (!v) continue;
    const cur = String(next[field] ?? '').trim();
    if (!cur) next[field] = v;
    else if (!splitNames(cur).includes(v)) next[field] = `${cur}、${v}`;
  }
  return next;
}
export const removeMeasure = (tree, cfg, i) => {
  const t = toMeasuresV2(tree, cfg);
  return { ...t, measures: t.measures.filter((_, j) => j !== i) };
};

// 1行を作る。種類・（部位を選ぶ種類なら）部位が選ばれていない、または数字が何もなければ空
export function measureLine(cfg, kindKey, place, values) {
  const kind = kindOf(kindKey, cfg);
  if (!kind) return '';
  const needPlace = measurePlaces(kindKey, cfg).length > 0;
  if (needPlace && !place) return '';
  const text = measureText(cfg, kindKey, values);
  if (!text) return '';
  return lineOf(cfg, kind, needPlace ? place : '', text);
}

// 数字の部分だけの文（例「H0～0.4m、40×20cm」）
export const measureText = (cfg, kindKey, values) => buildText(values, measureParts(kindKey, cfg), cfg.noteMeasures?.join ?? '、');
const lineOf = (cfg, kind, place, text) =>
  (kind.line || cfg.noteMeasures.line || '{place}の{kind}：{text}').replace('{place}', place).replace('{kind}', kind.label).replace('{text}', text);

// 丸数字（①〜⑳。それより多ければ「(21)」）
const circled = (i) => (i < 20 ? String.fromCharCode(0x2460 + i) : `(${i + 1})`);

// 寸法の1行を特記事項に足す。返す形：{ notes, measures }
//  設定 noteMeasures.merge が true なら、同じ部位・同じ種類の1行が特記事項に残っていれば1行にまとめる
//  （例「根株の腐朽：①H0～0.4m、40×20cm ②H0～0.5m、50×10cm」。野帳の枠に収めるため）。
//  まとめた1行は、まとめた寸法の記録すべての line にする（特記事項にその1行が残っている間は、どれも詳しい診断へ写せる）
export function addMeasure(tree, cfg, rec) {
  const notes = String(tree?.notes || '');
  const measures = tree?.measures || [];
  const kind = kindOf(rec.kind, cfg);
  const lines = notes.split('\n');
  const bare = (l) => l.replace(/^[・･\-\s]+/, '').trim();
  const same = cfg.noteMeasures?.merge && kind
    ? measures.filter((x) => x.kind === rec.kind && (x.place || '') === (rec.place || '') && x.line && lines.some((l) => bare(l) === x.line))
    : [];
  if (!same.length) return { notes: appendNoteLine(notes, rec.line), measures: [...measures, rec] };
  // 特記事項に残っている同じ部位・種類の1行（まとめた1行なら、その中の寸法すべて）と、新しい寸法を並べ直す
  const oldLines = [...new Set(same.map((x) => x.line))];
  const group = [...measures.filter((x) => oldLines.includes(x.line)), rec];
  const texts = group.map((x) => measureText(cfg, x.kind, x.values)).filter(Boolean);
  const merged = lineOf(cfg, kind, rec.place || '', texts.length > 1 ? texts.map((t, i) => circled(i) + t).join(' ') : texts[0] || '');
  // 最初に出てくる1行の所に、まとめた1行を置く（ほかの同じ1行は消す）
  let placed = false;
  const nextLines = [];
  for (const l of lines) {
    if (!oldLines.includes(bare(l))) {
      nextLines.push(l);
      continue;
    }
    if (!placed) nextLines.push(`・${merged}`);
    placed = true;
  }
  return {
    notes: nextLines.join('\n'),
    measures: [...measures.map((x) => (oldLines.includes(x.line) ? { ...x, line: merged } : x)), { ...rec, line: merged }],
  };
}

// 特記事項に残っている寸法の1行から、撮る写真を決める（設定の kinds の photo / fullOnly。写真の判定 photo.js から呼ぶ）
//  返す形：{ weak: [弱点写真の名前…], fullOnly: 全景だけ要る1行があるか }
export function measurePhotos(tree, cfg) {
  const out = { weak: [], fullOnly: false };
  for (const m of activeMeasures(tree)) {
    const kind = kindOf(m.kind, cfg);
    if (!kind) continue;
    if (kind.photo) {
      const name = kind.photo.replace('{place}', m.place || '');
      if (!out.weak.includes(name)) out.weak.push(name);
    }
    if (kind.fullOnly) out.fullOnly = true;
  }
  return out;
}

// 特記事項に残っている寸法の1行のうち、弱点写真の名前（photo）が設定にないものの写真の名前
//  （特記事項に書いたものは撮る。名前は「部位の種類」。例「根株の鋼棒貫入」「打診音異常」）
//  返す形：[{ line: その1行, name: 写真の名前 }]
export function measureNoteNames(tree, cfg) {
  const out = [];
  for (const m of measuresWithLines(tree, cfg)) {
    const kind = kindOf(m.kind, cfg);
    if (!kind) continue;
    out.push({ line: m.line, name: kind.photo ? kind.photo.replace('{place}', m.place || '') : `${m.place ? `${m.place}の` : ''}${kind.label}`, hasPhoto: !!kind.photo });
  }
  return out;
}

// 特記事項の最後に1行足す（定型文の行と同じく頭に「・」。最後の空行は詰める）
export function appendNoteLine(notes, line) {
  const base = String(notes || '').replace(/\s+$/, '');
  return base ? `${base}\n・${line}` : `・${line}`;
}

// 設定を確かめる（config.js から呼ぶ）。need(条件, 誤りの文)
export function validateNoteMeasures(m, need) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const isStr = (x) => typeof x === 'string' && x.length > 0;
  if (!need(isObj(m), 'noteMeasures の形が違います')) return;
  need(Array.isArray(m.places) && m.places.length > 0 && m.places.every(isStr), 'noteMeasures.places（部位の選択肢）を1つ以上の文字で書いてください');
  need(m.line == null || (isStr(m.line) && m.line.includes('{text}')), 'noteMeasures.line は {text} を含む文字にしてください');
  need(m.join == null || typeof m.join === 'string', 'noteMeasures.join は文字にしてください');
  need(m.merge == null || typeof m.merge === 'boolean', 'noteMeasures.merge は true か false にしてください');
  const okDefs = validatePartDefs(m.parts, 'noteMeasures.parts', need);
  if (!need(Array.isArray(m.kinds) && m.kinds.length > 0, 'noteMeasures.kinds（寸法の種類）がありません')) return;
  const keys = new Set();
  m.kinds.forEach((k, i) => {
    const at = `noteMeasures.kinds[${i}]`;
    if (!need(isObj(k) && isStr(k.key) && isStr(k.label) && Array.isArray(k.parts) && k.parts.length > 0, `${at} は { key, label, parts: [欄の名前…] } の形にしてください`)) return;
    need(!keys.has(k.key), `${at}：key「${k.key}」が重複しています`);
    keys.add(k.key);
    if (okDefs) need(k.parts.every((n) => m.parts[n]), `${at}.parts に、noteMeasures.parts にない欄があります`);
    need(k.places == null || (Array.isArray(k.places) && k.places.every(isStr)), `${at}.places は部位の文字の並び（部位を選ばないなら []）にしてください`);
    need(k.line == null || (isStr(k.line) && k.line.includes('{text}')), `${at}.line は {text} を含む文字にしてください`);
    need(k.photo == null || isStr(k.photo), `${at}.photo は写真の名前（文字）にしてください`);
    need(k.fullOnly == null || typeof k.fullOnly === 'boolean', `${at}.fullOnly は true か false にしてください`);
    need(k.db == null || isStr(k.db), `${at}.db は一覧表用の言い回し（文字）にしてください`);
    need(
      k.toTree == null || (isObj(k.toTree) && Object.values(k.toTree).every((v) => isStr(v) || (isObj(v) && k.parts.includes(v.from)))),
      `${at}.toTree は { 木の項目: 値 か { from: その種類の欄の名前 } } の形にしてください`,
    );
    need(
      k.prefill == null || (isObj(k.prefill) && Object.entries(k.prefill).every(([p, f]) => k.parts.includes(p) && isStr(f))),
      `${at}.prefill は { その種類の欄の名前: 木の項目 } の形にしてください`,
    );
  });
}

// ---------- 詳しい診断への引き継ぎ ----------
//  設定 initialSurvey.fromMeasures：[{ kind, place?, item, parts: { 寸法の欄: 詳しい診断の数値の名前 か { to, ratio } }, set? }]
//    kind・place：どの寸法の1行か（place を省くと部位を問わない）。item：詳しい診断の弱点の項目
//    set：{ 詳しい診断の数値の名前: 値 } 決まった値を入れる（例 根株の空洞を幹の空洞の欄に書くとき、部位に「根株」）
//    ratio：{ num, den, lt, ge } 2つの数（a/b）の比が num/den 未満なら lt、以上なら ge の選択肢にする（例 周囲長比）
//    fromTree：{ 詳しい診断の数値の名前: 簡易診断の項目 } 簡易診断の入力の値を写す（例 子実体の種名 ← 簡易の子実体の種名）
//    merge：true なら、同じ項目に寸法が2件以上あっても1か所にまとめる（高さは範囲・大きさは並べる）。
//      省略時は寸法1件を1か所とし、2か所以上なら文を①②…で並べる（detailParts.js の more）

// 木に残す寸法の記録（特記事項に足した1行と、その元の数字）
export const measureRecord = (kind, place, values, line) => ({ kind, place: place || '', values, line });

const blankPart = (v) =>
  v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && !String(v.a ?? '').trim() && !String(v.b ?? '').trim());

// 同じ項目に2つ以上の寸法が来たときのまとめ方
//  大きさ（並び）はつなげる、高さは一番低い所から高い所まで、印はどれかにあれば付ける、比の選択肢は大きい方、ほかは先のもの
function mergePart(cur, v, ratio) {
  if (cur === undefined) return v;
  if (Array.isArray(cur) && Array.isArray(v)) return [...cur, ...v];
  if (typeof cur === 'boolean' || typeof v === 'boolean') return !!(cur || v);
  if (ratio) return cur === ratio.ge || v === ratio.ge ? ratio.ge : cur;
  if (typeof cur === 'object' && typeof v === 'object') {
    const all = [cur.a, cur.b, v.a, v.b].map((x) => toHalf(String(x ?? '')).trim()).filter((x) => x !== '');
    if (!all.length || all.some((x) => Number.isNaN(Number(x)))) return cur;
    all.sort((x, y) => Number(x) - Number(y));
    const [lo, hi] = [all[0], all[all.length - 1]];
    return Number(lo) === Number(hi) ? { a: lo, b: '' } : { a: lo, b: hi };
  }
  return cur;
}

// 寸法の種類の toTree（{ from }）で、木の項目に入った名前の集まり（例 子実体の寸法の種名 → ⑦子実体の種名）
//  寸法がなくて簡易診断の入力から補った分（prefill）は数えない（その名前は⑦に書いた名前そのもの）
export function namesFromMeasures(tree, field, cfg) {
  const set = new Set();
  for (const m of activeMeasures(tree)) {
    const spec = kindOf(m.kind, cfg)?.toTree?.[field];
    if (!spec || typeof spec !== 'object') continue;
    const v = toHalf(String(m.values?.[spec.from] ?? '')).trim();
    if (v) set.add(v);
  }
  return set;
}

// 木の寸法の記録から、詳しい診断の弱点の詳細（数値と文）を作る
//  特記事項にその1行が残っているものだけ使う（手で消した・書き換えた行は使わない）
//  返す形：{ values: { 詳細の項目: 文, 詳細の項目Parts: 数値 }, keys: [詳細の項目…] }
export function measuresToInitial(tree, cfg) {
  const rules = cfg.initialSurvey?.fromMeasures || [];
  const out = { values: {}, keys: [] };
  if (!rules.length) return out;
  // 項目ごとに、箇所の並び（寸法1件＝1か所）と、項目全体の部品（whole。例 子実体の種名）を集める
  const byItem = new Map();
  const used = [...activeMeasures(tree)];
  // 寸法の1行がない種類でも、簡易診断の入力から入れておける値（種類の prefill。例 枯れ枝の本数 ← 簡易の枯れ枝の本数）は写す
  for (const kind of measureKinds(cfg)) {
    if (!kind.prefill || used.some((m) => m.kind === kind.key)) continue;
    const values = measurePrefill(kind.key, tree, cfg);
    if (Object.keys(values).length) used.push({ kind: kind.key, place: '', values, line: '' });
  }
  const defs = cfg.initialSurvey?.detailParts || {};
  const isWhole = (name) => !!defs[name]?.whole;
  const ruleOf = (m) => rules.find((x) => x.kind === m.kind && (x.place == null || x.place === m.place));
  // まとめる規則（merge）の寸法は後に回す（先に箇所を作ってから、1か所目にまとめる）
  const ordered = [...used.filter((m) => !ruleOf(m)?.merge), ...used.filter((m) => ruleOf(m)?.merge)];
  for (const m of ordered) {
    const rule = ruleOf(m);
    if (!rule) continue;
    const g = byItem.get(rule.item) || { entries: [], whole: {}, once: {} };
    const vals = {};
    for (const [to, v] of Object.entries(rule.set || {})) vals[to] = v;
    for (const [from, spec] of Object.entries(rule.parts)) {
      const sp = typeof spec === 'string' ? { to: spec } : spec;
      const v = sp.ratio ? ratioChoice(m.values?.[from], sp.ratio) : m.values?.[from];
      // 芯未達のように「付けない」を選んだ印（false）も写す（設定の offText があれば文に出す）
      if (v !== false && blankPart(v)) continue;
      vals[sp.to] = structuredClone(v);
    }
    // 大きさの奥行を文字の欄へ移す（rule の depthTo。例 腐朽の大きさは縦×横だけ書き、奥行は備考に「奥行10cm」と残す）
    if (rule.depthTo) {
      const ds = [];
      for (const [k, v] of Object.entries(vals)) {
        if (k === rule.depthTo || !Array.isArray(v)) continue;
        vals[k] = v.map((y) => {
          const d = toHalf(String(y?.d ?? '')).trim();
          if (d) ds.push(d);
          const { d: _drop, ...rest } = y || {};
          return rest;
        });
      }
      if (ds.length) {
        const memo = String(vals[rule.depthTo] ?? '').trim();
        vals[rule.depthTo] = [`奥行${ds.join('・')}cm`, memo].filter(Boolean).join('、');
      }
    }
    // 簡易診断の入力から写す値（rule の fromTree。例 子実体の種名 ← 簡易の子実体の種名）
    for (const [to, field] of Object.entries(rule.fromTree || {})) {
      // 「有」のときだけ入れる項目（設定 details の when）は、その条件のときだけ写す
      const d = (cfg.details || []).find((x) => x.field === field);
      if (d?.when && tree[d.when.field] !== d.when.eq) continue;
      // 寸法（種類の toTree）から木の項目に入った名前は、その寸法の部位の項目にだけ写るので、ここでは除く
      //  例 根株の子実体の寸法の種名は根株の腐朽にだけ。幹の腐朽には⑦に手で書いた名前だけを写す
      const taken = namesFromMeasures(tree, field, cfg);
      let v = String(tree[field] ?? '').trim();
      if (taken.size) v = splitNames(v).filter((x) => !taken.has(x)).join('、');
      // 項目に1回だけ（腐朽が何か所あっても、全部の箇所に同じ名前を付けない）。後で、まだその欄が空の最初の箇所に入れる
      if (v && g.once[to] === undefined) g.once[to] = v;
    }
    // 項目全体の部品は箇所に入れず、まとめて1つ（先に入ったものを使う）
    for (const [k, v] of Object.entries(vals))
      if (isWhole(k)) {
        if (g.whole[k] === undefined) g.whole[k] = v;
        delete vals[k];
      }
    const hasEach = Object.keys(vals).some((k) => !(k in (rule.set || {})));
    if (hasEach) {
      // 1件ずつ箇所にする。merge: true の規則（例 本数と最大のものを書く項目）は、今までどおり1か所にまとめる
      if (rule.merge && g.entries.length) {
        const cur = g.entries[0];
        for (const [k, v] of Object.entries(vals)) cur[k] = mergePart(cur[k], v, (Object.values(rule.parts).find((sp) => typeof sp === 'object' && sp.to === k) || {}).ratio);
      } else g.entries.push(vals);
    }
    byItem.set(rule.item, g);
  }
  for (const [key, g] of byItem) {
    const item = itemOf(cfg, key);
    if (!item || (!g.entries.length && !Object.keys(g.whole).length && !Object.keys(g.once).length)) continue;
    const es = g.entries.length ? g.entries : [{}];
    for (const [k, v] of Object.entries(g.once)) {
      const at = es.find((e) => e[k] === undefined);
      if (at) at[k] = v;
    }
    // 写した2つの数（例 周囲長／幹周）に比の設定（ratio.to）があれば、その選択肢も入れる（入力画面で数を入れたときと同じ）。箇所ごとに
    for (const vals of es)
      for (const p of partsOf(item, cfg)) {
        if (p.type !== 'pair' || !p.ratio?.to || vals[p.name] === undefined || vals[p.ratio.to] !== undefined) continue;
        const r = ratioChoice(vals[p.name], p.ratio);
        if (r) vals[p.ratio.to] = r;
      }
    es[0] = { ...es[0], ...g.whole };
    const vals = fromEntries(es);
    const dk = detailKeyOfItem(item);
    out.values[partsKeyOf(dk)] = vals;
    out.values[dk] = buildDetail(vals, partsOf(item, cfg), cfg);
    out.keys.push(dk);
    // 有無の選択肢を数値から決める項目（valueFrom。例 開口空洞の芯到達・周囲長比）
    const iv = itemValueOf(item, vals, cfg);
    if (iv) (out.choices ||= {})[dk] = { key: item.key, value: iv };
  }
  return out;
}

// 詳しい診断の入力画面の項目（なければ null）
function itemOf(cfg, key) {
  for (const form of Object.values(cfg.initialSurvey?.forms || {})) for (const sec of form.sections || []) for (const it of sec.items || []) if (it.key === key) return it;
  return null;
}

// 設定 initialSurvey.fromMeasures を確かめる（config.js から呼ぶ。noteMeasures・forms・detailParts の検証の後）
export function validateFromMeasures(list, cfg, need) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const isStr = (x) => typeof x === 'string' && x.length > 0;
  if (!need(Array.isArray(list), 'initialSurvey.fromMeasures は並び（[…]）にしてください')) return;
  if (!cfg.noteMeasures) return; // 寸法の1行を使わない設定なら、写すものもない
  list.forEach((r, i) => {
    const at = `initialSurvey.fromMeasures[${i}]`;
    if (!need(isObj(r) && isStr(r.kind) && isStr(r.item) && isObj(r.parts) && (r.place == null || isStr(r.place)) && (r.set == null || isObj(r.set)), `${at} は { kind, place?, item, parts: { 寸法の欄: 数値の名前 }, set? } の形にしてください`)) return;
    const kind = (cfg.noteMeasures?.kinds || []).find((k) => k.key === r.kind);
    if (!need(kind, `${at}：kind「${r.kind}」が noteMeasures.kinds にありません`)) return;
    const item = itemOf(cfg, r.item);
    if (!need(item?.type === 'weak', `${at}：item「${r.item}」が initialSurvey.forms の弱点（weak）の項目にありません`)) return;
    const targets = new Map(partsOf(item, cfg).map((p) => [p.name, p]));
    for (const [to, v] of Object.entries(r.set || {})) {
      const t = targets.get(to);
      if (!need(t, `${at}.set：「${to}」が項目「${r.item}」の数値にありません`)) continue;
      if (t.type === 'choice') need(t.options.includes(v), `${at}.set.${to}：「${v}」は選択肢にありません`);
      else need(typeof v === 'string' || typeof v === 'number', `${at}.set.${to} は文字か数にしてください`);
    }
    need(r.merge == null || typeof r.merge === 'boolean', `${at}.merge は true か false にしてください`);
    if (r.depthTo != null) need(targets.get(r.depthTo)?.type === 'text', `${at}.depthTo：「${r.depthTo}」が項目「${r.item}」の文字（text）の欄にありません`);
    if (r.fromTree != null && need(isObj(r.fromTree), `${at}.fromTree は { 写し先: 簡易診断の項目 } の形にしてください`))
      for (const [to, field] of Object.entries(r.fromTree)) need(targets.has(to) && isStr(field), `${at}.fromTree.${to}：写し先が項目「${r.item}」の数値にないか、簡易診断の項目の名前がありません`);
    for (const [from, spec] of Object.entries(r.parts)) {
      const sp = typeof spec === 'string' ? { to: spec } : spec;
      need(kind.parts.includes(from), `${at}.parts：「${from}」は寸法「${r.kind}」の欄にありません`);
      if (!need(isObj(sp) && isStr(sp.to) && targets.has(sp.to), `${at}.parts.${from}：写し先「${sp?.to ?? ''}」が項目「${r.item}」の数値にありません`)) continue;
      if (sp.ratio == null) continue;
      const q = sp.ratio;
      const t = targets.get(sp.to);
      need(
        isObj(q) && q.num > 0 && q.den > 0 && isStr(q.lt) && isStr(q.ge) && t.type === 'choice' && t.options.includes(q.lt) && t.options.includes(q.ge),
        `${at}.parts.${from}.ratio は { num, den, lt, ge } の形で、lt・ge は写し先の選択肢にしてください`,
      );
    }
  });
}
