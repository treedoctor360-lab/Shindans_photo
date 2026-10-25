// 一覧表（台帳と同じ Excel）への書き戻しと、書き戻し後の照合
//
// 約束（壊さないため）
//  - 書くのは「アプリで入力した木」の行だけ。他の行・他の列には触らない
//  - 行は「番号＋上から何本目か」で決め、書く前に場所の名前・台帳の樹種が合うか照合する。合わなければ書かない
//  - 台帳側で既に入力済みになっていた木は書かない（台帳を正とする）
//  - 書き出したファイルを読み直して全件照合し、1件でも食い違えばファイルを返さない

import ExcelJS from 'exceljs';
import { branchRatioCell, girthOf, heightRatioOf } from '../core/calc.js';
import { dbNoteOf } from '../core/notes.js';
import { photoFlag } from '../core/photo.js';
import { fill, num, toHalf } from '../core/text.js';
import { composeTreat } from '../core/treat.js';
import { isCheckKey, isLocked } from '../core/tree.js';
import { cellValue, ymdOfCell } from './cell.js';
import { columnMap } from './ledger.js';
import { definedNamesXml, externalLinkParts, finishXlsx, restoreDefinedNames, restoreExternalLinks } from './xlsxFix.js';

const half = (v) => toHalf(v).trim();

// 「有」＋詳細 → 「有(3本)」の形にする（設定 dbFormat.parenKeys）
function withParen(value, tree, p) {
  if (!p || value !== p.when) return value;
  let detail = half(tree[p.field]);
  if (p.alias?.[detail] != null) detail = p.alias[detail];
  return `${value}(${detail || p.blank || ''}${p.strip || ''})`;
}

// 日付 "2099-04-05" → Excel の日付（世界標準時の0時。Excel の日付には時差がないため）
const excelDate = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, d)) : null;
};

// 一覧表のセルに書く値（列のキー → 値）。空欄は null
export function dbValues(tree, cfg) {
  const f = cfg.dbFormat;
  const locked = isLocked(tree, cfg);
  const special = {
    date: () => excelDate(tree.date),
    inspector: () => tree.inspector,
    species: () => tree.species,
    height: () => num(tree.height),
    girth: () => girthOf(tree, cfg),
    heightRatio: () => heightRatioOf(tree, cfg), // 実際には式で書く（下の writeRow）
    branchRatio: () => branchRatioCell(tree, cfg),
    note: () => toHalf(dbNoteOf(tree, cfg)),
    // 詳しい診断が必要な木の健全度は、詳しい診断の結果を書き戻すとき（initialGrade）だけ書く。それまでは空欄
    grade: () => (tree.initialNeeded === cfg.initial.yes ? tree.initialGrade || '' : tree.grade),
    treat: () => toHalf(composeTreat(tree, cfg)),
    photo: () => photoFlag(tree, cfg),
  };
  const out = {};
  for (const k of f.writeKeys) {
    let v;
    if (special[k]) v = special[k]();
    else if (locked && isCheckKey(k, cfg)) v = '';
    else v = withParen(tree[k] ?? '', tree, f.parenKeys?.[k]);
    out[k] = v === '' || v === undefined ? null : v;
  }
  return out;
}

// 樹高/幹径の式（設定の {height} {girth} をセルの番地に置き換える）
const ratioFormula = (f, map, ws, r) =>
  fill(f.heightRatioFormula, { height: ws.getColumn(map.height).letter + r, girth: ws.getColumn(map.girth).letter + r });

// シートの「番号＋何本目か → 行番号」の対応表と、最後のデータ行
function indexRows(ws, map, f) {
  const index = new Map();
  const count = new Map();
  const rowsByNo = new Map(); // 番号 → その番号の行番号の一覧（上から順）
  let last = f.dataRow - 1;
  ws.eachRow((row, r) => {
    if (r < f.dataRow) return;
    const no = half(cellValue(row.getCell(map.treeNo)));
    if (!no) return;
    const n = (count.get(no) || 0) + 1;
    count.set(no, n);
    index.set(`${no}|${n}`, r);
    if (!rowsByNo.has(no)) rowsByNo.set(no, []);
    rowsByNo.get(no).push(r);
    last = Math.max(last, r);
  });
  return { index, count, rowsByNo, last };
}

