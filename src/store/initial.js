// 詳しい診断（初期診断など）の記録
//
// 簡易診断で「詳しい診断が必要」とした木が対象。1本の木に記録は1件（鍵は surveys.js の initialKey）。
// 記録を作るときに、簡易診断の値（樹高・幹周など）を設定 initialSurvey.inherit に従って写す（引き継ぎ）。
// 記録の項目名は、データ入力用ブックの項目のキー（設定 initialSurvey.book の columns）と同じにする。
//
// データ入力用ブックに手で入力済みの木は「ブックで入力済み」として、二重入力にならないよう知らせる。

import { branchRatioCell, branchRatioRaw, girthOf, heightRatioOf } from '../core/calc.js';
import { num, toHalf } from '../core/text.js';
import { isDead } from '../core/tree.js';
import { buildDetail, checkNumbers, circled, detailKeyOfItem, entriesOf, itemValueOf, manualKeyOf, partsKeyOf, partsOf, unchosenEntries } from '../core/detailParts.js';
import { fixWording, wordingIssues } from '../core/wording.js';
import { freeNotesOf, measureLinesOf, measuresToInitial, measuresWithLines, namesFromMeasures, splitNames } from '../core/noteMeasures.js';
import { chipOfLine, noteLines } from '../core/notes.js';
import { bookKey } from '../excel/initialBook.js';
import { INITIAL, initialKey, simpleKey, updateRecord } from './surveys.js';
import { touched } from './actions.js';
import { treesForDb } from './review.js';

const round2 = (x) => Math.round(x * 100) / 100;

// 詳しい診断の対象か（簡易診断で「必要」。削除した木は除く）
export const isInitialTarget = (tree, cfg) => !!cfg.initialSurvey && !tree.deleted && tree.initialNeeded === cfg.initial.yes;

// その木の記録（なければ null）
export function initialOf(state, tree, cfg) {
  const key = `initial|${simpleKey(tree, cfg)}`;
  return (state.initials || []).find((r) => initialKey(r, cfg) === key) || null;
}

// データ入力用ブックで入力済みか（読み込んだブックの、入力済みの行の一覧から）
export function inBook(state, tree, cfg) {
  const filled = state.initialBookInfo?.filled;
  if (!filled?.length) return false;
  const codeKey = cfg.dbFormat.sheets.find((x) => x.type === tree.siteType)?.code;
  return filled.includes(bookKey('initial', tree.siteType, codeKey ? tree[codeKey] : '', tree.treeNo));
}

// 詳しい診断の進み具合
//  'todo'（まだ記録がない）/ 'draft'（入力中）/ 'done'（入力済み）/ 'book'（ブックで入力済み）/ 'both'（アプリとブックの両方で入力済み）
export function initialStatus(tree, state, cfg) {
  const r = initialOf(state, tree, cfg);
  const book = inBook(state, tree, cfg);
  if (r?.done) return book ? 'both' : 'done';
  if (book) return 'book';
  return r ? 'draft' : 'todo';
}

// ブックで入力済みの木の本数（詳しい診断のシートの分だけ数える。植栽環境などのシートは数えない）
export const bookCount = (info) => (info?.filled || []).filter((k) => k.startsWith('initial|')).length;

export const INITIAL_STATUS_LABEL = { todo: '未入力', draft: '入力中', done: '入力済み', book: 'ブックで入力済み', both: 'アプリとブックの両方で入力済み' };

// 引き継ぎの値を1つ取り出す
//  from：簡易診断の木の項目名。「@」で始まるものは計算した値
//    @girth（幹周。株立は係数をかけた値）/ @heightRatio（樹高/幹径）/ @branchRatio（枝長/枝径。上限以上は表記の文字）
function sourceValue(tree, from, cfg) {
  if (from === '@girth') return girthOf(tree, cfg);
  if (from === '@heightRatio') return heightRatioOf(tree, cfg);
  if (from === '@branchRatio') {
    if (tree.source === 'ledger') return tree.ledgerBranchRatio || '';
    const c = branchRatioCell(tree, cfg);
    return typeof c === 'number' ? round2(c) : c;
  }
  const v = tree[from];
  return Array.isArray(v) ? v.join('・') : v;
}

