// 一覧型の野帳（設定 listSheet。原本を使わず一から作る）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree } from '../src/core/tree.js';
import { putMeasure } from '../src/core/noteMeasures.js';
import { checkListSheet, exportListSheet, listCellText, listPages, listRemarks } from '../src/excel/listSheet.js';

const base = structuredClone(cfgJson);
const [k1, k2] = base.checks.map((c) => c.key);
const yes = base.options[k1].find((v) => v !== '無');
const cfg = {
  ...base,
  details: [
    ...base.details,
    { when: { field: k1, eq: yes }, field: 'whereX', label: '架空：部位' },
    { when: { field: k1, eq: yes }, field: 'hX', label: '架空：H', numeric: true, noteText: 'H={v}m' },
    { when: { field: 'initialNeeded', eq: base.initial.yes }, field: 'whyX', label: '調査：理由' },
  ],
  extraFields: [{ key: 'spread', label: '枝張り', unit: 'm', numeric: true }],
  listSheet: {
    paper: 'A3',
    rowsPerSheet: 3,
    noneValue: '無',
    noneMark: '－',
    header: [{ key: 'routeName', label: '路線名' }],
    columns: [
      { key: 'treeNo', label: '番号', width: 5 },
      { key: 'species', label: '樹種', width: 12, align: 'left' },
      { key: 'girth', label: 'C', width: 6 },
      { key: 'spread', label: 'W', width: 6, group: '計測', blank: '－' },
      { key: 'branch', label: '枝長/枝径', width: 8, group: '計測' },
      { key: k1, label: '項目1', width: 6 },
      { key: k2, label: '項目2', width: 6 },
      { key: 'initialNeeded', label: '調査', width: 5 },
      { key: 'x1', label: 'あき1', width: 3 },
      { key: 'remarks', label: '備考', width: 40, align: 'left' },
    ],
  },
};
const T = (no, o = {}) => blankTree({ id: `t${no}`, uid: `u${no}`, siteType: 'street', routeName: '試験の通り', treeNo: String(no), species: 'テストノキ', date: '2099-05-06', girths: ['0.85'], ...o });

