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

// 台帳の何本目の行に結び付いているか。追加した木（uid）は、木を見分ける「何本目か」（dupIndex。鍵に入る）を変えずに、
//  結び付いた行の何本目か（rowDup）を別に持つ
export const rowDupOf = (t) => t.rowDup || t.dupIndex || 1;

// 台帳から作っただけで、まだ何も入力していない木か（送ったこともなく、追加した印 uid もない）
export const isBlankLedgerTree = (t) =>
  !!t.ledgerRow && !t.uid && !t.done && !(t.rev > 0) && !t.deleted && !t.vigor && !String(t.notes || '').trim() && !(t.measures || []).length;

// 同じ台帳の行（シートの種類・番号・何本目か）に結び付いた木が2本あり、片方が空の木なら、空の木を除く
export function dropBlankTwins(trees) {
  const k = (t) => treeKey(t.siteType, t.treeNo, rowDupOf(t));
  const filled = new Set(trees.filter((t) => t.ledgerRow && !isBlankLedgerTree(t)).map(k));
  return trees.filter((t) => !(isBlankLedgerTree(t) && filled.has(k(t))));
}

// 台帳の行ごとの「鍵（種類・番号・何本目か）→ 場所の名前」（読み込む前に、行の当たり先が変わる木を調べる）
export function rowPlaces(rows, cfg) {
  const count = new Map();
  const out = new Map();
  for (const row of rows) {
    const no = toHalf(String(row.values.treeNo ?? '')).trim();
    const noKey = `${row.sheetType}|${no}`;
    const n = (count.get(noKey) || 0) + 1;
    count.set(noKey, n);
    const k = cfg.dbFormat.sheets.find((x) => x.type === row.sheetType)?.identify;
    out.set(treeKey(row.sheetType, no, n), toHalf(String((k && row.values[k]) ?? '')).trim());
  }
  return out;
}

