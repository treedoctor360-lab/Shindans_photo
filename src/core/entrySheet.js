// 入力表（Excel。1本1行。紙の野帳をそのまま写した表）から木を作る
//  内勤が紙の野帳のとおりに打った表を読み込み、アプリの木にする。画面で1本ずつ打つ代わり。
//  表の形と、備考の略記の読み方は設定 entrySheet に置く（業務ごとに違うため）：
//    skipSheets … 読まないシートの名前（正規表現の一覧。例 使い方・見本）
//    info       … まとまりの情報のセル { addGroups.fields の key: セル }（例 { routeName: "C1" }）
//    infoDefault … 空の項目を、ほかの項目の値で埋める { 項目: 写す元の項目 }（省略可）
//    date・inspector … 調査日・調査者のセル
//    dataRow    … 木の最初の行
//    columns    … 列 { 木の項目: 列の文字 }。特別な名前：girth（幹周）・branch（「枝長/枝径」の形）・remarks（備考）
//    values     … 値の読み替え { 表の文字: アプリの値 }（例 { "－": "無", "1": "有" }）
//    blank      … 空として読む文字（例 ["-", "－"]）
//    same       … 「上の行と同じ」の文字（例 ["〃"]。樹種で使う）
//    remarks    … 備考の読み方の一覧。上から順に当て、当てはまった所を備考から取り除く。残った文字は「読み取れなかった備考」として木に残す
//       { re: 正規表現, flags?, measure?: { kind, place?, values }, note?: 特記事項に足す文, set?: { 項目: 値 }, felled?: true }
//       measure・note・set の中の文字は、$1・$2… を正規表現の（ ）の中身で置き換える
// ここは Excel に依存しない（行の読み取りは src/excel/entrySheetRead.js）。
import { toHalf } from './text.js';
import { blankTree } from './tree.js';
import { groupKey } from './groups.js';
import { missingFields } from './rules.js';
import { putMeasure, appendNoteLine } from './noteMeasures.js';

const str = (v) => String(v ?? '').trim();
const half = (v) => toHalf(str(v));

// $1・$2… を置き換える（文字・配列・オブジェクトの中の文字すべて）
function fillGroups(v, m) {
  if (typeof v === 'string') return v.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '');
  if (Array.isArray(v)) return v.map((x) => fillGroups(x, m));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillGroups(x, m)]));
  return v;
}

// 寸法の値のうち、中身が空のものを除く（「H=m」のような空の文を作らないため）
function dropEmpty(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof v === 'string') {
      if (v.trim()) out[k] = v.trim();
    } else if (Array.isArray(v)) {
      const list = v.filter((x) => Object.values(x || {}).some((y) => str(y)));
      if (list.length) out[k] = list;
    } else if (v && typeof v === 'object') {
      if (Object.values(v).some((y) => str(y))) out[k] = v;
    } else if (v != null) out[k] = v;
  }
  return out;
}

// 備考を読む。返す形：{ measures: [{ kind, place, values }], notes: [文…], set: { 項目: 値 }, felled, left: 読み取れなかった文字 }
export function readRemarks(text, es) {
  let rest = half(text).replace(/[〜~]/g, '～');
  const out = { measures: [], notes: [], set: {}, felled: false, left: '' };
  for (const rule of es.remarks || []) {
    const re = new RegExp(rule.re, `g${(rule.flags || '').replace(/g/g, '')}`);
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, args.findIndex((x) => typeof x === 'number')); // [全体, $1, $2…]
      if (rule.measure) out.measures.push({ kind: rule.measure.kind, place: fillGroups(rule.measure.place || '', m), values: dropEmpty(fillGroups(rule.measure.values || {}, m)) });
      if (rule.note) out.notes.push(fillGroups(rule.note, m));
      if (rule.set) Object.assign(out.set, fillGroups(rule.set, m));
      if (rule.felled) out.felled = true;
      return ' ';
    });
  }
  out.left = rest.replace(/[\s、,／/・]+/g, ' ').trim();
  return out;
}

// まとまりの情報：路線番号が設定の一覧（addGroups.presets）の1件だけに当たれば、その一覧の値を使う（打ち方の違いで別の路線にならないように）
function groupInfo(typed, cfg) {
  const ag = cfg.addGroups;
  const info = { siteType: ag.siteType };
  for (const f of ag.fields) info[f.key] = half(typed[f.key]);
  const sheet = cfg.dbFormat.sheets.find((x) => x.type === ag.siteType);
  const code = sheet?.code;
  if (code && info[code]) {
    let hits = (ag.presets || []).filter((p) => half(p.values?.[code]) === info[code]);
    if (hits.length > 1) {
      const same = (p) => ag.fields.every((f) => f.key === code || !info[f.key] || half(p.values?.[f.key]) === info[f.key]);
      hits = hits.filter(same);
    }
    if (hits.length === 1) for (const f of ag.fields) info[f.key] = half(hits[0].values?.[f.key]) || info[f.key];
  }
  // 空の項目は、ほかの項目の値で埋める（設定 infoDefault。例 { outline: "routeName" }）
  for (const [k, from] of Object.entries(cfg.entrySheet.infoDefault || {})) if (!info[k] && info[from]) info[k] = info[from];
  return info;
}