// 確認用カルテにだけ出す値（設定 initialSurvey.karte の cells で「@」の名前で使う）
//  @girthList   … 幹周。株立は幹ごとの値を入力のまま「、」で並べる（例「2.1、0.80、0.90」）。単幹は詳しい診断の幹周
//  @heightRatio … 樹高/幹径（詳しい診断の樹高・幹周から。株立の幹周は（和）×係数の値）
//  @branchRatio … 枝長/枝径（上限以上でも表記の文字にせず数値。小数第2位まで。枯死は表記の文字）
//  @girthStems  … 株立の幹ごとの幹周を「、」で並べた文字（単幹は空）
//  @branchInput … 枝長/枝径を計算した入力の値（例「500/8」。入力がなければ空）
//  @heightInput … 樹高/幹径を計算した元の値「樹高/幹径」（m。樹高は小数第1位、幹径＝幹周÷円周率は小数第2位。例「16.0/0.58」）
//  tree：元の簡易診断の木（分からなければ null）、rec：詳しい診断の記録
export function karteExtras(tree, rec, cfg) {
  const stems = (tree?.girths || []).map((g) => toHalf(String(g ?? '')).trim()).filter(Boolean);
  const girthList = stems.length > 1 ? stems.join('、') : String(rec.girth ?? stems[0] ?? '');
  const h = num(rec.height);
  const g = num(rec.girth);
  const heightRatio = h && g ? Math.round(h / (g / cfg.calc.pi)) : '';
  let branchRatio = '';
  if (tree) {
    const raw = branchRatioRaw(tree);
    if (isDead(tree, cfg)) branchRatio = branchRatioCell(tree, cfg); // 枯死は表記の文字（例「-」）
    else if (raw != null) branchRatio = round2(raw);
    else if (tree.source === 'ledger') branchRatio = tree.ledgerBranchRatio || '';
  }
  const bl = toHalf(String(tree?.branchLen ?? '')).trim();
  const bd = toHalf(String(tree?.branchDia ?? '')).trim();
  return {
    '@girthList': girthList,
    '@girthStems': stems.length > 1 ? stems.join('、') : '',
    '@heightRatio': heightRatio,
    '@branchRatio': branchRatio,
    '@branchInput': bl && bd ? `${bl}/${bd}` : '',
    '@heightInput': h && g ? `${h.toFixed(1)}/${(g / cfg.calc.pi).toFixed(2)}` : '',
  };
}

// 確認用カルテに出す記録：詳しい診断の記録に、元の木から計算した値（karteExtras）を足したもの
//  弱点の詳細には、文に出さない入力の数（周囲長／幹周など）を【】で足す（確認用だけ。データ入力用ブックには足さない）
export function karteRecords(state, records, cfg) {
  const weak = Object.values(cfg.initialSurvey?.forms || {}).flatMap((f) => (f.sections || []).flatMap((s) => (s.items || []).filter((it) => it.type === 'weak')));
  return records.map((r) => {
    const tree = state.trees.find((t) => `initial|${simpleKey(t, cfg)}` === initialKey(r, cfg)) || null;
    const out = { ...r, ...karteExtras(tree, r, cfg) };
    const fromM = tree ? measuresToInitial(tree, cfg).values : {};
    for (const it of weak) {
      const dk = detailKeyOf(it);
      const pk = partsKeyOf(dk);
      // 文に出さない数（例 周囲長／幹周）を写す設定にする前に作った記録は、その数を持っていない。
      //  詳細の文が寸法から作った文のまま（手で直していない）なら、寸法の数で補って確認用に出す
      let vals = r[pk];
      if (fromM[pk] && vals && !r[manualKeyOf(dk)] && String(r[dk] ?? '') === String(fromM[dk] ?? '')) {
        vals = { ...vals };
        for (const p of partsOf(it, cfg)) if (p.noText && vals[p.name] === undefined && fromM[pk][p.name] !== undefined) vals[p.name] = fromM[pk][p.name];
      }
      const nums = checkNumbers(vals, partsOf(it, cfg));
      if (nums.length) out[dk] = `${r[dk] || ''}【${nums.join('、')}】`;
    }
    return out;
  });
}

// 簡易診断の木から、引き継ぐ値を作る。返す形：{ values: { 項目: 値 }, keys: [引き継いだ項目…] }
export function inheritFrom(tree, cfg) {
  const values = {};
  const keys = [];
  for (const [key, spec] of Object.entries(cfg.initialSurvey?.inherit || {})) {
    const s = typeof spec === 'string' ? { from: spec } : spec;
    let v = sourceValue(tree, s.from, cfg);
    if (v == null || v === '') continue;
    if (s.map && Object.prototype.hasOwnProperty.call(s.map, String(v))) v = s.map[String(v)];
    // 数字の文字は数にする（ブックの数の欄に、文字ではなく数で書くため）
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(toHalf(v).trim())) v = Number(toHalf(v).trim());
    values[key] = v;
    keys.push(key);
  }
  return { values, keys };
}

// ブックに入力済みの行の中身（なければ null）。返す形：{ initial?, environment?, dup? }（各書式の値と _sheet・_row）
export function bookEntry(state, tree, cfg) {
  const rows = state.initialBookInfo?.rows;
  if (!rows) return null;
  const codeKey = cfg.dbFormat.sheets.find((x) => x.type === tree.siteType)?.code;
  return rows[bookKey('', tree.siteType, codeKey ? tree[codeKey] : '', tree.treeNo).slice(1)] || null;
}

// ブックの値を、記録と同じ形（項目: 値）にする。行の番号などの印（_ で始まる項目）と、通し番号は入れない
export function bookValues(entry, cfg) {
  if (!entry) return null;
  const v = {};
  for (const form of ['environment', 'initial'])
    for (const [k, x] of Object.entries(entry[form] || {})) if (!k.startsWith('_') && k !== (cfg.initialSurvey?.serialKey || 'serial') && x !== '' && x != null) v[k] = x;
  return v;
}

// ---------- 簡易診断の寸法を、後から写す ----------
//  記録を作ったときに写した寸法は、その後に簡易診断で足したり直したりしても写らない。
//  そこで、写した時点の寸法の写し（measureSig）と今の寸法を比べ、変わった・まだ写していない弱点の項目を知らせる。
//  写すのは人がボタンを押したときだけ（初期診断で手で直した内容を、黙って置き換えないため）
const sigOf = (v) => JSON.stringify(v ?? null);

