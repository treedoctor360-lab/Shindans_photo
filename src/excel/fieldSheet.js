// 野帳（紙の記録用紙と同じ様式の Excel）の出力と、出力後の照合
//
// しくみ
//  - 原本（空の様式）を設定と一緒に外から受け取り、用紙の枚数だけシートを複製して書き込む
//  - 選択肢の欄は、セルの文字を消して「図形」で描く。選んだものは○（楕円）で囲む
//    （Excel のセル内の文字位置は環境で変わるため、図形にして位置を固定する。白黒印刷でも分かる）
//  - 図形の位置は、原本の列幅・行の高さから計算する
//  - 書き出したファイルを読み直して照合し、1件でも食い違えばファイルを返さない
//
// 図形の名前には「樹木番号|列|選択肢|選んだか」を入れておき、照合で使う。

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { girthOf } from '../core/calc.js';
import { noteLines } from '../core/notes.js';
import { photoFlag } from '../core/photo.js';
import { fill, monthDay, num, toHalf } from '../core/text.js';
import { composeTreat } from '../core/treat.js';
import { isCheckKey, isLocked } from '../core/tree.js';
import { cellValue } from './cell.js';
import { fixBorderXml, sheetFiles } from './xlsxFix.js';

const EMU = 12700; // 1pt を図形の単位（EMU）にする係数
const half = (v) => toHalf(v).trim();

