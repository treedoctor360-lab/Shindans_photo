// アプリを使わない人に渡す Excel（見るだけ。提出用ではない）
//  ・入力内容の一覧（確認用）：選んだ公園・路線の、調査者が入れた内容をそのまま（確定していない木も）。
//      「簡易」のシート：1本1行。列の並び・書き方は一覧表と同じ（listColumns.js）。右に特記事項の全文と状態
//      「初期」「環境」のシート：1本1行。列の並びはデータ入力用ブックと同じ（設定 initialSurvey.book の列）
//  ・差し込む行の一覧：一覧表に行がない追加の木を、どの行の次に差し込むか。番号を直す行も
//  並びはアプリの並び（追加した木は「どの木の次か」の位置。order.js）
import ExcelJS from 'exceljs';
import { groupKey, groupLabel } from '../core/groups.js';
import { toHalf } from '../core/text.js';
import { isAddedTree } from '../store/actions.js';
import { initialOf, isInitialTarget } from '../store/initial.js';
import { REVIEW_LABEL, reviewState } from '../store/review.js';
import { INITIAL } from '../store/surveys.js';
import { dbValues } from './dbExport.js';
import { FULL_NOTE, cellText, columns, fullNoteOf } from './listColumns.js';

const MARK = '確認用（提出不可）';
const FONT = { name: '游ゴシック', size: 10 };
const HEAD = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F4A' } };
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

// 表を1枚書く（1行目に印、2行目に見出し、3行目から）
function table(ws, heads, rows, widths = []) {
  ws.getCell('A1').value = MARK;
  ws.getCell('A1').font = { ...FONT, bold: true, color: { argb: 'FFC00000' } };
  const hr = ws.getRow(2);
  heads.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = HEAD;
    c.fill = HEAD_FILL;
    c.border = BOX;
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  rows.forEach((vals, r) => {
    const row = ws.getRow(r + 3);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v === '' || v == null ? null : v;
      c.font = FONT;
      c.border = BOX;
      c.alignment = { vertical: 'top', wrapText: true };
    });
  });
  heads.forEach((h, i) => (ws.getColumn(i + 1).width = widths[i] || Math.min(30, Math.max(6, String(h).length * 2 + 2))));
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: heads.length } };
  ws.headerFooter = { oddHeader: `&L${MARK}` };
}

// 選んだまとまりの木（削除した木は出さない）。アプリの並び
const treesOf = (state, cfg, keys) => state.trees.filter((t) => !t.deleted && keys.includes(groupKey(t, cfg)));

// 簡易診断の状態の言葉
const stateLabel = (t, state, cfg) => REVIEW_LABEL[reviewState(t, state, cfg)] || '';