// 書き戻す。返す形：{ buffer（照合に通ったときだけ）, stats, errors }
export async function exportDb(ledgerBuffer, trees, cfg) {
  const f = cfg.dbFormat;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ledgerBuffer);
  const errors = [];
  const plan = []; // 照合用：書いた行と、書いた値
  // gradeOnly：台帳で入力済みの行に健全度だけ書いた木、gradeKept：健全度が既に入っていて違う値だったので書かなかった木
  const stats = { written: 0, appended: 0, skippedLedgerDone: [], gradeOnly: [], gradeKept: [] };

  // 書く木：アプリで入力した木と、台帳で入力済みの木（紙から手で入力した行）のうち詳しい診断の結果（initialGrade）を付けた木
  const mine = trees.filter((t) => (t.done && t.source === 'app') || (t.source !== 'app' && t.initialGrade));
  for (const ws of wb.worksheets) {
    const map = columnMap(ws, f);
    const spec = f.sheets.find((s) => map[s.identify] !== undefined);
    if (!spec || map.treeNo === undefined) continue;
    const { index, rowsByNo, last } = indexRows(ws, map, f);
    // その番号の行のうち、場所の名前が合う最初の行
    const samePlaceRow = (no, t) =>
      (rowsByNo.get(no) || []).find((r) => half(cellValue(ws.getRow(r).getCell(map[spec.identify]))) === half(t[spec.identify]));
    let next = last;

    for (const t of mine.filter((x) => x.siteType === spec.type)) {
      const no = half(t.treeNo);
      const label = t.dupIndex > 1 ? `${no}（${t.dupIndex}本目）` : no;
      // 知らせの文に出す木の名前（どの公園・路線の木か分かるように、場所の名前も付ける）
      const where = `${label}（${t[spec.identify] || '場所なし'}・${t.species || '樹種なし'}）`;
      // 台帳から読み込んだ木は「番号＋何本目か」の行。
      // 追加した木は、同じ番号で場所の名前も合う行（前に書き戻して足した行）。なければ末尾に足す
      //  （現地の番号札が、台帳では別の場所の木の番号だったとき、その行に書かないため）
      let r = t.ledgerRow ? index.get(`${no}|${t.dupIndex || 1}`) : samePlaceRow(no, t);
      const row = r ? ws.getRow(r) : null;

      if (row) {
        // 行の取り違えを防ぐ照合
        const place = half(cellValue(row.getCell(map[spec.identify])));
        if (place !== half(t[spec.identify])) {
          errors.push(`${ws.name} ${where}：一覧表の${r}行目の場所「${place}」が、アプリの「${t[spec.identify] || ''}」と違います`);
          continue;
        }
        const sp = map.species ? half(cellValue(row.getCell(map.species))) : '';
        if (t.ledgerSpecies != null && map.species && sp !== half(t.ledgerSpecies)) {
          errors.push(`${ws.name} ${where}：一覧表の${r}行目の樹種「${sp}」が、読み込んだときの「${t.ledgerSpecies}」と違います`);
          continue;
        }
        if (t.source !== 'app' || half(cellValue(row.getCell(map[f.doneKey])))) {
          // 一覧表で入力済みの行 → 入力内容は書かない（台帳を正とする）
          if (t.source === 'app') stats.skippedLedgerDone.push(label);
          // 詳しい診断の結果があれば、健全度が空欄のときだけ健全度を書く
          if (t.initialGrade && map.grade !== undefined) {
            const now = half(cellValue(row.getCell(map.grade)));
            if (!now) {
              row.getCell(map.grade).value = t.initialGrade;
              row.commit();
              stats.gradeOnly.push(label);
              plan.push({ sheet: ws.name, row: r, label, appended: false, values: { grade: t.initialGrade }, columns: [map.grade], formula: null });
            } else if (now !== half(t.initialGrade)) stats.gradeKept.push({ label, now, grade: t.initialGrade });
          }
          continue;
        }
        stats.written++;
      } else {
        if (t.source !== 'app' || t.dupIndex > 1 || t.ledgerRow) {
          errors.push(
            `${ws.name} ${where}：読み込んだときにあった行が、一覧表に見つかりません${t.ledgerGone ? '（読み込み直した一覧表にこの番号がありません。番号が変わったか、行が消されています。一覧の検索で「すべての公園・路線」を選んで探せます）' : ''}`,
          );
          continue;
        }
        r = ++next;
        stats.appended++;
      }

      const target = ws.getRow(r);
      const values = dbValues(t, cfg);
      if (!row) {
        // 一覧表にない木は末尾に行を足す（番号・場所なども書く）
        values[f.serialKey] = f.serialFor?.[t.status] ?? f.newSerial;
        values.treeNo = no;
        for (const k of f.infoKeys) values[k] = t[k] || null;
      }
      for (const [k, v] of Object.entries(values)) {
        if (map[k] === undefined) continue;
        if (k === 'heightRatio' && f.heightRatioFormula && map.height !== undefined && map.girth !== undefined)
          target.getCell(map[k]).value = { formula: ratioFormula(f, map, ws, r), result: v ?? undefined };
        else target.getCell(map[k]).value = v;
      }
      target.commit();
      plan.push({
        sheet: ws.name,
        row: r,
        label,
        appended: !row,
        values,
        columns: Object.keys(values).filter((k) => map[k] !== undefined).map((k) => map[k]),
        formula: values.heightRatio !== undefined ? ratioFormula(f, map, ws, r) : null,
      });
    }
  }
  if (errors.length) return { buffer: null, stats, errors };

  wb.creator = '';
  wb.lastModifiedBy = '';
  // ExcelJS が崩す・落とす部分（名前付き範囲・外部リンク）を元のファイルのとおりに戻す
  const out = await restoreExternalLinks(await restoreDefinedNames(await finishXlsx(await wb.xlsx.writeBuffer()), ledgerBuffer), ledgerBuffer);
  const check = await verifyDb(out, ledgerBuffer, plan, cfg);
  return check.length ? { buffer: null, stats, errors: check, plan } : { buffer: out, stats, errors: [], plan };
}