// 読み取った表（シートごと）から木を作る
//  sheets：[{ name, info: { key: 値 }, date: "2099-04-05", inspector, rows: [{ row: 行の番号, cells: { 項目: 値 } }] }]
//  返す形：{ state, stats: { added: [番号…], skipped: [すでにある番号…], check: [{ sheet, treeNo, why }], groups: [まとまりの鍵…] }, errors }
export function importEntrySheets(state, cfg, sheets, now = Date.now()) {
  const es = cfg.entrySheet;
  const ag = cfg.addGroups;
  const errors = [];
  const stats = { added: [], skipped: [], check: [], groups: [] };
  if (!es || !ag) return { state, stats, errors: ['この設定では入力表を読み込めません'] };
  const sheetSpec = cfg.dbFormat.sheets.find((x) => x.type === ag.siteType);
  const map = (v) => (v in (es.values || {}) ? es.values[v] : v);
  const blank = new Set((es.blank || []).map(half));
  const same = new Set((es.same || []).map(half));
  const checkKeys = new Set([...cfg.checks.map((c) => c.key), 'vigor', 'initialNeeded']);
  let trees = [...state.trees];
  let seq = 0;

  for (const sh of sheets) {
    const info = groupInfo(sh.info || {}, cfg);
    if (!info[sheetSpec.identify]) {
      if (sh.rows.length) errors.push(`シート「${sh.name}」：${ag.fields.find((f) => f.key === sheetSpec.identify)?.label || '名前'}が入っていません（このシートは読み込みません）`);
      continue;
    }
    const key = groupKey(info, cfg);
    let prevSpecies = '';
    for (const r of sh.rows) {
      const c = r.cells;
      const treeNo = half(c.treeNo);
      if (!treeNo) continue; // 番号のない行は木がない行
      const where = { sheet: sh.name, treeNo };
      const inGroup = trees.filter((t) => groupKey(t, cfg) === key && !t.deleted);
      if (inGroup.some((t) => half(t.treeNo) === treeNo)) {
        stats.skipped.push(`${sh.name} ${treeNo}`);
        continue;
      }
      const why = [];
      seq += 1;
      const stamp = now + seq;
      let t = blankTree({ id: `new:${stamp}`, uid: `${state.server?.deviceId || 'dev'}-${stamp.toString(36)}`, status: cfg.newTreeStatus ?? '', ...info, treeNo });
      // 樹種（「〃」は上の行と同じ）
      const sp = half(c.species);
      t.species = same.has(sp) ? prevSpecies : sp;
      if (t.species) prevSpecies = t.species;
      // 数・文字の欄
      for (const [field, raw] of Object.entries(c)) {
        if (['treeNo', 'species', 'remarks'].includes(field)) continue;
        let v = half(raw);
        if (field === 'girth') {
          t.girths = [blank.has(v) ? '' : v];
        } else if (field === 'branch') {
          const m = v.match(/^([\d.]+)\s*[/／]\s*([\d.]+)$/);
          if (m) [t.branchLen, t.branchDia] = [m[1], m[2]];
          else if (v && !blank.has(v)) why.push(`枝長/枝径「${v}」を読めません`);
        } else if (checkKeys.has(field)) {
          v = map(v);
          const opts = cfg.options[field] || [];
          if (!v) continue;
          if (opts.includes(v)) t[field] = v;
          else why.push(`${cfg.checks.find((x) => x.key === field)?.label || field}「${half(raw)}」は選択肢にありません`);
        } else {
          t[field] = blank.has(v) ? '' : v;
        }
      }
      // 備考
      const rm = readRemarks(c.remarks, es);
      for (const m of rm.measures) t = putMeasure(t, cfg, m);
      for (const n of rm.notes) t.notes = appendNoteLine(t.notes || '', n);
      Object.assign(t, rm.set);
      if (rm.felled && cfg.felled) t.felled = true;
      if (rm.left) why.push(`備考の読み取れなかった部分：${rm.left}`);
      if (rm.left) t.entryLeft = rm.left;
      // 入力済みにできるか（未入力の項目・読み取れなかった所があれば、入力中のままにして人が確かめる）
      const missing = missingFields(t, cfg);
      if (missing.length) why.push(`未入力：${missing.join('・')}`);
      if (!why.length) {
        t = { ...t, done: true, sent: false, source: 'app', updatedAt: new Date(stamp).toISOString(), date: sh.date || state.session?.date || '', inspector: sh.inspector || state.session?.inspector || '' };
      } else {
        t = { ...t, date: sh.date || '', inspector: sh.inspector || '' };
        stats.check.push({ ...where, why });
      }
      // まとまりの最後に足す（まとまりがまだなければ全体の最後）
      const last = trees.filter((x) => groupKey(x, cfg) === key).at(-1);
      const at = last ? trees.indexOf(last) + 1 : trees.length;
      trees = [...trees.slice(0, at), t, ...trees.slice(at)];
      stats.added.push(`${sh.name} ${treeNo}`);
      if (!stats.groups.includes(key)) stats.groups.push(key);
    }
  }
  if (!stats.added.length) return { state, stats, errors };
  // 読み込んだまとまりを選んでおく（画面は変えない。読み込みの結果を設定の画面で見せるため）
  return { state: { ...state, trees, group: stats.groups[0] || state.group, area: '' }, stats, errors };
}

