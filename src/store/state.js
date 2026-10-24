// アプリの状態（入力した木・調査情報・読み込んだ設定など）と、その保存・読み込み
//
// 保存先（端末内の IndexedDB）
//  'state'    … 調査情報・木の一覧・表示中の画面など（入力のたびに保存）
//  'config'   … 設定ファイル（検証に通ったもの）
//  'template' … 野帳の原本 { name, buffer }
//  'ledger'   … 読み込んだ台帳 { name, date, buffer }（一覧表に書き戻すときの元ファイル）

import { chooseConfig } from '../core/config.js';
import { mergeLedger, readLedger } from '../excel/ledger.js';
import { bookKey, filledIndex, readInitialBook } from '../excel/initialBook.js';
import { readKarteTemplate } from '../excel/karteExport.js';
import { idbGet, idbPut } from './idb.js';

// 保存する状態の形の版（形を変えたら上げ、migrate で古い形を直す）
export const STATE_VERSION = 3; // 2: 確認の流れ（付箋・確定・版番号）を追加 / 3: 詳しい診断の記録（initials）を追加

export function initialState() {
  return {
    stateVersion: STATE_VERSION,
    view: 'settings', // 'list' | 'form' | 'out' | 'settings'
    session: { date: '', inspector: '' }, // 調査情報（保存した木に記録する）
    trees: [],
    initials: [], // 詳しい診断（初期診断など）の記録。1本の木に1件（surveys.js の INITIAL）
    initialBookInfo: null, // 読み込んだデータ入力用ブック { name, date, filled: [入力済みの鍵…], errors: [...] }
    karteTemplateInfo: null, // 読み込んだカルテの様式（確認用カルテ用）{ name, date, sheets: [シート名…], errors: [...] }
    group: '', // 表示中の公園・路線
    currentId: '',
    ledgerInfo: null, // { name, date, columns: { シートの種類: [{ key, header }…]（見出しの並び） } }
    templateName: '',
    // サーバー（GAS）：URL と合言葉はこの端末にだけ保存する。deviceId はこの端末の印（送信元の記録用）
    server: { url: '', pass: '', deviceId: '', lastSent: '', lastFetched: '', lastSeq: 0 },
    user: { role: 'surveyor', name: '' }, // この端末を使う人（'surveyor' 調査者 / 'office' 事務）
    stickies: {}, // 付箋（id → 付箋）
    confirms: {}, // 確定の印（木の鍵 → 印）
  };
}

// 木の印（id）の修復：印がない木・ほかの木と同じ印の木に、新しい印を付ける
//  印は端末の中で木を選ぶためだけに使う（送るデータには入らない）ので、付け直しても送受信には影響しない。
//  印が欠けたり重なったりすると、一覧で押した木と違う木が開くおそれがあるため、読み込むたびに確かめる
export function repairIds(trees) {
  if (!Array.isArray(trees)) return trees;
  const seen = new Set();
  let n = 0;
  return trees.map((t) => {
    if (!t || typeof t !== 'object') return t;
    let id = typeof t.id === 'string' && t.id ? t.id : '';
    if (!id || seen.has(id)) {
      do id = `fix:${++n}:${t.treeNo || ''}`;
      while (seen.has(id));
      seen.add(id);
      return { ...t, id };
    }
    seen.add(id);
    return t;
  });
}

// この端末の印（ランダムな文字）
const newDeviceId = () => Math.random().toString(36).slice(2, 10);

// 古い形の状態を今の形に直す
export function migrate(s) {
  const base = initialState();
  if (!s || typeof s !== 'object') s = {};
  const server = { ...base.server, ...(s.server || {}) };
  if (!server.deviceId) server.deviceId = newDeviceId();
  let trees = repairIds(s.trees || base.trees);
  if ((s.stateVersion || 1) < 2 && Array.isArray(trees)) {
    // 版1から2へ：サーバーの保存の形が変わったので、アプリで入力した木は送り直す
    trees = trees.map((t) => (t && t.done && t.source === 'app' && !(t.rev > 0) ? { ...t, sent: false } : t));
    server.lastSeq = 0;
  }
  // 開いていた木がない（印を直した・消えた）ときは、別の木を開かないよう一覧から始める
  const keep = !s.currentId || (Array.isArray(trees) && trees.some((t) => t?.id === s.currentId));
  return {
    ...base,
    ...s,
    trees,
    ...(keep ? {} : { currentId: '', view: s.view === 'form' ? 'list' : s.view }),
    session: { ...base.session, ...(s.session || {}) },
    user: { ...base.user, ...(s.user || {}) },
    stickies: s.stickies || {},
    confirms: s.confirms || {},
    initials: Array.isArray(s.initials) ? s.initials : [],
    server,
    stateVersion: STATE_VERSION,
  };
}

// 端末から読み込む
export async function loadAll() {
  const [state, config] = await Promise.all([idbGet('state'), idbGet('config')]);
  return { state: migrate(state), config: config ?? null };
}

export const saveState = (state) => idbPut('state', state);