// 列の見出し（データ入力用ブック）：入力画面の項目名 → 見出しの正規表現の文字 → キー
function bookHeads(spec, cfg) {
  const label = {};
  for (const f of Object.values(cfg.initialSurvey.forms || {})) for (const sec of f.sections || []) for (const it of sec.items || []) label[it.key] = it.label;
  return Object.entries(spec.columns).map(([key, c]) => {
    const fromHeader = c.header ? String(c.header).replace(/^\^|\$$/g, '').replace(/\\/g, '') : '';
    return { key, col: c.col, head: fromHeader || label[key] || key };
  });
}
const colNo = (s) => [...String(s).toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// 入力内容の一覧（確認用）。keys：出すまとまり（公園・路線）の鍵。返す形：{ buffer, count: { trees, initials } }
export async function buildEntryList(state, cfg, keys) {
  const wb = new ExcelJS.Workbook();
  const trees = treesOf(state, cfg, keys);
  const types = [...new Set(trees.map((t) => t.siteType))];
  let nInitial = 0;
  for (const type of types) {
    const ts = trees.filter((t) => t.siteType === type);
    const sheetLabel = cfg.dbFormat.sheets.find((s) => s.type === type)?.label || type;
    const suffix = types.length > 1 ? `_${sheetLabel}` : '';
    // 簡易
    const cols = columns(cfg, type, state.ledgerInfo?.columns?.[type], ts);
    const heads = ['状態', ...cols.map((c) => c[1]), FULL_NOTE];
    const rows = ts.map((t) => {
      const v = dbValues(t, cfg);
      const done = t.done && t.source === 'app';
      return [stateLabel(t, state, cfg), ...cols.map(([k]) => (done || t.source === 'ledger' || k === 'treeNo' || k === cfg.dbFormat.serialKey || cfg.dbFormat.infoKeys.includes(k) || k === 'species' ? cellText(t, k, v[k], cfg) : '')), fullNoteOf(t, cfg)];
    });
    table(wb.addWorksheet(`簡易${suffix}`.slice(0, 31)), heads, rows, [10]);
    // 初期・環境（データ入力用ブックの並び）
    if (!cfg.initialSurvey?.book) continue;
    for (const spec of cfg.initialSurvey.book.sheets.filter((s) => s.siteType === type)) {
      const recs = ts
        .filter((t) => isInitialTarget(t, cfg))
        .map((t) => [t, initialOf(state, t, cfg)])
        .filter(([, r]) => r && !r.deleted);
      const bh = bookHeads(spec, cfg).sort((a, b) => colNo(a.col) - colNo(b.col));
      const name = spec.form === 'environment' ? '環境' : cfg.initialSurvey.label?.replace(/（.*?）|\(.*?\)/g, '') || '初期';
      const irows = recs.map(([, r]) => [REVIEW_LABEL[reviewState(r, state, cfg, INITIAL)] || '', ...bh.map((h) => r[h.key] ?? '')]);
      if (spec.form !== 'environment') nInitial += recs.length;
      table(wb.addWorksheet(`${name}${suffix}`.slice(0, 31)), ['状態', ...bh.map((h) => `${h.col} ${h.head}`)], irows, [10]);
    }
  }
  return { buffer: await wb.xlsx.writeBuffer(), count: { trees: trees.length, initials: nInitial } };
}

// 差し込む行の一覧：一覧表に行がない追加の木（入力済み）と、「現地の番号に変える」で番号を直す行。
//  返す形：[{ group, kind, treeNo, species, prev, from, memo }]（前の行：アプリの並びで1つ上の木）
export function insertRows(state, cfg, keys) {
  const out = [];
  for (const key of keys) {
    const ts = state.trees.filter((t) => !t.deleted && groupKey(t, cfg) === key);
    ts.forEach((t, i) => {
      if (!isAddedTree(t) || !(t.done || t.renamedFrom)) return;
      const no = toHalf(t.treeNo).trim();
      const prevT = ts[i - 1];
      const prev = prevT ? `${toHalf(prevT.treeNo) || '(番号なし)'}${prevT.dupIndex > 1 ? `（${prevT.dupIndex}本目）` : ''}` : '';
      const base = { group: groupLabel(state.trees, key, cfg), treeNo: no || '(番号なし)', species: t.species || '' };
      if (t.renamedFrom) {
        const from = `${toHalf(t.renamedFrom.treeNo)}${t.renamedFrom.dupIndex > 1 ? `（${t.renamedFrom.dupIndex}本目）` : ''}`;
        // 元の行がまだ一覧表にあれば「番号を直す」。なくなっていれば、もう直してある
        const stillOld = state.trees.some((x) => x.renamedTo === t.uid && x.ledgerRow && !x.ledgerGone);
        if (stillOld) out.push({ ...base, kind: '番号を直す', prev: '', from, memo: `一覧表の ${from} の行の番号を ${no} に直す（行は動かさない）` });
        else if (!t.ledgerRow || t.ledgerGone) out.push({ ...base, kind: '行を差し込む', prev, from, memo: `${prev || 'いちばん上'} の次に行を入れ、番号 ${no}・公園名を書く` });
        return;
      }
      out.push({ ...base, kind: '行を差し込む', prev, from: '', memo: `${prev || 'いちばん上'} の次に行を入れ、番号 ${no}・公園名を書く` });
    });
  }
  return out;
}

export async function buildInsertList(state, cfg, keys) {
  const wb = new ExcelJS.Workbook();
  const rows = insertRows(state, cfg, keys);
  table(
    wb.addWorksheet('差し込む行'),
    ['公園・路線', 'すること', '番号', '樹種', '前の行', '一覧表の今の番号', 'すること（くわしく）', '済'],
    rows.map((r) => [r.group, r.kind, r.treeNo, r.species, r.prev, r.from, r.memo, '']),
    [24, 12, 12, 14, 14, 16, 50, 6],
  );
  wb.getWorksheet('差し込む行').getCell('B1').value = '番号と公園名を一覧表と同じ書き方で入れると、読み込み直したときにアプリの入力が結び付きます';
  return { buffer: await wb.xlsx.writeBuffer(), rows };
}
