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
import { buildDetail, checkNumbers, detailKeyOfItem, manualKeyOf, partsKeyOf, partsOf } from '../core/detailParts.js';
import { fixWording, wordingIssues } from '../core/wording.js';
import { measuresToInitial } from '../core/noteMeasures.js';
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
    for (const it of weak) {
      const dk = detailKeyOf(it);
      const nums = checkNumbers(r[partsKeyOf(dk)], partsOf(it, cfg));
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
  for (const dk of measureKeys) Object.assign(fromMeasures, { [dk]: ms.values[dk], [partsKeyOf(dk)]: ms.values[partsKeyOf(dk)] });
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
//  返す形：{ record, keys: [入れた項目…], custom: noneValue を入れた項目があったか }
export function fillNone(record, section, cfg, optionsFor) {
  const keys = [];
  const next = { ...record };
  let custom = false;
  for (const it of section.items) {
    if (!['choice', 'weak'].includes(it.type) || !isEmpty(next[it.key])) continue;
    const opts = optionsFor(it) || [];
    const value = it.noneValue && opts.includes(it.noneValue) ? it.noneValue : NONE(cfg);
    if (!opts.includes(value)) continue;
    next[it.key] = value;
    keys.push(it.key);
    if (value !== NONE(cfg)) custom = true;
  }
  return { record: next, keys, custom };
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

// 保存：入力済みにして、調査日・調査者を記録する（設定 initialSurvey.stamp の項目へ）
//  返す形：{ state, missing, saved }
export function saveInitial(state, id, cfg, { force = false, now = new Date().toISOString() } = {}) {
  const r = (state.initials || []).find((x) => x.id === id);
  if (!r) return { state, missing: [], saved: false };
  const missing = missingInitial(r, cfg);
  if (missing.length && !force) return { state, missing, saved: false };
  const st = cfg.initialSurvey?.stamp || {};
  const stamp = {};
  const [y, m, d] = String(state.session?.date || '').split('-').map(Number);
  if (st.date && y) [stamp[st.date[0]], stamp[st.date[1]], stamp[st.date[2]]] = [y, m, d];
  if (st.inspector && state.session?.inspector) stamp[st.inspector] = state.session.inspector;
  // 空欄のときに入れる値（項目の blank。例：枝下高がなければ「-」）
  const blanks = {};
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections) for (const it of sec.items) if (it.blank != null && isEmpty(r[it.key])) blanks[it.key] = it.blank;
  const next = updateRecord(state, INITIAL, id, (x) => ({ ...x, ...blanks, ...stamp, done: true, sent: false, source: 'app', updatedAt: now }));
  return { state: next, missing, saved: true };
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
