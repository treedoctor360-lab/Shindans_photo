// 入力表（Excel。1本1行）を読んで、シートごとの行にする（木にするのは src/core/entrySheet.js）
import ExcelJS from 'exceljs';
import { colNumber } from './xmlCells.js';

// セルの値を文字にする（式は計算の結果、装飾つきの文字は中の文字）
function textOf(v) {
  if (v == null) return '';
  if (v instanceof Date) return ymd(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('');
    if ('result' in v) return textOf(v.result);
    if ('text' in v) return String(v.text ?? '');
    return '';
  }
  // 数は Excel の小数の誤差を除く（例 1.9000000000000001）
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return String(v);
}
// 日付（ExcelJS は UTC の日付で返す）→ "2099-04-05"
const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
function dateOf(v) {
  if (v instanceof Date) return ymd(v);
  const m = textOf(v).trim().match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

// 返す形：[{ name, info, date, inspector, rows: [{ row, cells: { 項目: 文字 } }] }]（木のないシートは返さない）
export async function readEntrySheets(buffer, cfg) {
  const es = cfg.entrySheet;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const skip = (es.skipSheets || []).map((p) => new RegExp(p));
  const out = [];
  for (const ws of wb.worksheets) {
    if (skip.some((re) => re.test(ws.name))) continue;
    const at = (addr) => ws.getCell(addr).value;
    const info = Object.fromEntries(Object.entries(es.info).map(([k, addr]) => [k, textOf(at(addr)).trim()]));
    const cols = Object.entries(es.columns).map(([k, col]) => [k, colNumber(col)]);
    const noCol = colNumber(es.columns.treeNo);
    const rows = [];
    for (let r = es.dataRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!textOf(row.getCell(noCol).value).trim()) continue; // 番号のない行は読まない
      rows.push({ row: r, cells: Object.fromEntries(cols.map(([k, c]) => [k, textOf(row.getCell(c).value).trim()])) });
    }
    if (!rows.length) continue;
    out.push({ name: ws.name, info, date: es.date ? dateOf(at(es.date)) : '', inspector: es.inspector ? textOf(at(es.inspector)).trim() : '', rows });
  }
  return out;
}