// 簡易診断の寸法と、詳しい診断の弱点の詳細の関係。返す形：[{ key: 詳細の項目, label, follow, differs, simpleText }]
//  follow：詳しい診断の画面で直していない（写した時点のまま）→ 簡易診断の寸法に自動で合わせる
//  differs：今の詳細が簡易診断の寸法と違う（follow でないときは「簡易の寸法と違います」と出す）
//  簡易診断で消した寸法（前に写したもの）も入る（follow なら詳細を消す）
export function measureStatus(rec, tree, cfg) {
  if (!rec || !tree) return [];
  const ms = measuresToInitial(tree, cfg);
  const keys = [...new Set([...ms.keys, ...Object.keys(rec.measureSig || {})])];
  return keys.map((dk) => {
    const pk = partsKeyOf(dk);
    const now = sigOf(ms.values[pk]);
    const sig = rec.measureSig?.[dk];
    const mine = sigOf(rec[pk]);
    const blank = isEmpty(rec[dk]) && rec[pk] == null; // 詳しい診断で何も入れていない
    const follow = !rec[manualKeyOf(dk)] && (sig !== undefined ? mine === sig : blank || mine === now);
    // 違うのは、簡易診断に入っている値と食い違うときだけ（初期で足した欄・箇所は違いにしない）。簡易で消した寸法は、詳細が残っていれば違い
    const differs = dk in ms.values ? conflicts(rec[pk], ms.values[pk]) : rec[pk] != null || !isEmpty(rec[dk]);
    const item = itemByDetailKey(cfg, dk);
    return { key: dk, label: item?.label || dk, follow, differs, simpleText: ms.values[dk] || '' };
  });
}

// 詳しい診断で直していない項目を、簡易診断の寸法に合わせた記録を返す。返す形：{ record, changed: [弱点の名前…] }
export function syncMeasures(rec, tree, cfg) {
  // ついてくる項目は、中身全体が簡易診断と同じでなければ写し直す（簡易で消した欄も消すため、differs ではなく全体で比べる）
  const ms = measuresToInitial(tree, cfg);
  const whole = (dk) => sigOf(rec[partsKeyOf(dk)]) !== sigOf(ms.values[partsKeyOf(dk)]) || String(rec[dk] ?? '') !== String(ms.values[dk] ?? '');
  const keys = measureStatus(rec, tree, cfg)
    .filter((x) => x.follow && (whole(x.key) || rec.measureSig?.[x.key] === undefined))
    .map((x) => x.key);
  if (!keys.length) return { record: rec, changed: [] };
  const next = applyMeasures(rec, tree, cfg, keys);
  // 中身が同じ（印を付けただけ）なら、変わったことにしない
  const changed = keys.filter((dk) => sigOf(next[partsKeyOf(dk)]) !== sigOf(rec[partsKeyOf(dk)]) || String(next[dk] ?? '') !== String(rec[dk] ?? ''));
  return { record: next, changed: changed.map((dk) => itemByDetailKey(cfg, dk)?.label || dk) };
}

// 値が入っているか（空の文字・null は入っていない。false は「付けない」を選んだので入っている）
const filled = (v) => v != null && String(v).trim() !== '';
const same = (a, b) => toHalf(String(a ?? '')).trim() === toHalf(String(b ?? '')).trim();

// 簡易診断の値（simple）のうち、詳しい診断の値（mine）と食い違うものがあるか。
//  簡易に入っている欄ごとに比べる（箇所の並び more・大きさの並びも、何番目かで比べる）。簡易にない欄・箇所が初期にあっても違いにしない
function conflicts(mine, simple) {
  if (simple && typeof simple === 'object') {
    return Object.keys(simple).some((k) => conflicts(mine && typeof mine === 'object' ? mine[k] : undefined, simple[k]));
  }
  if (!filled(simple)) return false;
  return mine && typeof mine === 'object' ? true : !same(mine, simple);
}

// 詳しい診断の値に、簡易診断に入っている値だけを上書きした値（初期で足した欄・箇所は残す）
function mergeValues(mine, simple) {
  if (Array.isArray(simple)) {
    const base = Array.isArray(mine) ? mine : [];
    return Array.from({ length: Math.max(base.length, simple.length) }, (_, i) => (i < simple.length ? mergeValues(base[i], simple[i]) : structuredClone(base[i])));
  }
  if (simple && typeof simple === 'object') {
    const base = mine && typeof mine === 'object' && !Array.isArray(mine) ? mine : {};
    const out = structuredClone(base);
    for (const k of Object.keys(simple)) out[k] = mergeValues(base[k], simple[k]);
    return out;
  }
  return filled(simple) ? simple : mine;
}

// 「簡易に合わせる」を押したときに変わる所（押す前に見せる）。返す形：{ before: 今の詳細の文, after: 合わせた後の文 }
export function matchPreview(rec, tree, cfg, dk) {
  const next = applyMeasures(rec, tree, cfg, [dk], { merge: true });
  return { before: String(rec[dk] ?? ''), after: String(next[dk] ?? '') };
}

