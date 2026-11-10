// Excel のシートを、画面に表として出すための形にする（見るだけ。カルテを画面で確かめるとき）
//  セルの結合・列の幅・行の高さ・罫線・文字の大きさ・太字・色・塗り・寄せ・折り返しを写す。
//  図形・画像・条件付き書式は写さない。
//  返す形：{ name, width, cols: [幅 px…], rows: [{ height, cells: [{ text, rowSpan, colSpan, style }] }] }
//  style は React の style（CSS の名前は camelCase）にそのまま使える形
//  罫線は ExcelJS で読むと結合の中のセルの分が左上のセルの分で上書きされる（既知の落とし穴）ので、ファイルの XML から読む
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { sheetFiles } from './xlsxFix.js';

const PX_PER_CHAR = 7; // 列の幅（文字数）→ px。標準の書体（11pt）の数字1文字の幅
const colPx = (w) => Math.round((w ?? 8.43) * PX_PER_CHAR + 5);
const rowPx = (h) => Math.round(((h ?? 15) * 4) / 3); // pt → px

// 列の記号（A, B, …, AA）→ 番号（1から）
export function colNo(letters) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
// 「A1」→ { row, col }
export function addrOf(a) {
  const m = String(a).replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/i);
  return m ? { col: colNo(m[1]), row: Number(m[2]) } : null;
}
// 「A1:C3」→ { top, left, bottom, right }
export function rangeOf(r) {
  const [a, b = a] = String(r).split(':');
  const p = addrOf(a);
  const q = addrOf(b);
  if (!p || !q) return null;
  return { top: Math.min(p.row, q.row), left: Math.min(p.col, q.col), bottom: Math.max(p.row, q.row), right: Math.max(p.col, q.col) };
}

// 色（ARGB の「FF112233」）→ CSS の色。テーマの色（番号だけ）は分からないので null
const color = (c) => (c?.argb && /^[0-9a-f]{8}$/i.test(c.argb) ? `#${c.argb.slice(2)}` : null);

// 罫線の1辺 → CSS
const LINE = {
  thin: '1px solid',
  hair: '1px dotted',
  dotted: '1px dotted',
  dashed: '1px dashed',
  dashDot: '1px dashed',
  dashDotDot: '1px dashed',
  medium: '2px solid',
  mediumDashed: '2px dashed',
  mediumDashDot: '2px dashed',
  mediumDashDotDot: '2px dashed',
  slantDashDot: '2px dashed',
  thick: '3px solid',
  double: '3px double',
};
const edge = (b) => (b?.style && LINE[b.style] ? `${LINE[b.style]} ${color(b.color) || '#000'}` : null);

// セルの書式 → CSS
function cssOf(cell, value) {
  const st = {};
  const f = cell.font || {};
  if (f.size) st.fontSize = `${f.size}pt`;
  if (f.bold) st.fontWeight = 'bold';
  if (f.italic) st.fontStyle = 'italic';
  if (f.underline) st.textDecoration = 'underline';
  if (color(f.color)) st.color = color(f.color);
  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern === 'solid' && color(fill.fgColor)) st.background = color(fill.fgColor);
  const al = cell.alignment || {};
  const h = al.horizontal;
  st.textAlign = h === 'center' || h === 'centerContinuous' ? 'center' : h === 'right' ? 'right' : h === 'left' ? 'left' : typeof value === 'number' ? 'right' : 'left';
  st.verticalAlign = al.vertical === 'top' ? 'top' : al.vertical === 'middle' ? 'middle' : 'bottom'; // Excel の既定は下寄せ
  st.whiteSpace = al.wrapText ? 'pre-wrap' : 'pre';
  if (al.textRotation === 'vertical' || al.textRotation === 255) st.writingMode = 'vertical-rl';
  if (al.indent) st.paddingLeft = `${al.indent * 8}px`;
  return st;
}

// 印刷の範囲（あればその範囲、なければ使っている範囲）
function areaOf(ws) {
  const pa = String(ws.pageSetup?.printArea || '').split(',')[0].replace(/^.*!/, '');
  const r = pa && rangeOf(pa);
  if (r) return r;
  return { top: 1, left: 1, bottom: Math.max(1, ws.rowCount), right: Math.max(1, ws.columnCount) };
}

// ---------- 罫線を XML から読む ----------
const unesc = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// styles.xml → 書式の番号（s）ごとの罫線 { top, left, bottom, right }（各辺は { style, color: { argb } } か undefined）
export function bordersOfStyles(stylesXml) {
  const borders = [];
  const box = (String(stylesXml).match(/<borders\b[^>]*>([\s\S]*?)<\/borders>/) || [])[1] || '';
  for (const m of box.matchAll(/<border\b[^>]*?(?:\/>|>([\s\S]*?)<\/border>)/g)) {
    const inner = m[1] || '';
    const side = (name) => {
      const t = inner.match(new RegExp(`<${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${name}>)`));
      const st = t && (t[1].match(/\bstyle="([^"]+)"/) || [])[1];
      if (!st) return undefined;
      const rgb = ((t[2] || '').match(/<color\b[^>]*\brgb="([0-9A-Fa-f]{8})"/) || [])[1];
      return { style: st, color: rgb ? { argb: rgb } : undefined };
    };
    borders.push({ top: side('top'), left: side('left'), bottom: side('bottom'), right: side('right') });
  }
  const xfs = (String(stylesXml).match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => borders[Number((m[0].match(/\bborderId="(\d+)"/) || [])[1] ?? 0)] || {});
}

