// 詳しい診断（初期診断など）のデータ入力用ブックの読み込み
//
// このブックは、別の仕組み（カルテを作るマクロなど）が「列の位置」で読むので、列の並びは決して変えない。
// そのため、列は見出しの文字で探さず、設定（cfg.initialSurvey.book）に書いた列（col）をそのまま使い、
// 見出し（header）が設定どおりかを確かめる。1か所でも違えば、そのシートは使わない（書き込みもしない）。
//
// 見出しは複数の行に分かれているので、その列の見出しの行を上から「/」でつないだ文字と比べる
//   例：地上部の弱点 / 枝 / 結合部 / 幹との結合部の腐朽(子実体)
// 3列ひと組の項目などで、2列目以降の見出しが空の列は、header を省略する（確かめない）。
// 結合したセルは、左上のセルにだけ文字があるものとして読む（ExcelJS は結合の中のどのセルにも同じ文字を返すため）。

import ExcelJS from 'exceljs';
import { toHalf } from '../core/text.js';
import { cellValue, normalizeHeader } from './cell.js';

// 列の見出し（見出しの行を上から「/」でつなぐ。空の行・結合の左上以外のセルは飛ばす）
export function headerText(ws, col, headerRows) {
  const parts = [];
  for (let r = 1; r <= headerRows; r++) {
    const cell = ws.getCell(`${col}${r}`);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    const h = normalizeHeader(cellValue(cell));
    if (h) parts.push(h);
  }
  return parts.join('/');
}

// 入力規則（ドロップダウン）の選択肢。"無,有（小）,有（大）" の形だけ読む（範囲を指す形は読まない）
// 入力規則が「選択肢にない値は入れられない」ものか（Excel の「エラーメッセージを表示する」がオンで、種類が「停止」）
//  オフのものは候補を出すだけで、ほかの値も入れられる（例：枝長/枝径の「40≦」、前回調査年の「-」）
export function isStrictList(cell) {
  const dv = cell?.dataValidation;
  if (!dv || dv.type !== 'list') return false;
  const on = dv.showErrorMessage === true || dv.showErrorMessage === 1 || dv.showErrorMessage === '1';
  return on && (dv.errorStyle == null || dv.errorStyle === 'stop');
}

export function listOptions(cell) {
  const dv = cell?.dataValidation;
  if (!dv || dv.type !== 'list' || !dv.formulae?.length) return null;
  const f = String(dv.formulae[0]);
  const m = f.match(/^"(.*)"$/s);
  return m ? m[1].split(',') : null;
}

// ブックを読む
// 返す形：{
//   sheets: [{ spec, name, errors, rows: [{ rowNumber, values: { 項目: 値 }, filled }], options: { 項目: [選択肢] }, strict: Set(選択肢にない値を入れられない項目) }],
//   missing: [設定にあるがブックに見つからなかったシート（spec）],
//   errors: [すべてのシートの errors をまとめたもの],
// }
export async function readInitialBook(buffer, cfg) {
  const book = cfg.initialSurvey?.book;
  if (!book) throw new Error('設定に initialSurvey（データ入力用ブックの書式）がありません');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets = [];
  const missing = [];
  for (const spec of book.sheets) {
    const re = new RegExp(spec.name);
    const ws = wb.worksheets.find((w) => re.test(w.name));
    if (!ws) {
      missing.push(spec);
      continue;
    }
    sheets.push(readSheet(ws, spec, book.doneKey));
  }
  return { sheets, missing, errors: sheets.flatMap((s) => s.errors) };
}

function readSheet(ws, spec, doneKey) {
  const errors = [];
  // 見出しの確認（列の位置が設定どおりか）
  for (const [key, c] of Object.entries(spec.columns)) {
    if (c.header == null) continue;
    const text = headerText(ws, c.col, spec.headerRows);
    if (!new RegExp(c.header).test(text))
      errors.push(`シート「${ws.name}」の${c.col}列（${key}）の見出しが設定と違います（設定：${c.header} ／ ブック：${text || '空欄'}）`);
  }

  // 選択肢（データの最初の行の入力規則から）
  const options = {};
  const strict = new Set();
  for (const [key, c] of Object.entries(spec.columns)) {
    const cell = ws.getCell(`${c.col}${spec.dataRow}`);
    const o = listOptions(cell);
    if (o) options[key] = o;
    if (o && isStrictList(cell)) strict.add(key);
  }

  // データの行（通し番号などが入っていても、doneKey の列が空なら空き行）
  const rows = [];
  const last = ws.rowCount;
  for (let r = spec.dataRow; r <= last; r++) {
    const values = {};
    for (const [key, c] of Object.entries(spec.columns)) values[key] = cellValue(ws.getCell(`${c.col}${r}`));
    rows.push({ rowNumber: r, values, filled: !!toHalf(String(values[doneKey] ?? '')).trim() });
  }
  return { spec, name: ws.name, errors, rows, options, strict };
}

// 入力済みの行の一覧（「書式|シートの種類|場所のコード|樹木番号」→ 行の一覧）。同じ鍵が2行あれば両方入る
//  場所のコードの項目名は、台帳と同じ（cfg.dbFormat.sheets の code。例 parkCode）。違う場所の同じ番号は別の木
export const bookKey = (form, siteType, code, treeNo) =>
  `${form}|${siteType || ''}|${toHalf(String(code ?? '')).trim()}|${toHalf(String(treeNo ?? '')).trim()}`;
export function filledIndex(result, cfg) {
  const doneKey = cfg.initialSurvey.book.doneKey;
  const index = new Map();
  for (const s of result.sheets) {
    const codeKey = cfg.dbFormat.sheets.find((x) => x.type === s.spec.siteType)?.code;
    for (const row of s.rows) {
      if (!row.filled) continue;
      const k = bookKey(s.spec.form, s.spec.siteType, codeKey ? row.values[codeKey] : '', row.values[doneKey]);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push({ sheet: s.name, rowNumber: row.rowNumber });
    }
  }
  return index;
}

// まだ書き込める空き行の数（シートごと）
export const emptyRowCount = (sheet) => sheet.rows.filter((r) => !r.filled).length;