// 寸法を写す（keys の項目だけ）。簡易診断で消した寸法なら、詳細を消す
//  merge：「簡易に合わせる」のとき。簡易に入っている値だけを置き換え、初期で足した欄・箇所は残す。
//         merge でない（自動で合わせる。初期で直していない項目）ときは、簡易の値をそのまま写す（簡易で消した欄も消える）
export function applyMeasures(rec, tree, cfg, keys, { merge = false } = {}) {
  const ms = measuresToInitial(tree, cfg);
  const next = { ...rec, measureSig: { ...(rec.measureSig || {}) } };
  for (const dk of keys) {
    const pk = partsKeyOf(dk);
    delete next[manualKeyOf(dk)]; // 手で直した文の印を外す（写した数値から文を作り直す）
    if (!(dk in ms.values)) {
      delete next[pk];
      next[dk] = '';
      delete next.measureSig[dk];
      continue;
    }
    next.measureSig[dk] = sigOf(ms.values[pk]);
    const item = merge && rec[pk] != null ? itemByDetailKey(cfg, dk) : null;
    if (item) {
      next[pk] = mergeValues(rec[pk], ms.values[pk]);
      next[dk] = buildDetail(next[pk], partsOf(item, cfg), cfg);
      const iv = itemValueOf(item, next[pk], cfg); // 有無の選択肢も数値から決まる項目（例 開口空洞）
      if (iv) next[item.key] = iv;
    } else {
      next[dk] = ms.values[dk];
      next[pk] = structuredClone(ms.values[pk]);
      const ch = ms.choices?.[dk]; // 有無の選択肢も数値から決まる項目（例 開口空洞）
      if (ch) next[ch.key] = ch.value;
    }
    next.inherited = [...new Set([...(rec.inherited || []), dk])];
  }
  return next;
}

// 簡易診断の木を保存した後などに、その木の詳しい診断の記録を簡易診断の寸法に合わせる（記録がなければそのまま）
export function syncInitialOfTree(state, treeId, cfg) {
  if (!cfg.initialSurvey?.fromMeasures?.length) return state;
  const tree = state.trees.find((t) => t.id === treeId);
  const rec = tree && initialOf(state, tree, cfg);
  if (!rec) return state;
  const r = syncMeasures(rec, tree, cfg);
  // 中身が変わったときだけ直す（印だけ付けて送り直したり、確定を外したりしない）
  return r.changed.length ? updateInitial(state, rec.id, () => r.record) : state;
}

function itemByDetailKey(cfg, dk) {
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections || []) for (const it of sec.items || []) if (it.type === 'weak' && detailKeyOfItem(it) === dk) return it;
  return null;
}

// 記録を作る（すでにあれば何もしない）。返す形：{ state, record, created }
//  元の木を見分ける項目（シートの種類・番号・何本目・uid）と場所の情報を写し、簡易診断の値を引き継ぐ
//  ブックで入力済みの木は、force を付けたときだけ作る。そのときはブックの値を下書きにする（引き継ぎより優先）
export function startInitial(state, tree, cfg, { now = new Date().toISOString(), force = false } = {}) {
  if (!isInitialTarget(tree, cfg)) throw new Error('詳しい診断の対象ではない木です');
  const found = initialOf(state, tree, cfg);
  if (found) return { state, record: found, created: false };
  if (inBook(state, tree, cfg) && !force) throw new Error('データ入力用ブックに入力済みの木です（二重入力になります）');
  const copy = {};
  for (const k of ['siteType', 'treeNo', 'dupIndex', 'uid', 'species', ...cfg.dbFormat.infoKeys])
    if (tree[k] !== undefined && tree[k] !== '') copy[k] = tree[k];
  const { values, keys } = inheritFrom(tree, cfg);
  const fromBook = bookValues(bookEntry(state, tree, cfg), cfg) || {};
  // 特記事項に足した寸法から、弱点の詳細（数値と文）を作る。ブックに詳細があればブックを使う
  const ms = measuresToInitial(tree, cfg);
  const measureKeys = ms.keys.filter((dk) => !(dk in fromBook));
  const fromMeasures = {};
  for (const dk of measureKeys) {
    Object.assign(fromMeasures, { [dk]: ms.values[dk], [partsKeyOf(dk)]: ms.values[partsKeyOf(dk)] });
    const ch = ms.choices?.[dk]; // 有無の選択肢も数値から決まる項目（例 開口空洞の芯到達・周囲長比）。ブックに値があればブック
    if (ch && !(ch.key in fromBook)) fromMeasures[ch.key] = ch.value;
  }
  if (measureKeys.length) fromMeasures.measureSig = Object.fromEntries(measureKeys.map((dk) => [dk, sigOf(ms.values[partsKeyOf(dk)])]));
  const record = {
    id: `ini:${tree.id}`,
    ...copy,
    ...values,
    ...fromMeasures,
    ...fromBook,
    inherited: [...keys.filter((k) => !(k in fromBook)), ...measureKeys], // 簡易診断から写した項目（画面で「簡易から」と示す）
    ...(Object.keys(fromBook).length ? { fromBook: Object.keys(fromBook) } : {}), // ブックから写した項目
    source: 'app',
    done: false,
    sent: false,
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, [INITIAL.list]: [...(state[INITIAL.list] || []), record] }, record, created: true };
}

