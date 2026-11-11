// 一覧型の野帳（原本を使わず、設定 listSheet の列で一から作る。1本1行・A3 横など）
//  ・用紙の上：まとまり（公園・路線）の情報（設定 header）と診断日
//  ・表：見出し2行（group が同じ列は上の行をまとめる）＋ rowsPerSheet 行。入力した値は色を変える（penColor）
//  ・まとまりが変わったら新しい用紙（シート）から。1枚に入らなければ次の用紙へ
//  ・書き出したら読み直して全件照合し、1件でも違えば保存しない（CLAUDE.md 5章）
//
// 列の key（設定 listSheet.columns）：
//  treeNo・species など木の項目はその値。点検項目は「無」を noneMark（例「－」）に、ほかは選択肢の文字のまま
//  girth：単幹は入れた数のまま、株立は「各幹周+…」と「→記録値」の2行
//  branch：「枝長/枝径」（入れた数のまま）
//  remarks：備考。「有」のとき入れた項目を「項目：内容」で並べ、特記事項の文を足す（listRemarks）
//  列の blank：値が空のときに書く文字（例 枝下の「－」）
import ExcelJS from 'exceljs';
import { girthOf } from '../core/calc.js';
import { groupKey, groupLabel } from '../core/groups.js';
import { fullNotesOf } from '../core/noteMeasures.js';
import { isLocked } from '../core/tree.js';
import { fitSize } from './fitText.js';

import { PAPER } from '../core/listSheetConfig.js';
const PT_PER_CHAR = 5.6; // 列の幅（文字数）1 あたりのおよその幅（pt）

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};
const str = (v) => String(v ?? '').trim();

// 「有」のとき入れた項目を、点検項目ごとに「項目：内容」で並べ、特記事項の文を足す
//  項目の名前は、details の label の「：」より前（例「腐朽：部位・大きさ」→「腐朽」）。なければ点検項目の名前
//  details の noteText（例「H={v}m」）があれば、その形で書く
export function listRemarks(tree, cfg) {
  const ls = cfg.listSheet || {};
  const join = ls.remarksJoin ?? '／';
  const locked = isLocked(tree, cfg);
  const parts = [];
  const fields = [...cfg.checks.map((c) => ({ key: c.key, label: c.label, lockable: !c.always })), { key: 'initialNeeded', label: cfg.initial.label, lockable: false }];
  for (const f of fields) {
    if (locked && f.lockable) continue;
    const ds = cfg.details.filter((d) => d.when.field === f.key && tree[f.key] === d.when.eq);
    const vals = ds.map((d) => ({ d, v: str(tree[d.field]) })).filter((x) => x.v);
    if (!vals.length) continue;
    const name = ds[0].label.includes('：') ? ds[0].label.split('：')[0] : f.label;
    parts.push(`${name}：${vals.map(({ d, v }) => (d.noteText ? d.noteText.replace('{v}', v) : v)).join(' ')}`);
  }
  const free = String(fullNotesOf(tree, cfg) || '')
    .split('\n')
    .map(str)
    .filter(Boolean);
  return [...parts, ...free].join(join);
}

// 1つの欄に書く文字
export function listCellText(tree, col, cfg) {
  const ls = cfg.listSheet || {};
  let v = '';
  if (col.key === 'girth') {
    const gs = (tree.girths || []).map(str).filter(Boolean);
    const g = girthOf(tree, cfg);
    v = gs.length > 1 && g != null ? `${gs.join('+')}\n→${g.toFixed(2)}` : gs[0] || ''; // 株立は2行（各幹周／記録値）
  } else if (col.key === 'branch') {
    v = str(tree.branchLen) || str(tree.branchDia) ? `${str(tree.branchLen)}/${str(tree.branchDia)}` : '';
  } else if (col.key === 'remarks') {
    v = listRemarks(tree, cfg);
  } else if (cfg.checks.some((c) => c.key === col.key)) {
    const c = cfg.checks.find((x) => x.key === col.key);
    v = isLocked(tree, cfg) && !c.always ? '' : str(tree[col.key]);
    if (v && v === ls.noneValue) v = ls.noneMark ?? v;
  } else {
    v = str(tree[col.key]);
  }
  return v || (col.blank ?? '');
}