// 台帳の行をアプリの木のデータに取り込む。元の配列・木は書き換えず、新しい配列を返す
// 返す形：{ trees, stats: { all, done, conflicts, duplicates: [番号…], goneRemoved: [外した台帳の写しの番号…] … } }
//  keepIds：一覧表から消えても外さない木の id（詳しい診断の記録・付箋・確定がある木。state.js の applyLedger が渡す）
export function mergeLedger(trees, rows, cfg, { keepIds = new Set() } = {}) {
  const f = cfg.dbFormat;
  // 同じ台帳の行に、現場で追加した木と、台帳から作った空の木の両方が結び付いていれば、空の木を除く
  //  （別の端末で追加した木を、新しい行の入った台帳を先に読み込んだ端末が後から受け取ったとき）
  const out = dropBlankTwins(trees.map((t) => ({ ...t })));
  // 台帳の行と結び付いている木は「番号＋何本目か」で探す
  //  追加した木（uid）は、行に結び付いた後も、読み込むたびに「番号＋場所の名前」で結び付け直す
  //  （同じ番号の行が上に入って何本目かがずれても、別の場所の行に当たらない）
  const wasBound = new Set();
  for (const t of out) {
    if (!t.uid || !t.ledgerRow) continue;
    wasBound.add(t.id);
    delete t.ledgerRow;
    delete t.rowDup;
    delete t.ledgerGone;
  }
  const byKey = new Map(out.filter((t) => t.ledgerRow).map((t) => [treeKey(t.siteType, t.treeNo, t.dupIndex), t]));
  // 追加した木（台帳の行と結び付いていない木）は、番号に加えて場所の名前も合うときだけ台帳の行と結び付ける
  //  （現地の番号札が台帳では別の場所の木の番号だったとき、その木と取り違えないため）
  //  同じ番号の行が何本あっても、場所の名前が合う行に結び付ける（何本目かは見ない。追加した木は印 uid で見分けるので、
  //  結び付いた行の「何本目か」を持たせても同じ木のまま）
  const addedByKey = new Map();
  for (const t of out) {
    if (t.ledgerRow) continue;
    const k = `${t.siteType}|${toHalf(t.treeNo).trim()}`;
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
  //  1本目の行には今までどおり（場所の名前がない追加の木も結び付ける）。2本目からの行には、場所の名前が合う木だけ
  const placeOf = (t, row) => {
    const k = identifyOf(row.sheetType);
    return toHalf(String((k && t[k]) ?? '')).trim();
  };
  const takeAdded = (noKey, row, dupIndex) => {
    const list = addedByKey.get(noKey) || [];
    const i = list.findIndex((t) => samePlace(t, row) && (dupIndex === 1 || placeOf(t, row)) && !t.deleted);
    if (i < 0) return null;
    const t = list.splice(i, 1)[0];
    t.rowDup = dupIndex;
    return t;
  };
  const usedIds = new Set(out.map((t) => t.id));
  const seen = new Set();
  const countByNo = new Map(); // 番号ごとに、これまでに何行出てきたか
  // addedBound：現場で追加した木を台帳の行に結び付けた（番号・場所が同じ）。speciesDiff：そのうち樹種が台帳と違う木
  //  addedLeft：台帳の行と結び付かなかった、入力済みの追加した木
  //  goneKept：一覧表から消えた台帳の写しだが、詳しい診断の記録などがあるので残した木。goneBlank：一覧表から消えた空の木（外した）
  //  placeMoved：同じ「番号＋何本目か」の行の場所が変わった、入力のある木（同じ番号の行が上に差し込まれた・行が入れ替わったおそれ）
  const stats = { all: 0, done: 0, conflicts: 0, duplicates: [], addedBound: [], speciesDiff: [], addedLeft: [], goneRemoved: [], goneKept: [], goneBlank: [], placeMoved: [] };
  const placeKeyOf = (type) => identifyOf(type);
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

    let t = byKey.get(key);
    if (!t) {
      t = takeAdded(noKey, row, dupIndex);
      if (t && !wasBound.has(t.id)) {
        stats.addedBound.push(no);
        const sp = toHalf(str('species'));
        if (t.species && sp && toHalf(t.species).trim() !== sp) stats.speciesDiff.push(`${no}（アプリ「${t.species}」／台帳「${sp}」）`);
      }
    }
    if (!t) {
      // 印（id）は、ほかの木と重ならないようにする（台帳の木の番号が書き換えられて、同じ印の木が残っていることがある）
      let id = `ledger:${key}`;
      for (let n = 2; usedIds.has(id); n++) id = `ledger:${key}#${n}`;
      usedIds.add(id);
      t = blankTree({ id, treeNo: no, siteType: row.sheetType, dupIndex });
      out.push(t);
      byKey.set(key, t);
    }
    // 同じ「番号＋何本目か」でも、場所が前と違う行に当たった木：
    //  空の木なら前の場所の樹種を持ち越さない。入力のある木は知らせる（別の木の行かもしれない）
    const pk = placeKeyOf(row.sheetType);
    const was = toHalf(String((pk && t[pk]) ?? '')).trim();
    const moved = !!t.ledgerRow && !!was && was !== toHalf(str(pk)).trim();
    if (moved) {
      // 入力のない木（空の木・空に戻した木）は新しい行の木として扱う
      const hasInput = t.done || !!t.appBackup || !!t.vigor || !!String(t.height || '').trim() || !!String(t.notes || '').trim() || (t.measures || []).length > 0;
      if (!hasInput) t.species = '';
      else if (t.source === 'app' || t.appBackup) stats.placeMoved.push(`${no}（${was} → ${str(pk)}）`);
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
    // 台帳の行を写しただけの木（アプリの入力の控えがない）は、樹種も台帳のとおりにする（台帳で樹種が直されたら従う）
    if (!t.appBackup && str('species')) t.species = str('species');
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
    if (seen.has(treeKey(t.siteType, t.treeNo, rowDupOf(t)))) delete t.ledgerGone;
    else t.ledgerGone = true;
  }
  for (const t of out) if (!t.ledgerRow && t.done && !t.deleted && t.source === 'app') stats.addedLeft.push(toHalf(t.treeNo).trim() || '(番号なし)');
  // 今の台帳にない木のうち、台帳で入力済みの行をそのまま写しただけの木（アプリで入力していない）は外す。
  //  アプリで入力した木・アプリの入力の控え（appBackup）がある木・台帳から作った木（アプリで書いたかもしれない）は残す
  //  （番号を直すか削除するかを人が決める）
  //  詳しい診断の記録・付箋・確定がある木（keepIds）は外さない（外すと、その記録の行き先がなくなる）
  const copyGone = (t) => t.ledgerGone && t.source === 'ledger' && !t.appBackup && !t.conflict;
  const copyOnly = (t) => copyGone(t) && !keepIds.has(t.id);
  // 一覧表から消えた、何も入力していない空の木も外す
  //  （樹種を直した・寸法を入れた・番号を消した木は、何か書いた木として残す）
  const half = (v) => toHalf(String(v ?? '')).trim();
  const untouched = (t) => isBlankLedgerTree(t) && half(t.treeNo) && half(t.species) === half(t.ledgerSpecies) && !half(t.height) && !(t.girths || []).some(half) && !t.grade && !t.initialNeeded;
  const blankGone = (t) => t.ledgerGone && untouched(t) && !t.renamedTo && !keepIds.has(t.id);
  for (const t of out) {
    const no = toHalf(t.treeNo).trim() || '(番号なし)';
    if (copyOnly(t)) stats.goneRemoved.push(no);
    else if (copyGone(t)) stats.goneKept.push(no);
    else if (blankGone(t)) stats.goneBlank.push(no);
  }
  // 「現地の番号に変える」で空に戻した元の行の木（renamedTo）は、一覧表の番号が直って行がなくなったら外す（中身は新しい番号の木にある）
  const renamedBlank = (t) => t.ledgerGone && t.renamedTo && !t.done && !t.deleted;
  const kept = out.filter((t) => !copyOnly(t) && !renamedBlank(t) && !blankGone(t));
  // 台帳の並び順にそろえる（台帳にない木は元の順のまま後ろへ）
  const rank = (t, i) => (t.order && t.ledgerRow && seen.has(treeKey(t.siteType, t.treeNo, rowDupOf(t))) ? t.order : 1e6 + i);
  const sorted = kept.map((t, i) => [rank(t, i), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  // 番号が重複している木に印を付ける（画面で注意を出す）
  for (const t of sorted) {
    const n = countByNo.get(`${t.siteType}|${toHalf(t.treeNo).trim()}`) || 0;
    t.ledgerDuplicate = n > 1 ? n : 0;
  }
  return { trees: sorted, stats };
}
