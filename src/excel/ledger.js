// 台帳（樹木一覧の Excel）の読み込みと、アプリのデータへの取り込み
//
// 列は位置で決め打ちせず、見出しの文字（設定 cfg.dbFormat.columns の正規表現）で探す。
// 台帳で入力済みの木（doneKey の列に値がある木）は、台帳の値を正とする。
//   アプリでも入力済みだった場合は、アプリの入力を控え（appBackup）として残す。

import ExcelJS from 'exceljs';
import { noteLines } from '../core/notes.js';
import { toHalf } from '../core/text.js';
import { blankTree } from '../core/tree.js';
import { cellValue, normalizeHeader, ymdOfCell } from './cell.js';

// 取り込みで特別に扱う列（それ以外の列は、入力済みの木ならそのまま文字で写す）
const SPECIAL = ['treeNo', 'species', 'height', 'girth', 'branchRatio', 'note', 'treat', 'photo', 'date', 'inspector', 'heightRatio'];

// シートの見出し行から「列のキー → 列番号」を作る
export function columnMap(ws, f) {
  const map = {};
  ws.getRow(f.headerRow).eachCell((c, col) => {
    const h = normalizeHeader(cellValue(c));
    for (const [key, re] of Object.entries(f.columns)) {
      if (map[key] === undefined && new RegExp(re).test(h)) map[key] = col;
    }
  });
  return map;
}

// 台帳を読み、行の一覧を返す
// 返す形：{ rows: [{ sheetType, sheetName, rowNumber, values: { 列のキー: 値 } }], sheets: [...] }
export async function readLedger(buffer, cfg) {
  const f = cfg.dbFormat;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rows = [];
  const sheets = [];
  wb.worksheets.forEach((ws) => {
    const map = columnMap(ws, f);
    const type = f.sheets.find((s) => map[s.identify] !== undefined);
    if (!type || map.treeNo === undefined) return;
    // 見出しの並び（列の順のキーと、見出しの文字）。一覧表形式の表示を一覧表と同じ並びにするため
    const order = Object.entries(map)
      .sort((a, b) => a[1] - b[1])
      .map(([key, col]) => ({ key, header: String(cellValue(ws.getRow(f.headerRow).getCell(col)) ?? '').replace(/\s+/g, ' ').trim() }));
    sheets.push({ name: ws.name, type: type.type, columns: map, order });
    ws.eachRow((row, r) => {
      if (r < f.dataRow) return;
      const values = {};
      for (const [key, col] of Object.entries(map)) values[key] = cellValue(row.getCell(col));
      if (!toHalf(values.treeNo).trim()) return;
      rows.push({ sheetType: type.type, sheetName: ws.name, rowNumber: r, values });
    });
  });
  return { rows, sheets };
}

// 「有(3本)」→ ['有', '3']（strip に指定した文字は取り除く）
function splitParen(v, strip) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(.+?)[(（](.*?)[)）]$/);
  if (!m) return [s, ''];
  const detail = strip ? m[2].split(strip).join('') : m[2];
  return [m[1].trim(), detail.trim()];
}

// 木を見分ける鍵
//  同じ番号でもシートの種類が違えば別の木。
//  台帳の中で同じ番号が重複している場合は、上から何本目か（dupIndex）で見分ける
export const treeKey = (sheetType, treeNo, dupIndex = 1) => `${sheetType}|${toHalf(treeNo).trim()}|${dupIndex || 1}`;