// 診断日の文字（用紙の木が同じ日ならその日、違う日が混じれば最初の日＋「ほか」）
function dateText(trees, ls) {
  const ds = [...new Set(trees.map((t) => str(t.date)).filter(Boolean))].sort();
  if (!ds.length) return '';
  const [y, m, d] = ds[0].split('-').map(Number);
  const tpl = ls.dateTemplate || '{y}年{m}月{d}日';
  const s = tpl.replace('{y}', String(y - (ls.eraOffset ?? 0))).replace('{m}', String(m)).replace('{d}', String(d));
  return ds.length > 1 ? s + (ls.multiDateSuffix ?? 'ほか') : s;
}

// 用紙に分ける：まとまりごとに新しい用紙、1枚 rowsPerSheet 本まで
export function listPages(trees, cfg) {
  const ls = cfg.listSheet;
  const per = ls.rowsPerSheet;
  const byGroup = new Map();
  for (const t of trees) {
    const k = groupKey(t, cfg);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(t);
  }
  const pages = [];
  for (const [k, ts] of byGroup) {
    const n = Math.max(1, Math.ceil(ts.length / per));
    for (let i = 0; i < n; i++) {
      const part = ts.slice(i * per, (i + 1) * per);
      pages.push({
        group: k,
        label: groupLabel(trees, k, cfg).replace(/^\[.*?\]\s*/, ''),
        no: i + 1,
        of: n,
        info: (ls.header || []).map((h) => ({ label: h.label, value: str(ts[0]?.[h.key]) })),
        date: dateText(part, ls),
        rows: part.map((t) => ls.columns.map((c) => listCellText(t, c, cfg))),
      });
    }
  }
  return pages;
}