// 列の文字 → 0始まりの番号（"A" → 0, "E" → 4）
const colIndex = (letter) => [...letter.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// ---------- 用紙の割り付け ----------

// 区画（tree.area）ごとに分け、1枚に rowsPerSheet 本ずつ入れる。並びは渡された順のまま
export function buildPages(trees, cfg) {
  const per = cfg.fieldSheet.rowsPerSheet;
  const groups = new Map();
  for (const t of trees) {
    const a = t.area || '';
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(t);
  }
  const pages = [];
  for (const [area, ts] of groups) for (let i = 0; i < ts.length; i += per) pages.push({ area, trees: ts.slice(i, i + per) });
  return pages.length ? pages : [{ area: '', trees: [] }];
}

// その木の調査日・調査者（台帳で入力済みの木は台帳の値）。未入力なら null
export function surveyOf(t) {
  if (!t.done) return null;
  return t.source === 'ledger' ? { date: t.ledgerDate || '', inspector: t.ledgerInspector || '' } : { date: t.date || '', inspector: t.inspector || '' };
}

// 「姓 名(資格)・姓 名(資格)」→「姓・姓」
const surnames = (s) =>
  String(s || '')
    .split(/[・、,]/)
    .map((x) => x.replace(/\(.*?\)|（.*?）/g, '').trim().split(/\s+/)[0])
    .filter(Boolean)
    .join('・');

// 用紙の見出し（調査者・日付）：その用紙の木の調査記録から決める
//  1組だけ → その値 / 複数 → 「行ごとに記載」＋各木の欄外に日付と調査者 / 未入力だけ → 空欄
export function pageMeta(trees, cfg) {
  const h = cfg.fieldSheet.header;
  const uniq = new Map();
  for (const t of trees) {
    const s = surveyOf(t);
    if (s && (s.date || s.inspector)) uniq.set(`${s.date}|${s.inspector}`, s);
  }
  const list = [...uniq.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dateText = (ymd, suffix = '') => {
    const [y, m, d] = String(ymd || '').split('-');
    return fill(h.dateTemplate, {
      y: y ? +y - h.eraOffset : h.defaultEraYear,
      m: m ? +m : '　　',
      d: d ? `${+d}${suffix}` : '　　',
    });
  };
  if (!list.length) return { inspector: '', date: dateText(''), multi: false };
  if (list.length === 1) return { inspector: list[0].inspector, date: dateText(list[0].date), multi: false };
  return { inspector: h.multiLabel, date: dateText(list[0].date, h.multiDateSuffix), multi: true };
}

// ---------- 選択肢の欄 ----------

// 木1本の選択肢の欄：[{ col（0始まり）, field, val（選んだ値）, opts: [{ v, lines }] }]
export function optionColumns(t, cfg) {
  const fs = cfg.fieldSheet;
  const locked = isLocked(t, cfg);
  const valueOf = (field) => {
    if (field === 'photo') return t.done ? photoFlag(t, cfg) : '';
    if (field === 'grade') return t.initialNeeded === cfg.initial.yes ? '' : t.grade;
    if (locked && isCheckKey(field, cfg)) return '';
    return t[field] || '';
  };
  return fs.optionCols.map((oc) => {
    const val = valueOf(oc.field);
    const opts = oc.opts.map((o) => {
      // 「({deadBranchCount}本)」のような穴埋めは、その選択肢を選んだときだけ詳細を入れる
      const lines = o.lines.flatMap((line) => {
        const m = line.match(/^(.*?)\{(\w+)\}(.*)$/);
        if (!m) return [line];
        const [, pre, key, post] = m;
        const detail = val === o.v ? half(t[key]) || o.default || o.blank || '' : o.blank || '';
        // 長い詳細（キノコの名前など）は wrap 文字ずつ折り返す。カッコなどの前後の文字は最初と最後の行に付ける
        const chunks = [];
        if (o.wrap && detail.length > o.wrap) for (let i = 0; i < detail.length; i += o.wrap) chunks.push(detail.slice(i, i + o.wrap));
        else chunks.push(detail);
        return chunks.map((x, i) => (i === 0 ? pre : '') + x + (i === chunks.length - 1 ? post : ''));
      });
      return { v: o.v, lines };
    });
    return { col: colIndex(oc.col), field: oc.field, val, opts };
  });
}

// 原本の列幅・行の高さ（pt）
export function templateGeometry(ws, cfg) {
  const fs = cfg.fieldSheet;
  const colW = [];
  for (let c = 1; c <= fs.templateCols; c++) {
    const w = ws.getColumn(c).width ?? fs.defaultColWidth;
    colW.push(Math.trunc(w * fs.charPx + 5) * 0.75); // Excel の列幅（文字数）→ px → pt
  }
  const rowH = [];
  for (let r = 1; r <= fs.templateRows; r++) rowH.push(ws.getRow(r).height ?? ws.properties.defaultRowHeight ?? 15);
  return { colW, rowH };
}

// 文字の幅の目安（pt）。半角は全角の 0.55 倍
const textWidth = (s, pt) => [...s].reduce((a, ch) => a + (/[\x20-\x7e]/.test(ch) ? 0.55 : 1) * pt, 0);
const sum = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0);

// 木1本（rowsPerTree 行）の図形。row0 = その木の1行目（0始まり）
export function treeShapes(t, row0, geo, cfg) {
  const fs = cfg.fieldSheet;
  const H = sum(geo.rowH.slice(row0), fs.rowsPerTree);
  const top = sum(geo.rowH, row0);
  const shapes = [];
  for (const oc of optionColumns(t, cfg)) {
    const left = sum(geo.colW, oc.col);
    const cw = geo.colW[oc.col];
    oc.opts.forEach((o, k) => {
      const sel = !!oc.val && oc.val === o.v;
      const w = Math.min(cw - 2, Math.max(...o.lines.map((l) => textWidth(l, fs.optionFontPt))) + 9);
      const h = o.lines.length * fs.optionLinePt + 5;
      const cy = (H * (k + 0.5)) / oc.opts.length;
      shapes.push({ x: left + (cw - w) / 2, y: top + cy - h / 2, w, h, lines: o.lines, sel, tag: `${half(t.treeNo)}|${oc.col}|${o.v}|${sel ? 1 : 0}` });
    });
  }
  return shapes;
}

// 絶対位置（pt）→ [セル番号（0始まり）, セル内のずれ]
function cellPos(x, sizes) {
  let i = 0;
  let acc = 0;
  while (i < sizes.length - 1 && acc + sizes[i] <= x) acc += sizes[i++];
  return [i, Math.max(0, x - acc)];
}

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const xmlUnesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// 図形の XML（DrawingML）
export function drawingXml(shapes, geo, font) {
  const e = (v) => Math.round(v * EMU);
  const anchor = (sp, id) => {
    const [c1, cx1] = cellPos(sp.x, geo.colW);
    const [r1, ry1] = cellPos(sp.y, geo.rowH);
    const [c2, cx2] = cellPos(sp.x + sp.w, geo.colW);
    const [r2, ry2] = cellPos(sp.y + sp.h, geo.rowH);
    const line = sp.sel ? '<a:ln w="15875"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' : '<a:ln><a:noFill/></a:ln>';
    const runs = sp.lines
      .map(
        (l) =>
          `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ja-JP" sz="1000"${sp.sel ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="000000"/></a:solidFill>` +
          `<a:latin typeface="${xmlEsc(font)}"/><a:ea typeface="${xmlEsc(font)}"/></a:rPr><a:t>${xmlEsc(l)}</a:t></a:r></a:p>`,
      )
      .join('');
    return (
      `<xdr:twoCellAnchor editAs="absolute">` +
      `<xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>${e(cx1)}</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>${e(ry1)}</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>${e(cx2)}</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>${e(ry2)}</xdr:rowOff></xdr:to>` +
      `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xmlEsc(sp.tag)}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
      `<xdr:spPr><a:prstGeom prst="${sp.sel ? 'ellipse' : 'rect'}"><a:avLst/></a:prstGeom><a:noFill/>${line}</xdr:spPr>` +
      `<xdr:txBody><a:bodyPr vertOverflow="overflow" horzOverflow="overflow" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"/><a:lstStyle/>${runs}</xdr:txBody>` +
      `</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
    );
  };
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    shapes.map((sp, i) => anchor(sp, i + 2)).join('') +
    '</xdr:wsDr>'
  );
}

// ExcelJS が書き出したファイルに、シートごとの図形を書き足す（罫線の補正も行う）
//  perSheet[i] は「並び順で i 番目のシート」の図形。中のファイル名は sheetFiles で対応を取る
export async function addShapes(buffer, perSheet, geo, font) {
  const zip = await JSZip.loadAsync(buffer);
  const styles = zip.file('xl/styles.xml');
  if (styles) zip.file('xl/styles.xml', fixBorderXml(await styles.async('string')));
  let ct = await zip.file('[Content_Types].xml').async('string');
  const files = await sheetFiles(zip);
  let n = 1;
  for (let i = 0; i < perSheet.length; i++) {
    const shapes = perSheet[i];
    if (!shapes.length) continue;
    const sheetPath = files[i]?.file;
    if (!sheetPath || !zip.file(sheetPath)) throw new Error(`${i + 1}枚目のシートのファイルが見つかりません`);
    while (zip.file(`xl/drawings/drawing${n}.xml`)) n++; // 原本の図形と名前がぶつからないように
    const drawingPath = `xl/drawings/drawing${n}.xml`;
    zip.file(drawingPath, drawingXml(shapes, geo, font));
    ct = ct.replace('</Types>', `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);

    const base = sheetPath.split('/').pop();
    const relPath = `xl/worksheets/_rels/${base}.rels`;
    const relXml = zip.file(relPath)
      ? await zip.file(relPath).async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    zip.file(
      relPath,
      relXml.replace(
        '</Relationships>',
        `<Relationship Id="rIdOptDrw" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`,
      ),
    );
    let sx = await zip.file(sheetPath).async('string');
    if (/<drawing\b/.test(sx)) throw new Error(`${i + 1}枚目のシートには既に図形があります（原本に図形を入れないでください）`);
    if (!/xmlns:r=/.test(sx)) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    // <drawing> は決まった順番の位置に入れる必要がある
    const m = sx.match(/<legacyDrawing|<legacyDrawingHF|<picture|<oleObjects|<controls|<webPublishItems|<tableParts|<extLst|<\/worksheet>/);
    sx = sx.slice(0, m.index) + '<drawing r:id="rIdOptDrw"/>' + sx.slice(m.index);
    zip.file(sheetPath, sx);
    n++;
  }
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------- 書き込み ----------

// セルの書式は他のセルと共有されていることがあるので、書き換える前にそのセル専用に複製する
const own = (cell) => {
  cell.style = structuredClone(cell.style || {});
  return cell;
};

// 幹周の欄：株立は各幹周と記録値、単幹は数値
function girthCell(t, cfg) {
  const gs = (t.girths || []).map(num).filter(Boolean);
  const g = girthOf(t, cfg);
  if (g == null) return null;
  return gs.length > 1 ? `${gs.map((x) => x.toFixed(2)).join('\n')}\n→${g.toFixed(2)}` : g;
}

// 枝長/枝径の欄：アプリで測った木は「枝長/枝径」、台帳の木は台帳の値
function branchCell(t) {
  if (num(t.branchLen)) return `${half(t.branchLen)}/${half(t.branchDia)}`;
  const v = t.ledgerBranchRatio || '';
  return /^[\d.]+$/.test(v) ? parseFloat(v) : v;
}

// 野帳を作る。返す形：{ buffer（照合に通ったときだけ）, errors, pages }
//  title: 用紙の見出しに入れる名前（公園名など）
export async function exportFieldSheet(templateBuffer, pages, cfg, { title = '' } = {}) {
  const fs = cfg.fieldSheet;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const src = wb.worksheets[0];
  const geo = templateGeometry(src, cfg);

  // 先に必要な枚数だけ原本を複製する（値を書く前に）
  const model = src.model;
  const sheets = [src];
  for (let i = 1; i < pages.length; i++) {
    const ws = wb.addWorksheet(`p${i + 1}`);
    ws.model = { ...model, name: `p${i + 1}`, mergeCells: model.merges };
    // 複製では結合セルの下側の書式（罫線）が落ちるので、原本から全セルの書式を写す
    for (let r = 1; r <= fs.templateRows; r++)
      for (let c = 1; c <= fs.templateCols; c++) ws.getRow(r).getCell(c).style = structuredClone(src.getRow(r).getCell(c).style || {});
    sheets.push(ws);
  }

  const pen = { argb: fs.penColor };
  const small = { name: fs.font, size: 8, color: { argb: 'FF444444' } };
  const perSheet = sheets.map(() => []);
  const optLetters = fs.optionCols.map((o) => o.col);

  pages.forEach((page, pi) => {
    const ws = sheets[pi];
    ws.name = `${pi + 1}${page.area ? '_' + page.area : ''}`.slice(0, 31);
    const h = fs.header;
    ws.getCell(h.title).value = title + (page.area ? `（${page.area}）` : '');
    const meta = pageMeta(page.trees, cfg);
    own(ws.getCell(h.inspector)).value = meta.inspector || null;
    ws.getCell(h.inspector).font = { name: fs.font, size: 9 };
    ws.getCell(h.date).value = meta.date;

    page.trees.forEach((t, k) => {
      const r = fs.firstRow + k * fs.rowsPerTree;
      const c = fs.cells;
      const write = (col, val, size = 11, wrap = false, numFmt) => {
        const cell = own(ws.getCell(`${col}${r}`));
        cell.value = val === '' ? null : val;
        cell.font = { name: fs.font, size, color: pen, bold: true };
        if (wrap) cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        if (numFmt) cell.numFmt = numFmt;
      };
      // 番号（＋前回の特記）・樹種（＋状態・行ごとの調査記録）。未入力の木も書く
      ws.getCell(`${c.treeNo}${r}`).value = {
        richText: [
          { text: half(t.treeNo), font: { name: fs.font, size: 11 } },
          ...(t.prevNote ? [{ text: `\n${fs.prevLabel}${t.prevNote}`, font: small }] : []),
          // 前回の調査の印（例：前回に詳しい診断をした木）。出力の前に t.prevMarks を付けておく
          ...(t.prevMarks?.length ? [{ text: `\n${t.prevMarks.join('・')}`, font: { ...small, bold: true } }] : []),
        ],
      };
      own(ws.getCell(`${c.treeNo}${r}`)).alignment = { vertical: 'top', wrapText: true };
      const statusLabel = fs.statusLabels?.[t.status];
      const s = surveyOf(t);
      ws.getCell(`${c.species}${r + 1}`).value = {
        richText: [
          { text: t.species || '', font: { name: fs.font, size: 11 } },
          ...(statusLabel ? [{ text: `\n${statusLabel}`, font: { ...small, color: pen } }] : []),
          ...(meta.multi && s ? [{ text: `\n${monthDay(s.date)} ${surnames(s.inspector)}`, font: { ...small, color: pen } }] : []),
        ],
      };
      own(ws.getCell(`${c.species}${r + 1}`)).alignment = { vertical: 'top', wrapText: true };
      if (!t.done) return; // 未入力の木は番号・樹種だけ（選択肢は原本の文字のまま。紙の野帳として使える）

      if (num(t.height)) write(c.height, num(t.height), 11, false, '0.0');
      const g = girthCell(t, cfg);
      if (typeof g === 'number') write(c.girth, g, 11, false, '0.00');
      else if (g) write(c.girth, g, 9, true);
      write(c.branch, branchCell(t), 10);
      for (const L of optLetters) ws.getCell(`${L}${r}`).value = null; // 選択肢は図形で描く
      perSheet[pi].push(...treeShapes(t, r - 1, geo, cfg));
      write(c.note, noteLines(toHalf(t.notes)).map((x) => '・' + x).join('\n'), 9, true);
      write(c.initial, t.initialNeeded || '', 14);
      write(c.treat, toHalf(composeTreat(t, cfg)), 9, true);
      write(c.reason, t.fellingReason || '', 9, true);
    });
  });

  wb.creator = '';
  wb.lastModifiedBy = '';
  const out = await addShapes(await wb.xlsx.writeBuffer(), perSheet, geo, fs.font);
  const errors = await verifyFieldSheet(out, templateBuffer, pages, cfg);
  return errors.length ? { buffer: null, errors, pages } : { buffer: out, errors: [], pages };
}

// ---------- 出力後の照合 ----------

// 野帳を読み直して照合する。食い違いの一覧を返す（空なら合格）
//  1. 用紙の枚数
//  2. 各用紙の樹木番号・樹種の並び、入力済みの木の主な値（樹高・幹周・初期・特記・処置）
//  3. 未入力の木の選択肢の欄が原本のまま
//  4. ○の図形：数、この用紙の木のものか、その木の行・正しい列にあるか、選んだ選択肢と一致するか
export async function verifyFieldSheet(outBuffer, templateBuffer, pages, cfg) {
  const fs = cfg.fieldSheet;
  const errs = [];
  const zip = await JSZip.loadAsync(outBuffer);
  const files = await sheetFiles(zip);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(outBuffer);
  const tpl = new ExcelJS.Workbook();
  await tpl.xlsx.load(templateBuffer);
  const tws = tpl.worksheets[0];
  const c = fs.cells;

  if (files.length !== pages.length) errs.push(`用紙の枚数が合いません（出力${files.length}枚・予定${pages.length}枚）`);
  for (let i = 0; i < Math.min(pages.length, files.length); i++) {
    const page = pages[i];
    const label = `${i + 1}枚目`;
    const ws = wb.getWorksheet(files[i].name);
    const firstLine = (addr) => String(cellValue(ws.getCell(addr))).split('\n')[0].trim();

    page.trees.forEach((t, k) => {
      const r = fs.firstRow + k * fs.rowsPerTree;
      const no = half(t.treeNo);
      if (firstLine(`${c.treeNo}${r}`) !== no) errs.push(`${label} ${r}行目：樹木番号が「${firstLine(`${c.treeNo}${r}`)}」（正しくは${no}）`);
      if (firstLine(`${c.species}${r + 1}`) !== (t.species || '')) errs.push(`${label} ${no}：樹種が「${firstLine(`${c.species}${r + 1}`)}」`);
      const noCell = String(cellValue(ws.getCell(`${c.treeNo}${r}`)));
      for (const m of t.prevMarks || []) if (!noCell.includes(m)) errs.push(`${label} ${no}：前回の印「${m}」がありません`);
      if (!t.done) {
        for (const oc of fs.optionCols) {
          const a = `${oc.col}${r}`;
          if (String(cellValue(ws.getCell(a))) !== String(cellValue(tws.getCell(a)))) errs.push(`${label} ${no}：未入力の木の選択肢の欄（${a}）が原本と違います`);
        }
        return;
      }
      const v = (col) => cellValue(ws.getCell(`${col}${r}`));
      const h = num(t.height);
      if (h && Math.abs(Number(v(c.height)) - h) > 1e-9) errs.push(`${label} ${no}：樹高が${v(c.height)}（正しくは${h}）`);
      const g = girthCell(t, cfg);
      if (g != null && String(v(c.girth)) !== String(g)) errs.push(`${label} ${no}：幹周が「${v(c.girth)}」（正しくは「${g}」）`);
      if (String(v(c.initial)) !== String(t.initialNeeded || '')) errs.push(`${label} ${no}：初期診断の欄が一致しません`);
      const note = noteLines(toHalf(t.notes)).map((x) => '・' + x).join('\n');
      if (String(v(c.note)) !== note) errs.push(`${label} ${no}：特記事項が一致しません`);
      if (String(v(c.treat)) !== toHalf(composeTreat(t, cfg))) errs.push(`${label} ${no}：処置が一致しません`);
    });

    // 図形
    const shapes = await readShapes(zip, files[i].file);
    const done = page.trees.filter((t) => t.done);
    const expectN = done.reduce((a, t) => a + optionColumns(t, cfg).reduce((b, oc) => b + oc.opts.length, 0), 0);
    if (shapes.length !== expectN) errs.push(`${label}：選択肢の図形の数が合いません（${shapes.length}個・予定${expectN}個）`);
    const rowOf = new Map(page.trees.map((t, k) => [half(t.treeNo), fs.firstRow - 1 + k * fs.rowsPerTree])); // 0始まり
    for (const sp of shapes) {
      const [no, col] = sp.tag.split('|');
      if (!rowOf.has(no)) {
        errs.push(`${label}：この用紙にない木（${no}）の○が付いています`);
        continue;
      }
      const r0 = rowOf.get(no);
      if (sp.row < r0 || sp.row > r0 + fs.rowsPerTree - 1 || +col !== sp.col)
        errs.push(`${label} ${no}：選択肢の図形が別の場所（${sp.row + 1}行目・${sp.col + 1}列目）にあります`);
    }
    for (const t of done) {
      const no = half(t.treeNo);
      for (const oc of optionColumns(t, cfg)) {
        const sel = shapes.filter((sp) => sp.no === no && sp.colTag === oc.col && sp.sel).map((sp) => sp.v);
        const want = oc.val && oc.opts.some((o) => o.v === oc.val) ? [oc.val] : [];
        if (sel.join() !== want.join()) errs.push(`${label} ${no}：${oc.field} の○が「${sel.join('・') || 'なし'}」（正しくは「${want.join() || 'なし'}」）`);
      }
    }
  }
  return errs;
}

// シートの図形を読み出す：[{ tag, no, colTag, v, sel, row（0始まり）, col（0始まり）, ellipse }]
async function readShapes(zip, sheetPath) {
  const base = sheetPath.split('/').pop();
  const rel = zip.file(`xl/worksheets/_rels/${base}.rels`);
  if (!rel) return [];
  const relXml = await rel.async('string');
  const target = (relXml.match(/Type="[^"]*\/drawing"[^>]*Target="\.\.\/drawings\/([^"]+)"/) || relXml.match(/Target="\.\.\/drawings\/([^"]+)"[^>]*Type="[^"]*\/drawing"/) || [])[1];
  if (!target || !zip.file(`xl/drawings/${target}`)) return [];
  const xml = await zip.file(`xl/drawings/${target}`).async('string');
  return [...xml.matchAll(/<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>/g)].map((m) => {
    const a = m[0];
    const tag = xmlUnesc((a.match(/<xdr:cNvPr [^>]*name="([^"]*)"/) || [])[1] || '');
    const [no, colTag, v, s] = tag.split('|');
    const from = a.match(/<xdr:from><xdr:col>(\d+)<\/xdr:col>.*?<xdr:row>(\d+)<\/xdr:row>/);
    const ellipse = /prst="ellipse"/.test(a);
    return { tag, no, colTag: +colTag, v, sel: s === '1' && ellipse, row: from ? +from[2] : -1, col: from ? +from[1] : -1, ellipse };
  });
}