// 対象の木の一覧（並びは木の一覧のまま）。返す形：[{ tree, record, status }]
export function initialTargets(state, cfg, trees = state.trees) {
  return trees
    .filter((t) => isInitialTarget(t, cfg))
    .map((tree) => ({ tree, record: initialOf(state, tree, cfg), status: initialStatus(tree, state, cfg) }));
}

// ---------- 入力画面 ----------

// 書式（initial／environment）の画面の並び（設定 initialSurvey.forms）。なければ null
export const formOf = (cfg, form) => cfg.initialSurvey?.forms?.[form] || null;

// 「有」のときの詳細を入れる項目の名前
export const detailKeyOf = detailKeyOfItem;

// 項目の選択肢：設定にあればそれ、なければデータ入力用ブックの入力規則（ドロップダウン）
export function optionsOf(item, state, form, siteType) {
  if (item.options?.length) return item.options;
  return state.initialBookInfo?.options?.[`${form}|${siteType || ''}`]?.[item.key] || null;
}

const isEmpty = (v) => v == null || String(v).trim() === '';
const NONE = (cfg) => cfg.initialSurvey?.noneValue || '無';

// 「この区切りはすべて無」：区切りの中の、まだ選んでいない選択肢の項目に「無」を入れる（選んである項目は変えない）
//  項目に設定 noneValue（例「支柱なし」）があれば、「無」の代わりにその値を入れる（物そのものが無いときの選択肢）
//  詳細が入っている弱点の項目（簡易診断の寸法から写った・手で書いた）は「無」にしない（有無を選んでもらう）
//  返す形：{ record, keys: [入れた項目…], custom: noneValue を入れた項目があったか, kept: [詳細があるので残した項目の名前…] }
export function fillNone(record, section, cfg, optionsFor) {
  const keys = [];
  const kept = [];
  const next = { ...record };
  let custom = false;
  for (const it of section.items) {
    if (!['choice', 'weak'].includes(it.type) || !isEmpty(next[it.key])) continue;
    if (it.type === 'weak' && !isEmpty(next[detailKeyOf(it)])) {
      kept.push(it.label);
      continue;
    }
    const opts = optionsFor(it) || [];
    const value = it.noneValue && opts.includes(it.noneValue) ? it.noneValue : NONE(cfg);
    if (!opts.includes(value)) continue;
    next[it.key] = value;
    keys.push(it.key);
    if (value !== NONE(cfg)) custom = true;
  }
  return { record: next, keys, custom, kept };
}

// 入力の食い違いの注意（保存のときに確かめる。返す形：[文…]）
//  1. 弱点の項目に詳細（寸法など）が入っているのに、有無が「無」か未選択
//  2. 簡易診断で「有」の点検項目に対応する詳しい診断の項目が、どれも「有」になっていない
//     （設定 initialSurvey.crossCheck：[{ field: 簡易診断の項目, eq: 値 か [値…], items: [詳しい診断の弱点の項目…], label? }]）
export function initialWarnings(record, tree, cfg) {
  const out = [];
  if (!record) return out;
  const items = new Map();
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections || [])
      for (const it of sec.items || []) if (it.type === 'weak') items.set(it.key, { it, name: `${String(sec.title || '').split('・').pop()}の${it.label}` });
  const isYes = (it, v) => !isEmpty(v) && v !== NONE(cfg) && v !== it.noneValue;
  for (const { it, name } of items.values()) {
    if (isEmpty(record[detailKeyOf(it)]) || isYes(it, record[it.key])) continue;
    out.push(`${name}：詳細が入っていますが「${isEmpty(record[it.key]) ? '未選択' : record[it.key]}」です`);
  }
  // 必ず選ぶ印（例 芯達か芯未達か）を選んでいない箇所（「有」の項目だけ。子実体だけの箇所は除く）
  for (const { it, name } of items.values()) {
    if (!isYes(it, record[it.key])) continue;
    const parts = partsOf(it, cfg);
    const miss = unchosenEntries(record[partsKeyOf(detailKeyOf(it))], parts);
    if (!miss.length) continue;
    const labels = parts.filter((p) => p.type === 'flag' && p.required === true).map((p) => `${p.label}か${p.offLabel || `${p.label}でない`}か`);
    const where = entriesOf(record[partsKeyOf(detailKeyOf(it))]).length > 1 ? miss.map((i) => circled(i)).join('') + 'の' : '';
    out.push(`${name}：${where}${labels.join('・')}を選んでください`);
  }
  // 組になる項目（例 支柱の2項目）：どれかが決まった値（例「支柱なし」）なのに、ほかが別の値
  const labelOf = new Map();
  for (const form of Object.values(cfg.initialSurvey?.forms || {})) for (const sec of form.sections || []) for (const it of sec.items || []) labelOf.set(it.key, it.label);
  for (const rule of cfg.initialSurvey?.linked || []) {
    const hit = rule.items.find((k) => record[k] === rule.value);
    if (!hit) continue;
    for (const k of rule.items)
      if (k !== hit && !isEmpty(record[k]) && record[k] !== rule.value)
        out.push(`${labelOf.get(hit) || hit}が「${rule.value}」ですが、${labelOf.get(k) || k}は「${record[k]}」です`);
  }
  for (const rule of cfg.initialSurvey?.crossCheck || []) {
    const v = tree?.[rule.field];
    if (!tree || isEmpty(v) || ![].concat(rule.eq).includes(v)) continue;
    const targets = rule.items.map((k) => items.get(k)).filter(Boolean);
    if (!targets.length || targets.some(({ it }) => isYes(it, record[it.key]))) continue;
    const label = rule.label || cfg.checks?.find((c) => c.key === rule.field)?.label || rule.field;
    out.push(`簡易診断で${label}が「${v}」ですが、${targets.map((x) => x.name).join('・')}${targets.length > 1 ? 'のどれも' : 'が'}「有」になっていません`);
  }
  // 簡易診断の特記事項（定型文）・⑦などの入力が、詳しい診断に反映されていない（設定 noteCheck）
  for (const x of simpleNotesStatus(record, tree, cfg)) if (x.state === 'missing') out.push(`簡易診断の「${x.text}」：${x.note}`);
  return out;
}