// シートの名前（Excel で使えない文字を除き、31文字まで。重なれば番号を足す）
function sheetNames(pages) {
  const used = new Set();
  return pages.map((p) => {
    const base = `${p.label || '野帳'}${p.of > 1 ? `_${p.no}` : ''}`.replace(/[[\]:*?/\\]/g, '・').slice(0, 28) || '野帳';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}(${i})`;
    used.add(name);
    return name;
  });
}

// 表の位置（照合でも使う）：1行目は用紙の上の情報、2・3行目は見出し、4行目から木
const FIRST_ROW = 4;

// 一覧型の野帳を作る。返す形：{ buffer, errors（照合で見つかった食い違い）, long（文字を小さくしても収まらない欄） }
export async function exportListSheet(pages, cfg) {
  const ls = cfg.listSheet;
  const cols = ls.columns;
  const font = ls.font || 'ＭＳ ゴシック';
  const base = ls.fontPt ?? 10;
  const pen = { argb: ls.penColor || 'FF1F3D99' };
  const rowH = ls.rowHeightPt ?? 19;
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const BOX = { top: thin, left: thin, bottom: thin, right: thin };
  const wb = new ExcelJS.Workbook();
  const names = sheetNames(pages);
  const long = [];

  pages.forEach((p, pi) => {
    const ws = wb.addWorksheet(names[pi], {
      pageSetup: {
        paperSize: PAPER[ls.paper] ?? PAPER.A3,
        orientation: ls.landscape === false ? 'portrait' : 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    });
    ws.headerFooter.oddFooter = `&R${p.no}／${p.of}枚`;
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? 6));

    // 1行目：まとまりの情報（見出しと値を交互に）と、右端に診断日
    const top = ws.getRow(1);
    top.height = 24;
    let ci = 1;
    for (const h of p.info) {
      const lc = top.getCell(ci);
      lc.value = h.label;
      lc.font = { name: font, size: base };
      lc.alignment = { vertical: 'bottom', horizontal: 'right' };
      const vc = top.getCell(ci + 1);
      vc.value = h.value;
      vc.font = { name: font, size: base + 3, bold: true, color: pen };
      vc.alignment = { vertical: 'bottom' };
      vc.border = { bottom: thin };
      ws.mergeCells(1, ci + 1, 1, ci + 3);
      ci += 5;
    }
    const last = cols.length;
    const dl = top.getCell(last - 3);
    dl.value = ls.dateLabel ?? '診断日：';
    dl.font = { name: font, size: base };
    dl.alignment = { vertical: 'bottom', horizontal: 'right' };
    const dv = top.getCell(last - 2);
    dv.value = p.date;
    dv.font = { name: font, size: base + 3, bold: true, color: pen };
    dv.alignment = { vertical: 'bottom' };
    dv.border = { bottom: thin };
    ws.mergeCells(1, last - 2, 1, last);

    // 2・3行目：見出し（group が同じ列は2行目をまとめ、3行目に各列の名前）
    // 見出しは2行分（まとめない列は2行をつないで使う）。長い名前は設定の label に改行（\n）を入れて折り返す
    ws.getRow(2).height = ls.headRowPt ?? 20;
    ws.getRow(3).height = ls.headRowPt ?? 20;
    const head = (r, col, v) => {
      const cell = ws.getRow(r).getCell(col + 1);
      cell.value = v;
      cell.font = { name: font, size: ls.headFontPt ?? base - 1 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
    };
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.group) {
        // 同じ group が続く列：2行目はまとめて group の名前、3行目に各列の名前
        let j = i;
        while (j + 1 < cols.length && cols[j + 1].group === c.group) j++;
        for (let k = i; k <= j; k++) {
          head(2, k, c.group);
          head(3, k, cols[k].label);
        }
        if (j > i) ws.mergeCells(2, i + 1, 2, j + 1);
        i = j;
      } else {
        head(2, i, c.label);
        head(3, i, '');
        ws.mergeCells(2, i + 1, 3, i + 1);
      }
    }

    // 4行目から：木。空の行も枠だけ書く（紙の野帳としても使える）
    for (let r = 0; r < ls.rowsPerSheet; r++) {
      const row = ws.getRow(FIRST_ROW + r);
      row.height = rowH;
      const vals = p.rows[r] || [];
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = vals[i] ?? '';
        cell.border = BOX;
        cell.alignment = { horizontal: c.align || 'center', vertical: 'middle' };
        cell.font = { name: font, size: base, color: pen };
        if (!v) return;
        cell.value = v;
        // 長い文（備考など）は、折り返して文字を小さくし、枠に収める
        const fit = fitSize(v, { width: (c.width ?? 6) * PT_PER_CHAR - 2, height: rowH }, base, ls.minFontPt ?? 6);
        if (fit.size !== base || fit.wrap) {
          cell.font = { name: font, size: fit.size, color: pen };
          cell.alignment = { ...cell.alignment, wrapText: true };
        }
        if (!fit.fits) long.push({ page: names[pi], row: r + 1, label: c.label, treeNo: vals[0] });
      });
    }
    ws.pageSetup.printArea = `A1:${ws.getColumn(cols.length).letter}${FIRST_ROW + ls.rowsPerSheet - 1}`;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const errors = await checkListSheet(buffer, pages, names, cfg);
  return { buffer, errors, long };
}

// 書き出したファイルを読み直して、全件照合する（シートの数と名前・用紙の上の情報・見出し・各欄の文字・空の行）
export async function checkListSheet(buffer, pages, names, cfg) {
  const ls = cfg.listSheet;
  const cols = ls.columns;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const errors = [];
  const text = (cell) => {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object' && v.richText) return v.richText.map((x) => x.text).join('');
    return String(v);
  };
  if (wb.worksheets.length !== pages.length) errors.push(`用紙の数が違います（${wb.worksheets.length}枚。${pages.length}枚のはず）`);
  pages.forEach((p, pi) => {
    const ws = wb.getWorksheet(names[pi]);
    if (!ws) return errors.push(`用紙「${names[pi]}」がありません`);
    p.info.forEach((h, i) => {
      if (text(ws.getRow(1).getCell(i * 5 + 2)) !== h.value) errors.push(`${names[pi]}：${h.label}が違います`);
    });
    if (text(ws.getRow(1).getCell(cols.length - 2)) !== p.date) errors.push(`${names[pi]}：診断日が違います`);
    cols.forEach((c, i) => {
      const h = c.group ? text(ws.getRow(3).getCell(i + 1)) : text(ws.getRow(2).getCell(i + 1));
      if (h !== c.label) errors.push(`${names[pi]}：${i + 1}列目の見出しが違います（${h}）`);
    });
    for (let r = 0; r < ls.rowsPerSheet; r++) {
      const vals = p.rows[r] || [];
      cols.forEach((c, i) => {
        const got = text(ws.getRow(FIRST_ROW + r).getCell(i + 1));
        const want = vals[i] ?? '';
        if (got !== want) errors.push(`${names[pi]}：${r + 1}行目の${c.label}が違います（「${got}」。「${want}」のはず）`);
      });
    }
    const after = ws.getRow(FIRST_ROW + ls.rowsPerSheet);
    if (cols.some((c, i) => text(after.getCell(i + 1)))) errors.push(`${names[pi]}：表の下に余分な値があります`);
  });
  return errors;
}