// 設定 entrySheet の検証
export function validateEntrySheet(es, cfg, need) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!need(isObj(es), 'entrySheet（入力表）は { info, columns, dataRow, … } の形にしてください')) return;
  need(cfg.addGroups != null, 'entrySheet を使うには addGroups（まとまりを足す設定）が必要です');
  const cell = (v) => typeof v === 'string' && /^[A-Z]+\d+$/.test(v);
  const fields = new Set((cfg.addGroups?.fields || []).map((f) => f.key));
  if (need(isObj(es.info), 'entrySheet.info は { 項目: セル } の形にしてください'))
    for (const [k, v] of Object.entries(es.info)) need(fields.has(k) && cell(v), `entrySheet.info.${k} は addGroups.fields の項目とセル（例 "C1"）にしてください`);
  if (es.infoDefault != null && need(isObj(es.infoDefault), 'entrySheet.infoDefault は { 項目: 写す元の項目 } の形にしてください'))
    for (const [k, v] of Object.entries(es.infoDefault)) need(fields.has(k) && fields.has(v), `entrySheet.infoDefault.${k} は addGroups.fields の項目どうしにしてください`);
  for (const k of ['date', 'inspector']) need(es[k] == null || cell(es[k]), `entrySheet.${k} はセル（例 "M1"）にしてください`);
  need(Number.isInteger(es.dataRow) && es.dataRow >= 1, 'entrySheet.dataRow（木の最初の行）は 1 以上の整数にしてください');
  if (need(isObj(es.columns) && typeof es.columns.treeNo === 'string', 'entrySheet.columns は { 項目: 列 } の形にし、treeNo を入れてください'))
    for (const [k, v] of Object.entries(es.columns)) need(typeof v === 'string' && /^[A-Z]+$/.test(v), `entrySheet.columns.${k} は列の文字（例 "A"）にしてください`);
  need(es.values == null || (isObj(es.values) && Object.values(es.values).every((v) => typeof v === 'string')), 'entrySheet.values は { 表の文字: アプリの値 } の形にしてください');
  for (const k of ['blank', 'same', 'skipSheets']) need(es[k] == null || (Array.isArray(es[k]) && es[k].every((v) => typeof v === 'string')), `entrySheet.${k} は文字の一覧にしてください`);
  const kinds = new Set((cfg.noteMeasures?.kinds || []).map((x) => x.key));
  if (es.remarks != null && need(Array.isArray(es.remarks), 'entrySheet.remarks は読み方の一覧にしてください'))
    es.remarks.forEach((r, i) => {
      const at = `entrySheet.remarks[${i}]`;
      if (!need(isObj(r) && typeof r.re === 'string' && r.re, `${at} は { re: 正規表現, … } の形にしてください`)) return;
      try {
        new RegExp(r.re, r.flags || '');
      } catch {
        need(false, `${at}.re は正規表現として読めません`);
      }
      need(!/\(\?<[=!]/.test(r.re), `${at}.re に後ろ読み（(?<= ・ (?<!）は使えません`);
      if (r.measure != null) need(isObj(r.measure) && kinds.has(r.measure.kind), `${at}.measure.kind は noteMeasures.kinds の種類にしてください`);
      need(r.note == null || typeof r.note === 'string', `${at}.note は文字にしてください`);
      need(r.set == null || isObj(r.set), `${at}.set は { 項目: 値 } の形にしてください`);
    });
}