describe('一覧型の野帳', () => {
  it('設定の検証：今の設定はそのまま通り、誤った指定は断る', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (o) => validateConfig({ ...cfg, listSheet: { ...cfg.listSheet, ...o } }).ok;
    expect(bad({ paper: 'B4' })).toBe(false);
    expect(bad({ rowsPerSheet: 0 })).toBe(false);
    expect(bad({ columns: [{ key: 'species', label: '樹種' }, ...cfg.listSheet.columns.slice(1)] })).toBe(false); // 最初は番号
    expect(validateConfig({ ...cfg, details: [{ when: { field: k1, eq: yes }, field: 'zz', label: 'z', noteText: 'H=m' }] }).ok).toBe(false);
  });

  it('欄の文字：無は「－」、有は選択肢の文字、枝長/枝径は入れた数のまま、空欄は blank、株立は各幹周→記録値', () => {
    const t = T(1, { [k1]: yes, [k2]: '無', branchLen: '300', branchDia: '5', initialNeeded: base.initial.no });
    const col = (k) => cfg.listSheet.columns.find((c) => c.key === k);
    expect(listCellText(t, col(k1), cfg)).toBe(yes);
    expect(listCellText(t, col(k2), cfg)).toBe('－');
    expect(listCellText(t, col('branch'), cfg)).toBe('300/5');
    expect(listCellText(t, col('spread'), cfg)).toBe('－');
    expect(listCellText(t, col('girth'), cfg)).toBe('0.85');
    expect(listCellText(t, col('initialNeeded'), cfg)).toBe(base.initial.no);
    expect(listCellText(T(2, { girths: ['0.6', '0.5'] }), col('girth'), cfg)).toMatch(/^0\.6\+0\.5\n→\d\.\d\d$/);
  });

  it('備考：「有」のとき入れた項目を「項目：内容」で並べ、書き方（noteText）を当て、特記事項を足す', () => {
    const t = T(1, { [k1]: yes, whereX: '幹', hX: '1.2', initialNeeded: base.initial.yes, whyX: '根株の打診音', notes: '自由な記録\n2行目' });
    expect(listRemarks(t, cfg)).toBe('架空：幹 H=1.2m／調査：根株の打診音／自由な記録／2行目');
    // 「無」に戻した項目の詳細は出さない
    expect(listRemarks({ ...t, [k1]: '無' }, cfg)).toBe('調査：根株の打診音／自由な記録／2行目');
  });

  it('備考：部位・寸法（checks の measure）はその点検項目のすぐ後ろ、ほかの寸法は特記事項の後ろ。行の頭の「・」は付けない', () => {
    const c2 = { ...cfg, checks: cfg.checks.map((c) => (c.key === k1 ? { ...c, measure: { kinds: ['decay'], eq: yes } } : c)) };
    expect(validateConfig(c2).errors).toEqual([]);
    let t = T(1, { [k1]: yes, whereX: '幹', initialNeeded: base.initial.yes, whyX: '理由', notes: '・自由な記録' });
    t = putMeasure(t, c2, { kind: 'decay', place: '幹', values: { height: { a: '1' } } }, -1);
    t = putMeasure(t, c2, { kind: 'tap', place: '根株', values: { height: { a: '0.5' } } }, -1);
    expect(listRemarks(t, c2)).toBe('架空：幹／幹の腐朽：地上1m／調査：理由／自由な記録／根株の打診音異常：地上0.5m');
  });

  it('用紙：路線が変わったら新しい用紙、1枚の本数を超えたら次の用紙。診断日は違う日が混じれば「ほか」', () => {
    const trees = [T(1), T(2), T(3), T(4, { date: '2099-05-07' }), T(1, { id: 'b1', uid: 'b1', routeName: '別の通り' })];
    const pages = listPages(trees, cfg);
    expect(pages.map((p) => [p.label, p.no, p.of, p.rows.map((r) => r[0]).join(',')])).toEqual([
      ['試験の通り', 1, 2, '1,2,3'],
      ['試験の通り', 2, 2, '4'],
      ['別の通り', 1, 1, '1'],
    ]);
    expect(pages[0].date).toBe('2099年5月6日');
    expect(listPages([T(1), T(2, { date: '2099-05-07' })], cfg)[0].date).toBe('2099年5月6日ほか');
    expect(pages[0].info).toEqual([{ label: '路線名', value: '試験の通り' }]);
  });

  it('Excel：用紙ごとのシート・A3横・見出し2行・全欄を書き、読み直して照合する。書き換えたファイルは食い違いを見つける', async () => {
    const trees = [T(1, { [k1]: yes, whereX: '幹' }), T(2), T(3), T(4)];
    const pages = listPages(trees, cfg);
    const r = await exportListSheet(pages, cfg);
    expect(r.errors).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['試験の通り_1', '試験の通り_2']);
    const ws = wb.worksheets[0];
    expect([ws.pageSetup.paperSize, ws.pageSetup.orientation, ws.pageSetup.fitToWidth]).toEqual([8, 'landscape', 1]);
    expect(ws.getRow(2).getCell(4).value).toBe('計測'); // まとめた見出し
    expect(ws.getRow(3).getCell(5).value).toBe('枝長/枝径');
    expect(ws.getRow(4).getCell(1).value).toBe('1');
    expect(ws.getRow(4).getCell(10).value).toBe('架空：幹');
    expect(ws.getRow(6).getCell(1).value).toBe('3');
    expect(ws.getRow(4).getCell(1).border?.top?.style).toBe('thin');

    // 1か所書き換えたファイルは、照合で食い違いになる（保存しない）
    ws.getRow(5).getCell(2).value = '別の樹種';
    const tampered = await wb.xlsx.writeBuffer();
    const names = wb.worksheets.map((w) => w.name);
    const errs = await checkListSheet(tampered, pages, names, cfg);
    expect(errs.join()).toContain('2行目の樹種が違います');
  });
});