// 簡易診断の特記事項（と⑦などの入力）が、詳しい診断に反映されているか。詳しい診断の画面の一覧と、保存の前の注意に使う
//  返す形：[{ text, kind, state, note }]（反映されていないものを先に）
//    kind：measure（寸法の1行）・chip（定型文）・field（簡易診断の項目。例 ⑦子実体の種名）・free（手で書いた行）
//    state：missing（反映されていない）・none（写す項目がない）・ok（反映されている）・free（判断しない）
//  設定 initialSurvey.noteCheck（省略可）：
//    { notes: [定型文の文…], items: [項目…] }  その定型文があれば、items のどれかが「有」（選択肢の項目は「無」以外）なら反映済み
//    { field: 簡易診断の項目, items: [弱点の項目…] }  その項目の名前（「、」区切り。details の when のときだけ。寸法の toTree から入った名前は除く）が、
//      items のどれかの詳細の文にあれば反映済み。alias（{ 名前: [同じとみなす名前…] }）で表記の違いを同じとみなす
export function simpleNotesStatus(record, tree, cfg) {
  if (!tree) return [];
  const items = itemNames(cfg);
  const nameOf = (k) => items.get(k)?.name || k;
  const isYes = (k) => {
    const it = items.get(k)?.it;
    const v = record?.[k];
    return !isEmpty(v) && v !== NONE(cfg) && v !== it?.noneValue;
  };
  const label0 = cfg.initialSurvey?.label || '詳しい診断';
  const checks = cfg.initialSurvey?.noteCheck || [];
  const out = [];
  // 寸法の1行：写す規則があれば、その項目に自動で写る
  const rules = cfg.initialSurvey?.fromMeasures || [];
  const seen = new Set();
  for (const m of measuresWithLines(tree, cfg)) {
    if (!m.line || seen.has(m.line)) continue;
    seen.add(m.line);
    const rule = rules.find((r) => r.kind === m.kind && (r.place == null || r.place === m.place));
    out.push(rule ? { text: m.line, kind: 'measure', state: 'ok', note: `${nameOf(rule.item)}に写ります` } : { text: m.line, kind: 'measure', state: 'none', note: `${label0}に写す項目がありません` });
  }
  // 定型文と手で書いた行
  for (const line of noteLines(freeNotesOf(tree, cfg))) {
    if (seen.has(line)) continue;
    const chip = chipOfLine(line, cfg);
    const rule = chip && checks.find((r) => Array.isArray(r.notes) && r.notes.some((t) => t === chip.t || (chip.was || []).includes(t)));
    if (!rule) {
      out.push({ text: line, kind: chip ? 'chip' : 'free', state: 'free', note: chip ? '対応する項目なし（見て確かめる）' : '手で書いた行（見て確かめる）' });
      continue;
    }
    const hit = rule.items.filter(isYes);
    out.push(
      hit.length
        ? { text: line, kind: 'chip', state: 'ok', note: `${hit.map(nameOf).join('・')}が「有」` }
        : { text: line, kind: 'chip', state: 'missing', note: `${rule.items.map(nameOf).join('・')}${rule.items.length > 1 ? 'のどれも' : 'が'}「有」になっていません` },
    );
  }
  // 簡易診断の項目（例 ⑦子実体の種名）
  for (const rule of checks) {
    if (!rule.field) continue;
    const d = (cfg.details || []).find((x) => x.field === rule.field);
    if (d?.when && tree[d.when.field] !== d.when.eq) continue;
    const taken = namesFromMeasures(tree, rule.field, cfg);
    const label = rule.label || d?.label || rule.field;
    for (const name of splitNames(tree[rule.field]).filter((x) => !taken.has(x))) {
      // alias：同じとみなす名前（例 { "不明種": ["不明"] }）
      const names = [name, ...((rule.alias || {})[name] || [])];
      const inDetail = rule.items.filter((k) => names.some((n) => String(record?.[detailKeyOf(items.get(k)?.it || { key: k })] ?? '').includes(n)));
      out.push(
        inDetail.length
          ? { text: `${label}：${name}`, kind: 'field', state: 'ok', note: `${inDetail.map(nameOf).join('・')}にあります` }
          : { text: `${label}：${name}（寸法なし）`, kind: 'field', state: 'missing', note: `${label0}に写っていません。位置などを入れてください` },
      );
    }
  }
  const order = { missing: 0, none: 1, ok: 2, free: 3 };
  return out.map((x, i) => ({ ...x, i })).sort((a, b) => order[a.state] - order[b.state] || a.i - b.i).map(({ i: _i, ...x }) => x);
}