// 2つの値が同じか（日付は年月日、数は誤差の範囲で比べる）
function same(a, b) {
  if (a instanceof Date || b instanceof Date) return ymdOfCell(a) === ymdOfCell(b);
  if (a === null || a === undefined) a = '';
  if (b === null || b === undefined) b = '';
  if (typeof a === 'number' || typeof b === 'number') return a !== '' && b !== '' && Math.abs(Number(a) - Number(b)) < 1e-9;
  return String(a) === String(b);
}

// セルの中身を比べられる形にする（式は式の文字、それ以外は値）
const raw = (cell) => {
  const v = cell.value;
  if (v && typeof v === 'object' && 'formula' in v) return `=${v.formula}`;
  if (v && typeof v === 'object' && 'sharedFormula' in v) return `=${cell.formula}`;
  return cellValue(cell);
};

// 書き出したファイルを読み直して照合する。食い違いの一覧を返す（空なら合格）
//  1. 書いた行：全項目が書いたとおりか（樹高/幹径は式も確認）
//  2. 書いていない行：全セルが元のファイルと同じか
//  3. 番号の行数：元のファイルと同じ（末尾に足した木は +1）か
export async function verifyDb(outBuffer, origBuffer, plan, cfg) {
  const f = cfg.dbFormat;
  const errs = [];
  const wbO = new ExcelJS.Workbook();
  await wbO.xlsx.load(origBuffer);
  const wbN = new ExcelJS.Workbook();
  await wbN.xlsx.load(outBuffer);

  // 名前付き範囲（オートフィルター・印刷範囲など）が元のファイルと1文字も違わないか（崩れていると Excel で「修復」になる）
  if ((await definedNamesXml(outBuffer)) !== (await definedNamesXml(origBuffer))) errs.push('名前付き範囲（オートフィルター・印刷範囲など）が元のファイルと違います');
  // 外部リンク（別のブックを指す名前付き範囲の参照先）が元のファイルと同じ並び・同じ中身か（なくなっていると Excel で「修復」になる）
  if (JSON.stringify(await externalLinkParts(outBuffer)) !== JSON.stringify(await externalLinkParts(origBuffer)))
    errs.push('外部リンク（別のブックを参照する名前付き範囲の参照先）が元のファイルと違います');

  // 元のファイルのシートが、書き出したファイルにも全部あるか（シートごと消えていないか）
  for (const wsO of wbO.worksheets) if (!wbN.getWorksheet(wsO.name)) errs.push(`シート「${wsO.name}」が書き出したファイルにありません`);

  for (const wsN of wbN.worksheets) {
    const wsO = wbO.getWorksheet(wsN.name);
    if (!wsO) {
      errs.push(`シート「${wsN.name}」が元のファイルにありません`);
      continue;
    }
    const map = columnMap(wsN, f);
    const mine = plan.filter((p) => p.sheet === wsN.name);
    // 行番号 → 書いた列番号の集まり
    const written = new Map(mine.map((p) => [p.row, new Set(p.columns)]));

    // 1. 書いた行
    for (const p of mine) {
      const row = wsN.getRow(p.row);
      for (const [k, want] of Object.entries(p.values)) {
        if (map[k] === undefined) continue;
        const cell = row.getCell(map[k]);
        if (k === 'heightRatio' && p.formula) {
          if (raw(cell) !== `=${p.formula}`) errs.push(`${wsN.name} ${p.label}：樹高/幹径の式が「${raw(cell)}」です`);
          continue;
        }
        const got = cellValue(cell);
        if (!same(got, want)) errs.push(`${wsN.name} ${p.label}：${k} が「${got}」（正しくは「${want ?? ''}」）`);
      }
    }

    // 2. 書いていないセルは元のまま（書いた行でも、書いていない列は元のまま）
    const maxRow = Math.max(wsO.rowCount, wsN.rowCount);
    const maxCol = Math.max(wsO.columnCount, wsN.columnCount);
    for (let r = 1; r <= maxRow; r++) {
      const cols = written.get(r);
      const a = wsO.getRow(r);
      const b = wsN.getRow(r);
      for (let c = 1; c <= maxCol; c++) {
        if (cols?.has(c)) continue;
        const va = raw(a.getCell(c));
        const vb = raw(b.getCell(c));
        if (!same(va, vb)) errs.push(`${wsN.name} ${r}行目${c}列目：書き込んでいないセルが「${va}」から「${vb}」に変わっています`);
      }
    }

    // 3. 番号ごとの行数
    if (map.treeNo !== undefined) {
      const countIn = (ws) => {
        const m = new Map();
        ws.eachRow((row, r) => {
          if (r < f.dataRow) return;
          const no = half(cellValue(row.getCell(map.treeNo)));
          if (no) m.set(no, (m.get(no) || 0) + 1);
        });
        return m;
      };
      const before = countIn(wsO);
      const after = countIn(wsN);
      const appended = new Map();
      for (const p of mine) if (p.appended) appended.set(p.values.treeNo, (appended.get(p.values.treeNo) || 0) + 1);
      for (const no of new Set([...before.keys(), ...after.keys()])) {
        const want = (before.get(no) || 0) + (appended.get(no) || 0);
        if ((after.get(no) || 0) !== want) errs.push(`${wsN.name} ${no}：行が${after.get(no) || 0}行あります（正しくは${want}行）`);
      }
    }
  }
  return errs;
}