// シートの XML → 番地ごとの罫線（Map「A1」→ 罫線）
export function bordersOfSheet(sheetXml, byStyle) {
  const out = new Map();
  for (const m of String(sheetXml).matchAll(/<c\b[^>]*>/g)) {
    const r = (m[0].match(/\br="([A-Z]+\d+)"/) || [])[1];
    const st = (m[0].match(/\bs="(\d+)"/) || [])[1];
    if (r && st != null && byStyle[Number(st)]) out.set(r, byStyle[Number(st)]);
  }
  return out;
}

const letters = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

// シート1枚を表の形にする
//  borders：番地ごとの罫線（Map。XML から読んだもの）。なければ ExcelJS の値を使う
export function sheetView(ws, borders = null) {
  const borderAt = (y, x) => (borders ? borders.get(`${letters(x)}${y}`) || {} : ws.getCell(y, x).border || {});
  const area = areaOf(ws);
  // 結合：左上のセル → 範囲。結合の中の左上以外のセルは出さない
  const merged = new Map();
  const hidden = new Set();
  for (const m of ws.model?.merges || []) {
    const r = rangeOf(m);
    if (!r) continue;
    merged.set(`${r.top}:${r.left}`, r);
    for (let y = r.top; y <= r.bottom; y++) for (let x = r.left; x <= r.right; x++) if (y !== r.top || x !== r.left) hidden.add(`${y}:${x}`);
  }
  const colsShown = [];
  for (let x = area.left; x <= area.right; x++) if (!ws.getColumn(x).hidden) colsShown.push(x);
  const rowsShown = [];
  for (let y = area.top; y <= area.bottom; y++) if (!ws.getRow(y).hidden) rowsShown.push(y);
  const defH = ws.properties?.defaultRowHeight;
  const defW = ws.properties?.defaultColWidth;
  const cols = colsShown.map((x) => colPx(ws.getColumn(x).width ?? defW));
  //  セルの spill：折り返さない文をはみ出して見せる幅（px。右の空いたセルまで）
  const rows = rowsShown.map((y) => {
    const row = ws.getRow(y);
    const cells = [];
    for (const x of colsShown) {
      if (hidden.has(`${y}:${x}`)) continue;
      const cell = ws.getCell(y, x);
      const m = merged.get(`${y}:${x}`);
      // 結合は印刷の範囲・表示している行と列の中だけで数える
      let rowSpan = 1;
      let colSpan = 1;
      if (m) {
        rowSpan = rowsShown.filter((r) => r >= m.top && r <= Math.min(m.bottom, area.bottom)).length || 1;
        colSpan = colsShown.filter((c) => c >= m.left && c <= Math.min(m.right, area.right)).length || 1;
      }
      const v = cell.value;
      const st = cssOf(cell, v);
      // 罫線：上と左は左上のセル、下は左下、右は右上のセル（結合したセルの罫線は端のセルが持つ）
      const bRow = m ? Math.min(m.bottom, area.bottom) : y;
      const rCol = m ? Math.min(m.right, area.right) : x;
      const top = edge(borderAt(y, x).top);
      const left = edge(borderAt(y, x).left);
      const bottom = edge(borderAt(bRow, x).bottom);
      const right = edge(borderAt(y, rCol).right);
      if (top) st.borderTop = top;
      if (left) st.borderLeft = left;
      if (bottom) st.borderBottom = bottom;
      if (right) st.borderRight = right;
      cells.push({ key: `${y}:${x}`, text: textOf(cell), rowSpan, colSpan, style: st, at: colsShown.indexOf(x) });
    }
    // 折り返さない文は、Excel と同じく右の空いたセルにはみ出して見せる（左寄せの文だけ。空いていないセルの手前まで）
    cells.forEach((c, i) => {
      if (!c.text || c.style.whiteSpace !== 'pre' || c.style.textAlign !== 'left' || c.style.writingMode) return;
      let w = 0;
      for (let k = c.at; k < c.at + c.colSpan; k++) w += cols[k];
      for (let j = i + 1; j < cells.length && !cells[j].text && cells[j].rowSpan === 1 && cells[j].at === cells[j - 1].at + cells[j - 1].colSpan; j++) {
        for (let k = cells[j].at; k < cells[j].at + cells[j].colSpan; k++) w += cols[k];
      }
      c.spill = w;
    });
    return { key: y, height: rowPx(row.height ?? defH), cells };
  });
  return { name: ws.name, width: cols.reduce((a, b) => a + b, 0), cols, rows };
}

// セルの見えている文字（式は計算の結果、日付は書式どおりに出せないので年/月/日）
function textOf(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return `${v.getFullYear()}/${v.getMonth() + 1}/${v.getDate()}`;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result == null ? '' : v.result instanceof Date ? textOf({ value: v.result }) : String(v.result);
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
  }
  try {
    return cell.text ?? String(v);
  } catch {
    return String(v);
  }
}

// xlsx（ArrayBuffer か Uint8Array）の全部のシートを表の形にする
export async function bookView(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const stylesFile = Object.keys(zip.files).find((f) => /^xl\/styles\.xml$/i.test(f));
  const byStyle = stylesFile ? bordersOfStyles(await zip.file(stylesFile).async('string')) : [];
  const files = new Map((await sheetFiles(zip)).map((s) => [unesc(s.name), s.file]));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue;
    const f = files.get(ws.name);
    const xml = f && zip.file(f) ? await zip.file(f).async('string') : null;
    out.push(sheetView(ws, xml ? bordersOfSheet(xml, byStyle) : null));
  }
  return out;
}