// 入力画面の項目の名前（弱点は「区切りの名前の項目名」。例「根系の②露出根の腐朽」）
function itemNames(cfg) {
  const m = new Map();
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections || [])
      for (const it of sec.items || []) m.set(it.key, { it, name: it.type === 'weak' ? `${String(sec.title || '').split('・').pop()}の${it.label}` : it.label });
  return m;
}

// 入力していない現場の項目（選択肢の項目だけ数える。「後で（机上）」の項目は数えない）。返す形：[項目名…]
export function missingInitial(record, cfg) {
  const out = [];
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections)
      for (const it of sec.items) if (['choice', 'weak'].includes(it.type) && !it.desk && isEmpty(record[it.key])) out.push(it.label);
  return out;
}

// 記録を1件変える（入力済みなら送り直しの印を付ける）
export const updateInitial = (state, id, fn) => updateRecord(state, INITIAL, id, (r) => touched(fn(r)));

// 保存：入力済みにして、調査日・調査者を記録する（設定 initialSurvey.stamp の項目へ。入力済みの記録を直したときは元のまま）
//  返す形：{ state, missing, saved }
export function saveInitial(state, id, cfg, { force = false, now = new Date().toISOString() } = {}) {
  const r = (state.initials || []).find((x) => x.id === id);
  if (!r) return { state, missing: [], warnings: [], saved: false };
  const missing = missingInitial(r, cfg);
  const tree = state.trees?.find((t) => `initial|${simpleKey(t, cfg)}` === initialKey(r, cfg)) || null;
  const warnings = initialWarnings(r, tree, cfg);
  if ((missing.length || warnings.length) && !force) return { state, missing, warnings, saved: false };
  const st = cfg.initialSurvey?.stamp || {};
  const stamp = {};
  const [y, m, d] = String(state.session?.date || '').split('-').map(Number);
  // 調査日・調査者は初めて入力済みにしたときだけ入れる（入力済みの記録を後日直しても元のまま）
  const hasDate = r.done && st.date && st.date.every((k) => !isEmpty(r[k]));
  const hasInspector = r.done && st.inspector && !isEmpty(r[st.inspector]);
  if (st.date && y && !hasDate) [stamp[st.date[0]], stamp[st.date[1]], stamp[st.date[2]]] = [y, m, d];
  if (st.inspector && state.session?.inspector && !hasInspector) stamp[st.inspector] = state.session.inspector;
  // 空欄のときに入れる値（項目の blank。例：枝下高がなければ「-」）
  const blanks = {};
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections) for (const it of sec.items) if (it.blank != null && isEmpty(r[it.key])) blanks[it.key] = it.blank;
  const next = updateRecord(state, INITIAL, id, (x) => ({ ...x, ...blanks, ...stamp, done: true, sent: false, source: 'app', updatedAt: now }));
  return { state: next, missing, warnings, saved: true };
}

// ---------- 一覧表の健全度への書き戻し ----------

// 処置の文を比べるための形（全角・半角、空白、区切りの違いは無視する）
const treatForm = (s) => toHalf(String(s ?? '')).replace(/[\s　]/g, '').replace(/[、,，]/g, '・');

// 一覧表に書く木に、詳しい診断の結果（設定 initialSurvey.gradeWriteBack.from）を健全度として付ける
//  書くのは、詳しい診断の記録がブックに出せる状態（入力済み・確定。initialsForBook と同じ）で、値が values のどれかのときだけ。
//  一覧表の処置は書き換えない。詳しい診断の処置（treatFrom）と違えば知らせるだけ。
//  台帳で入力済みの木（紙から手で入力した行）にも initialGrade を付ける。一覧表に書くときは健全度の欄だけ、空欄のときだけ書く（exportDb）。
//  返す形：{ trees（initialGrade を付けた木）, written: [{ tree, grade }], treatDiff: [{ tree, simple, initial }],
//            ledger: [{ tree, grade }]（台帳で入力済みの行。健全度だけ書く）, pending: [tree]（詳しい診断の結果がまだない） }
export function gradeWriteBack(state, cfg, trees, { includeUnconfirmed = false, treatOf = () => '' } = {}) {
  const gw = cfg.initialSurvey?.gradeWriteBack;
  const out = { trees, written: [], treatDiff: [], ledger: [], pending: [] };
  if (!gw) return out;
  const ready = new Map(initialsForBook(state, cfg, { includeUnconfirmed }).records.map((r) => [initialKey(r, cfg), r]));
  out.trees = trees.map((t) => {
    if (!isInitialTarget(t, cfg)) return t;
    const r = ready.get(`initial|${simpleKey(t, cfg)}`);
    const grade = r ? String(r[gw.from] ?? '').trim() : '';
    if (!gw.values.includes(grade)) {
      if (t.source === 'app' && t.done) out.pending.push(t);
      return t;
    }
    if (t.source !== 'app') {
      out.ledger.push({ tree: t, grade });
      return { ...t, initialGrade: grade };
    }
    out.written.push({ tree: t, grade });
    const it = gw.treatFrom ? String(r[gw.treatFrom] ?? '').trim() : '';
    const st = treatOf(t);
    if (it && treatForm(it) !== treatForm(st)) out.treatDiff.push({ tree: t, simple: st, initial: it });
    return { ...t, initialGrade: grade };
  });
  return out;
}