// 台帳の行をアプリの木のデータに取り込む。元の配列・木は書き換えず、新しい配列を返す
// 返す形：{ trees, stats: { all, done, conflicts, duplicates: [番号…] } }
export function mergeLedger(trees, rows, cfg) {
  const f = cfg.dbFormat;
  const out = trees.map((t) => ({ ...t }));
  // 台帳の行と結び付いている木は「番号＋何本目か」で探す
  const byKey = new Map(out.filter((t) => t.ledgerRow).map((t) => [treeKey(t.siteType, t.treeNo, t.dupIndex), t]));
  // 追加した木（台帳の行と結び付いていない木）は、番号に加えて場所の名前も合うときだけ台帳の行と結び付ける
  //  （現地の番号札が台帳では別の場所の木の番号だったとき、その木と取り違えないため）
  const addedByKey = new Map();
  for (const t of out) {
    if (t.ledgerRow) continue;
    const k = treeKey(t.siteType, t.treeNo, t.dupIndex);
    if (!addedByKey.has(k)) addedByKey.set(k, []);
    addedByKey.get(k).push(t);
  }
  const identifyOf = (type) => f.sheets.find((s) => s.type === type)?.identify;
  //  場所の名前がまだない木（台帳を読み込む前に入力した木など）は、番号だけで結び付ける（今までどおり）
  const samePlace = (t, row) => {
    const k = identifyOf(row.sheetType);
    const mine = toHalf(String((k && t[k]) ?? '')).trim();
    return !mine || mine === toHalf(String(row.values[k] ?? '')).trim();
  };
  const takeAdded = (key, row) => {
    const list = addedByKey.get(key) || [];
    const i = list.findIndex((t) => samePlace(t, row));
    return i < 0 ? null : list.splice(i, 1)[0];
  };
  const usedIds = new Set(out.map((t) => t.id));
  const seen = new Set();
  const countByNo = new Map(); // 番号ごとに、これまでに何行出てきたか
  const stats = { all: 0, done: 0, conflicts: 0, duplicates: [] };
  let order = 0;

  for (const row of rows) {
    const v = row.values;
    const str = (k) => String(v[k] ?? '').trim();
    const no = toHalf(str('treeNo'));
    // 台帳の中で番号が重複していても、行を捨てずに別の木として取り込む（2本目以降は dupIndex で区別）
    const noKey = `${row.sheetType}|${no}`;
    const dupIndex = (countByNo.get(noKey) || 0) + 1;
    countByNo.set(noKey, dupIndex);
    if (dupIndex === 2) stats.duplicates.push(no);
    const key = treeKey(row.sheetType, no, dupIndex);
    seen.add(key);
    stats.all++;

    let t = byKey.get(key) || takeAdded(key, row);
    if (!t) {
      // 印（id）は、ほかの木と重ならないようにする（台帳の木の番号が書き換えられて、同じ印の木が残っていることがある）
      let id = `ledger:${key}`;
      for (let n = 2; usedIds.has(id); n++) id = `ledger:${key}#${n}`;
      usedIds.add(id);
      t = blankTree({ id, treeNo: no, siteType: row.sheetType, dupIndex });
      out.push(t);
      byKey.set(key, t);
    }
    order++;
    t.order = order;
    t.ledgerRow = { sheet: row.sheetName, row: row.rowNumber };
    // 場所などの情報は毎回台帳から写す
    for (const k of f.infoKeys) if (k in v) t[k] = str(k);
    t.ledgerSpecies = str('species'); // 書き戻すときの照合用（アプリで樹種を直しても、これは台帳のまま）
    if (f.serialKey) t.ledgerSerial = str(f.serialKey); // 一覧表形式の表示用（通し番号）
    if (!t.species) t.species = str('species');
    const st = f.serialStatus?.[str(f.serialKey)];
    if (st) t.status = st;

    // 台帳で入力済みか
    if (!str(f.doneKey)) continue;
    stats.done++;
    if (t.done && t.source !== 'ledger') {
      const { appBackup, ...keep } = t; // 控えの中に控えを入れない
      t.appBackup = structuredClone(keep);
      stats.conflicts++;
    }

    Object.assign(t, {
      source: 'ledger',
      done: true,
      ledgerDate: ymdOfCell(v.date),
      ledgerInspector: str('inspector'),
      height: str('height'),
      girths: [str('girth')],
      branchLen: '',
      branchDia: '',
      ledgerBranchRatio: typeof v.branchRatio === 'number' ? String(Math.round(v.branchRatio * 100) / 100) : str('branchRatio'),
      notes: noteLines(str('note').replace(/。(?!$)/g, '。\n'))
        .map((x) => '・' + x)
        .join('\n'),
      dbNote: str('note'),
      dbNoteManual: true,
      treatSel: [],
      treatFree: str('treat'),
      photoOverride: str('photo'),
    });
    // その他の列は文字のまま写す（点検項目・健全度・伐採理由など）
    for (const k of Object.keys(f.columns)) {
      if (SPECIAL.includes(k) || f.infoKeys.includes(k) || k === f.serialKey || !(k in v)) continue;
      let val = str(k);
      const rep = f.replace?.[k];
      if (rep) for (const [from, to] of Object.entries(rep)) val = val.split(from).join(to);
      const paren = f.parenKeys?.[k];
      if (paren) {
        const [head, detail] = splitParen(val, paren.strip);
        val = head;
        t[paren.field] = detail;
      }
      t[k] = val;
    }
  }

  // 台帳の行と結び付いていたのに、今の台帳にない木（番号が書き換えられた木・台帳から消えた行）に印を付ける。
  //  この印の木は追加した木と同じく削除できる（actions.js の isAddedTree）。一覧表への書き戻しでは、行が見つからないとして止める
  for (const t of out) {
    if (!t.ledgerRow) continue;
    if (seen.has(treeKey(t.siteType, t.treeNo, t.dupIndex))) delete t.ledgerGone;
    else t.ledgerGone = true;
  }
  // 台帳の並び順にそろえる（台帳にない木は元の順のまま後ろへ）
  const rank = (t, i) => (t.order && seen.has(treeKey(t.siteType, t.treeNo, t.dupIndex)) ? t.order : 1e6 + i);
  const sorted = out.map((t, i) => [rank(t, i), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  // 番号が重複している木に印を付ける（画面で注意を出す）
  for (const t of sorted) {
    const n = countByNo.get(`${t.siteType}|${toHalf(t.treeNo).trim()}`) || 0;
    t.ledgerDuplicate = n > 1 ? n : 0;
  }
  return { trees: sorted, stats };
}
