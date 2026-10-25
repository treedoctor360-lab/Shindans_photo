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
//   line   … 1行の形（省略時「{place}の{kind}：{text}」）
// 作った1行は特記事項（野帳）に足すだけで、ほかの項目は変えない。足した後は手で直せる。
// 足した1行の元の数字は木の measures に残し、詳しい診断の記録を作るときに弱点の詳細へ写す
// （設定 initialSurvey.fromMeasures。measuresToInitial）。

import { buildDetail, detailKeyOfItem, partsKeyOf, partsOf, buildText, ratioChoice, validatePartDefs } from './detailParts.js';
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

// 1行を作る。種類・（部位を選ぶ種類なら）部位が選ばれていない、または数字が何もなければ空
export function measureLine(cfg, kindKey, place, values) {
  const m = cfg.noteMeasures;
  const kind = kindOf(kindKey, cfg);
  if (!kind) return '';
  const needPlace = measurePlaces(kindKey, cfg).length > 0;
  if (needPlace && !place) return '';
  const text = buildText(values, measureParts(kindKey, cfg), m.join ?? '、');
  if (!text) return '';
  return (kind.line || m.line || '{place}の{kind}：{text}').replace('{place}', needPlace ? place : '').replace('{kind}', kind.label).replace('{text}', text);
}

// 特記事項に残っている寸法の1行から、撮る写真を決める（設定の kinds の photo / fullOnly。写真の判定 photo.js から呼ぶ）
//  返す形：{ weak: [弱点写真の名前…], fullOnly: 全景だけ要る1行があるか }
export function measurePhotos(tree, cfg) {
  const out = { weak: [], fullOnly: false };
  const notes = String(tree?.notes || '');
  for (const m of tree?.measures || []) {
    if (!m?.line || !notes.includes(m.line)) continue; // 手で消した・書き換えた行は使わない
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
  const notes = String(tree?.notes || '');
  const out = [];
  for (const m of tree?.measures || []) {
    if (!m?.line || !notes.includes(m.line)) continue;
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

// 木の寸法の記録から、詳しい診断の弱点の詳細（数値と文）を作る
//  特記事項にその1行が残っているものだけ使う（手で消した・書き換えた行は使わない）
//  返す形：{ values: { 詳細の項目: 文, 詳細の項目Parts: 数値 }, keys: [詳細の項目…] }
export function measuresToInitial(tree, cfg) {
  const rules = cfg.initialSurvey?.fromMeasures || [];
  const out = { values: {}, keys: [] };
  if (!rules.length) return out;
  const notes = String(tree?.notes || '');
  const byItem = new Map();
  for (const m of tree?.measures || []) {
    if (!m?.line || !notes.includes(m.line)) continue;
    const rule = rules.find((x) => x.kind === m.kind && (x.place == null || x.place === m.place));
    if (!rule) continue;
    const vals = byItem.get(rule.item) || {};
    for (const [to, v] of Object.entries(rule.set || {})) if (vals[to] === undefined) vals[to] = v;
    for (const [from, spec] of Object.entries(rule.parts)) {
      const sp = typeof spec === 'string' ? { to: spec } : spec;
      const v = sp.ratio ? ratioChoice(m.values?.[from], sp.ratio) : m.values?.[from];
      if (blankPart(v)) continue;
      vals[sp.to] = mergePart(vals[sp.to], structuredClone(v), sp.ratio);
    }
    byItem.set(rule.item, vals);
  }
  for (const [key, vals] of byItem) {
    const item = itemOf(cfg, key);
    if (!item || !Object.keys(vals).length) continue;
    const dk = detailKeyOfItem(item);
    out.values[partsKeyOf(dk)] = vals;
    out.values[dk] = buildDetail(vals, partsOf(item, cfg), cfg);
    out.keys.push(dk);
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