// ---------- 表記の統一（設定 wording） ----------
// 調べる文：文字の項目（text・textarea）と、弱点の詳細
function wordingFields(cfg) {
  const out = [];
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections || [])
      for (const it of sec.items || []) {
        if (['text', 'textarea'].includes(it.type)) out.push({ key: it.key });
        if (it.type === 'weak') out.push({ key: detailKeyOf(it), item: it });
      }
  return out;
}

// 当てはまる決まり（説明の一覧）
export function initialWordingIssues(rec, cfg) {
  if (!cfg.wording?.length || !rec) return [];
  return [...new Set(wordingFields(cfg).flatMap((f) => wordingIssues(rec[f.key], cfg)))];
}

// 表記を直した記録。数値から組み立てた詳細は、文字の数値（種名・その他など）を直して組み立て直す（数値との結び付きを保つ）
export function fixInitialWording(rec, cfg) {
  const next = { ...rec };
  for (const f of wordingFields(cfg)) {
    const v = rec[f.key];
    if (v == null || v === '' || !wordingIssues(v, cfg).length) continue;
    const parts = f.item ? partsOf(f.item, cfg) : [];
    const pk = partsKeyOf(f.key);
    // 文が数値から組み立てたままのとき（数値と文が合っているとき）だけ、数値を直して組み立て直す。合わなければ文を直す（書き足しを消さない）
    if (parts.length && rec[pk] && !rec[manualKeyOf(f.key)] && buildDetail(rec[pk], parts, cfg) === v) {
      const values = { ...rec[pk] };
      for (const p of parts) if (p.type === 'text' && typeof values[p.name] === 'string') values[p.name] = fixWording(values[p.name], cfg);
      const rebuilt = buildDetail(values, parts, cfg);
      if (!wordingIssues(rebuilt, cfg).length) {
        Object.assign(next, { [pk]: values, [f.key]: rebuilt });
        continue;
      }
    }
    next[f.key] = fixWording(v, cfg);
    if (parts.length && rec[pk]) next[manualKeyOf(f.key)] = true; // 文を直接直したので、数値から作り直さない印
  }
  return next;
}

// ---------- 入力の取り消し（調査者の操作） ----------

// 入力済みの記録を未入力に戻す（値は下書きとして残し、未入力に戻ったことを送る。確定していれば、版が変わるので確定は外れる）
export function withdrawInitial(state, id, now = new Date().toISOString()) {
  const r = (state.initials || []).find((x) => x.id === id);
  if (!r) return state;
  if (!r.done || r.source !== 'app') throw new Error('アプリで入力済みの記録だけ取り消せます');
  if (r.conflict) throw new Error('別の端末との食い違いがあります。先にどちらを使うか選んでください');
  return updateRecord(state, INITIAL, id, (x) => ({ ...x, done: false, sent: false, updatedAt: now }));
}

// まだサーバーに送っていない下書きの記録を消す（記録を作る前に戻す。間違えて作ったとき用）
//  サーバーに届いた記録（版がある）は消さない（他の端末にも残るため。未入力に戻すを使う）
export function discardInitial(state, id) {
  const r = (state.initials || []).find((x) => x.id === id);
  if (!r) return state;
  if (r.done) throw new Error('入力済みの記録は消せません（先に未入力に戻してください）');
  if (r.rev > 0) throw new Error('サーバーに届いている記録は消せません');
  return { ...state, [INITIAL.list]: state[INITIAL.list].filter((x) => x.id !== id) };
}

// ---------- データ入力用ブックへの書き込み ----------

// ブックに書き込む記録を選ぶ
//  入力済み・アプリで入力・元の木が今も詳しい診断の対象（削除していない・「必要」のまま）の記録だけ。
//  サーバーを使うときは、確定した記録だけ（includeUnconfirmed で未確定も含める）。
//  返す形：{ records, excluded: [未確定の記録…], notTarget: [元の木が対象でなくなった記録…] }
export function initialsForBook(state, cfg, { includeUnconfirmed = false } = {}) {
  const notTarget = [];
  const isTarget = (r) => {
    const tree = state.trees.find((t) => `initial|${simpleKey(t, cfg)}` === initialKey(r, cfg));
    return !!tree && isInitialTarget(tree, cfg);
  };
  const { trees: picked, excluded } = treesForDb(state, cfg, { includeUnconfirmed }, INITIAL);
  const records = picked.filter((r) => {
    if (!r.done || r.source !== 'app') return false;
    if (isTarget(r)) return true;
    notTarget.push(r);
    return false;
  });
  // 未確定の記録（元の木が対象でなくなったものは notTarget の方に入れる）
  const unconfirmed = excluded.filter((r) => {
    if (isTarget(r)) return true;
    notTarget.push(r);
    return false;
  });
  return { records, excluded: unconfirmed, notTarget };
}