// 設定ファイル（JSON の文字）を読み込む。不正なら保存せず、前の設定のまま
// 返す形：{ config, errors }
export async function loadConfigText(text, previous) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { config: previous, errors: ['JSON として読めません（ファイルが壊れているか、設定ファイルではありません）'] };
  }
  const r = chooseConfig(parsed, previous);
  if (!r.errors.length) await idbPut('config', r.config);
  return r;
}

// 野帳の原本を保存する
export async function saveTemplate(name, buffer) {
  await idbPut('template', { name, buffer });
}
export const loadTemplate = () => idbGet('template');

// 台帳を読み込んで、状態に取り込む。返す形：{ state, stats, sheets }
//  読む（時間がかかる）のと、状態に入れるのを分けてある。画面では、読み終わってから
//  「その時点の最新の状態」に applyLedger で入れる（読んでいる間に送受信で届いた変更を、古い状態で上書きしないように）
export async function readLedgerFile(name, buffer, cfg, today) {
  const { rows, sheets } = await readLedger(buffer.slice(0), cfg);
  if (!rows.length) throw new Error('樹木番号の列が見つかりませんでした。台帳（樹木の一覧の Excel）を選んでください');
  await idbPut('ledger', { name, date: today, buffer });
  // シートの種類ごとの見出しの並び（一覧表形式の表示用。同じ種類のシートが複数あれば最初のシート）
  const columns = {};
  for (const sh of sheets) if (!columns[sh.type]) columns[sh.type] = sh.order;
  return { rows, sheets, info: { name, date: today, columns } };
}
export function applyLedger(state, parsed, cfg) {
  const { trees, stats } = mergeLedger(state.trees, parsed.rows, cfg);
  return { state: { ...state, trees, ledgerInfo: parsed.info }, stats, sheets: parsed.sheets };
}
export async function importLedger(state, name, buffer, cfg, today) {
  return applyLedger(state, await readLedgerFile(name, buffer, cfg, today), cfg);
}
export const loadLedgerFile = () => idbGet('ledger');

// 詳しい診断のデータ入力用ブックを読み込む。返す形：{ state, result }
//  ブックは端末に保存し（書き込みのときに使う）、状態には入力済みの木の鍵と、見出しの誤りだけを持つ
export async function importInitialBook(state, name, buffer, cfg, today) {
  const result = await readInitialBook(buffer.slice(0), cfg);
  if (!result.sheets.length) throw new Error('設定にあるシートが見つかりませんでした。データ入力用ブックを選んでください');
  await idbPut('initialBook', { name, date: today, buffer });
  const filled = [...filledIndex(result, cfg).keys()];
  // 選択肢（入力規則）は、書式とシートの種類ごとに持つ（入力画面で使う）
  const options = Object.fromEntries(result.sheets.filter((s) => !s.errors.length).map((s) => [`${s.spec.form}|${s.spec.siteType}`, s.options]));
  const rows = bookRows(result, cfg);
  return { state: { ...state, initialBookInfo: { name, date: today, filled, errors: result.errors, options, rows } }, result };
}
export const loadInitialBookFile = () => idbGet('initialBook');

// 確認用カルテの様式（カルテの空の様式が入ったブック）を読み込む。この端末にだけ置く（サーバーには置かない）
//  返す形：状態に入れる情報 { name, date, sheets: [見つかったシート名…], errors: [...] }
export async function readKarteTemplateFile(name, buffer, cfg, today) {
  const r = await readKarteTemplate(buffer.slice(0), cfg);
  if (!r.sheets.length) throw new Error('設定にあるカルテの様式のシートが見つかりませんでした。カルテの様式が入ったブックを選んでください');
  await idbPut('karteTemplate', { name, date: today, buffer });
  return { name, date: today, sheets: r.sheets.map((s) => s.name), errors: r.errors };
}
export const loadKarteTemplateFile = () => idbGet('karteTemplate');

// ブックの入力済みの行の中身（入力画面で見るため）。鍵は「シートの種類|場所のコード|樹木番号」、中身は書式ごとの値
//  { 'park|K01|AB009': { initial: { …値, _sheet, _row }, environment: {…}, dup: ['initial'] } }
//  見出しが設定と違うシートは使わない。同じ鍵の行が2つあれば最初の行を使い、dup に書式を記録する
function bookRows(result, cfg) {
  const out = {};
  for (const s of result.sheets) {
    if (s.errors.length) continue;
    const codeKey = cfg.dbFormat.sheets.find((x) => x.type === s.spec.siteType)?.code;
    for (const row of s.rows) {
      if (!row.filled) continue;
      const k = bookKey('', s.spec.siteType, codeKey ? row.values[codeKey] : '', row.values[cfg.initialSurvey.book.doneKey]).slice(1);
      const e = (out[k] ||= {});
      if (e[s.spec.form]) {
        e.dup = [...new Set([...(e.dup || []), s.spec.form])];
        continue;
      }
      e[s.spec.form] = { ...row.values, _sheet: s.name, _row: row.rowNumber };
    }
  }
  return out;
}
