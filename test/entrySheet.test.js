// 入力表（Excel。1本1行。紙の野帳を写した表）の読み込みのテスト（架空の設定・架空の木）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { importEntrySheets, readRemarks } from '../src/core/entrySheet.js';
import { readEntrySheets } from '../src/excel/entrySheetRead.js';
import { initialState } from '../src/store/state.js';
import { groupKey } from '../src/core/groups.js';

const cfg = {
  ...cfgJson,
  noGrade: true,
  felled: { label: '伐採済み' },
  addGroups: {
    siteType: 'street',
    label: '路線',
    fields: [{ key: 'routeName', label: '路線名', required: true }, { key: 'routeNo', label: '路線番号' }],
    presets: [{ label: 'みどり通り', values: { routeName: 'みどり通り(架1)', routeNo: '架1' } }],
  },
  entrySheet: {
    skipSheets: ['^見本$'],
    info: { routeName: 'C1', routeNo: 'C2' },
    date: 'M1',
    inspector: 'M2',
    dataRow: 7,
    columns: { treeNo: 'A', species: 'B', height: 'C', girth: 'D', lean: 'E', branch: 'F', vigor: 'G', deadBranch: 'H', decay: 'I', fungus: 'J', initialNeeded: 'K', remarks: 'L' },
    values: { '－': cfgJson.options.lean[0], 1: '有' },
    blank: ['-', '－'],
    same: ['〃'],
    remarks: [
      { re: '【腐】\\s*H([\\d.]+)(?:～([\\d.]+))?[×x]([\\d.]+)[×x]([\\d.]+)', measure: { kind: 'decay', place: '幹', values: { height: { a: '$1', b: '$2' }, size: [{ w: '$3', h: '$4' }] } } },
      { re: 'ガードリング', note: '根が幹を締め付けている。' },
      { re: '^なし$', felled: true, note: '木がない。' },
    ],
  },
};
const opt = (k, i) => cfgJson.options[k][i];

async function book(rows, { name = '路線1', routeName = '', routeNo = '架1' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ex = wb.addWorksheet('見本');
  ex.getCell('A7').value = 99;
  const ws = wb.addWorksheet(name);
  ws.getCell('C1').value = routeName;
  ws.getCell('C2').value = routeNo;
  ws.getCell('M1').value = new Date(Date.UTC(2099, 3, 5));
  ws.getCell('M2').value = '架空 太郎';
  rows.forEach((r, i) => r.forEach((v, c) => (ws.getCell(7 + i, c + 1).value = v)));
  return wb.xlsx.writeBuffer();
}

describe('入力表の読み込み', () => {
  it('設定の確かめ：今の形は通り、知らない種類・後ろ読みは断る', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    expect(validateConfig({ ...cfg, entrySheet: { ...cfg.entrySheet, remarks: [{ re: 'x', measure: { kind: 'nowhere' } }] } }).ok).toBe(false);
    expect(validateConfig({ ...cfg, entrySheet: { ...cfg.entrySheet, remarks: [{ re: '(?<=a)b' }] } }).ok).toBe(false);
    expect(validateConfig({ ...cfg, entrySheet: { ...cfg.entrySheet, columns: { species: 'B' } } }).ok).toBe(false);
  });

  it('備考：略記を寸法・特記事項に直し、読み取れなかった部分を残す', () => {
    const r = readRemarks('【腐】H1.6×8×15　ガードリング　なぞの書き込み', cfg.entrySheet);
    expect(r.measures).toEqual([{ kind: 'decay', place: '幹', values: { height: { a: '1.6', b: '' }, size: [{ w: '8', h: '15' }] } }]);
    expect(r.notes).toEqual(['根が幹を締め付けている。']);
    expect(r.left).toBe('なぞの書き込み');
    expect(readRemarks('【腐】H0〜0.4×40×20', cfg.entrySheet).measures[0].values.height).toEqual({ a: '0', b: '0.4' }); // 「〜」も範囲として読む
  });

  it('表から木を作る：設定の路線の一覧に合わせ、「〃」・読み替え・枝長/枝径・調査日を入れ、そろった木は入力済みにする', async () => {
    const buf = await book([
      [1, 'テストノキ', 9, 1.9, '－', '250/6', opt('vigor', 0), '－', 1, '－', cfgJson.initial.no, '【腐】H1.6×8×15 ガードリング'],
      [2, '〃', 8, 1.2, '－', '200/5', opt('vigor', 1), '－', '－', '－', cfgJson.initial.no, ''],
      [3, '〃', '', '', '', '', '', '', '', '', '', 'なし'],
      [4, '〃', 7, 1.6, '－', '3月4日', opt('vigor', 1), '？', '－', '－', cfgJson.initial.no, 'なぞ'],
    ]);
    const sheets = await readEntrySheets(buf, cfg);
    expect(sheets.map((s) => s.name)).toEqual(['路線1']); // 見本のシートは読まない
    expect(sheets[0].date).toBe('2099-04-05');
    const r = importEntrySheets(initialState(), cfg, sheets, 1000);
    expect(r.errors).toEqual([]);
    expect(r.stats.added).toHaveLength(4);
    const [t1, t2, t3, t4] = r.state.trees;
    // 路線番号が一覧の1件に当たるので、路線名は一覧の値
    expect(groupKey(t1, cfg)).toBe(groupKey({ siteType: 'street', routeName: 'みどり通り(架1)', routeNo: '架1' }, cfg));
    expect(t1).toMatchObject({ treeNo: '1', species: 'テストノキ', height: '9', girths: ['1.9'], branchLen: '250', branchDia: '6', decay: '有', done: true, sent: false, date: '2099-04-05', inspector: '架空 太郎' });
    expect(t1.lean).toBe(opt('lean', 0));
    expect(t1.measures).toEqual([{ kind: 'decay', place: '幹', values: { height: { a: '1.6', b: '' }, size: [{ w: '8', h: '15' }] } }]);
    expect(t1.notes).toBe('・根が幹を締め付けている。');
    expect(t2.species).toBe('テストノキ');
    expect(t2.done).toBe(true);
    // 木がない行：伐採済みにして、番号と樹種だけで入力済み
    expect(t3).toMatchObject({ felled: true, done: true, notes: '・木がない。' });
    // 読めない所がある木は入力中のまま。理由を知らせ、読み取れなかった備考を木に残す
    expect(t4.done).toBe(false);
    expect(t4.entryLeft).toBe('なぞ');
    expect(r.stats.check).toHaveLength(1);
    expect(r.stats.check[0].why.join(' ')).toMatch(/枝長\/枝径.*選択肢にありません.*読み取れなかった部分：なぞ/);
    // もう一度読み込んでも、すでにある番号は足さない（上書きしない）
    const again = importEntrySheets(r.state, cfg, sheets, 2000);
    expect(again.stats.added).toEqual([]);
    expect(again.stats.skipped).toHaveLength(4);
    expect(again.state).toBe(r.state);
  });

  it('路線名のないシートは読み込まず、知らせる', async () => {
    const sheets = await readEntrySheets(await book([[1, 'テストノキ']], { routeNo: '' }), cfg);
    const r = importEntrySheets(initialState(), cfg, sheets, 1000);
    expect(r.stats.added).toEqual([]);
    expect(r.errors[0]).toMatch(/路線名が入っていません/);
  });
});
