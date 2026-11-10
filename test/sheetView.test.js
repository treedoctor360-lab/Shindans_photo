// Excel のシートを画面に出す形にする（カルテを画面で確かめる）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import cfgJson from './fixtures/sample-config.json';
import { exportKarte } from '../src/excel/karteExport.js';
import { addrOf, bookView, bordersOfSheet, bordersOfStyles, colNo, rangeOf, sheetView } from '../src/excel/sheetView.js';
import { makeKarteTemplate } from './helpers/makeKarteTemplate.js';

const cfg = structuredClone(cfgJson);

describe('セルの番地', () => {
  it('列の記号と範囲', () => {
    expect(colNo('A')).toBe(1);
    expect(colNo('AA')).toBe(27);
    expect(addrOf('$C$5')).toEqual({ col: 3, row: 5 });
    expect(rangeOf('C3:A1')).toEqual({ top: 1, left: 1, bottom: 3, right: 3 });
  });
});

describe('シート1枚', () => {
  it('結合・幅・高さ・罫線・書式を写し、結合の中のセルは出さない', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.getCell('A1').value = '見出し';
    ws.mergeCells('A1:B2');
    ws.getCell('A1').font = { size: 14, bold: true };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    // 結合の端のセルの罫線（ExcelJS では結合の中のセルに別の罫線を付けられないので、XML から読んだ形で渡す）
    const borders = new Map([
      ['A1', { top: { style: 'thin' }, left: { style: 'medium', color: { argb: 'FFFF0000' } } }],
      ['A2', { bottom: { style: 'double' } }], // 下は左下のセル
      ['B1', { right: { style: 'thin' } }], // 右は右上のセル
    ]);
    ws.getCell('C1').value = 12;
    ws.getCell('C2').value = { formula: 'C1*2', result: 24 };
    ws.getColumn(1).width = 10;
    ws.getRow(1).height = 30;
    const v = sheetView(ws, borders);
    expect(v.cols.length).toBe(3);
    expect(v.cols[0]).toBe(75);
    expect(v.rows[0].height).toBe(40);
    const a1 = v.rows[0].cells[0];
    expect(a1).toMatchObject({ text: '見出し', rowSpan: 2, colSpan: 2 });
    expect(a1.style).toMatchObject({ fontSize: '14pt', fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'pre-wrap', borderTop: '1px solid #000', borderLeft: '2px solid #FF0000', borderBottom: '3px double #000', borderRight: '1px solid #000' });
    expect(v.rows[0].cells.map((c) => c.text)).toEqual(['見出し', '12']);
    expect(v.rows[1].cells.map((c) => c.text)).toEqual(['24']); // 式は計算の結果。結合の中の A2・B2 は出さない
    expect(v.rows[0].cells[1].style.textAlign).toBe('right'); // 数は右寄せ（Excel の既定）
  });
  it('折り返さない左寄せの文は、右の空いたセルまではみ出す幅を持つ', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.getCell('A1').value = '長い見出しの文';
    ws.getCell('D1').value = '別の文';
    ws.getCell('A2').value = '折り返す';
    ws.getCell('A2').alignment = { wrapText: true };
    for (let x = 1; x <= 4; x++) ws.getColumn(x).width = 10;
    const v = sheetView(ws);
    expect(v.rows[0].cells[0].spill).toBe(75 * 3); // A〜C（D は文があるので手前まで）
    expect(v.rows[0].cells[3].spill).toBe(75);
    expect(v.rows[1].cells[0].spill).toBeUndefined();
  });
  it('印刷の範囲があれば、その範囲だけ。隠した行・列は出さない', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) ws.getCell(y, x).value = `${y}-${x}`;
    ws.pageSetup.printArea = 'A1:D4';
    ws.getColumn(2).hidden = true;
    ws.getRow(3).hidden = true;
    const v = sheetView(ws);
    expect(v.rows.map((r) => r.cells.map((c) => c.text).join(' '))).toEqual(['1-1 1-3 1-4', '2-1 2-3 2-4', '4-1 4-3 4-4']);
  });
});

describe('罫線を XML から読む', () => {
  it('書式の番号 → 罫線、番地 → 罫線（結合の中のセルの分も）', () => {
    const styles = '<styleSheet><borders count="2"><border><left/><right/></border><border><left style="thin"><color rgb="FF00FF00"/></left><bottom style="double"><color auto="1"/></bottom></border></borders><cellXfs count="2"><xf borderId="0"/><xf borderId="1" applyBorder="1"/></cellXfs></styleSheet>';
    const by = bordersOfStyles(styles);
    expect(by[0]).toEqual({ top: undefined, left: undefined, bottom: undefined, right: undefined });
    expect(by[1]).toEqual({ top: undefined, left: { style: 'thin', color: { argb: 'FF00FF00' } }, bottom: { style: 'double', color: undefined }, right: undefined });
    const m = bordersOfSheet('<row r="2"><c r="B2" s="1"/><c r="C2" s="0" t="s"><v>0</v></c></row>', by);
    expect(m.get('B2').bottom.style).toBe('double');
    expect(m.get('C2').left).toBeUndefined();
  });
});

describe('確認用カルテを画面に出す', () => {
  it('書き出したカルテと同じ中身が見える（入力中の記録でも作れる）', async () => {
    const rec = { siteType: 'park', dupIndex: 1, parkCode: 'K01', done: false, source: 'app', treeNo: 'AB001', lean: '有（危険）', b4: '有（大）', b4Detail: '2本、地上3m', weather: '有', stake: '支柱なし' };
    const r = await exportKarte(await makeKarteTemplate(), [rec], cfg);
    expect(r.errors).toEqual([]);
    const views = await bookView(r.buffer);
    expect(views.map((v) => v.name)).toEqual(['AB001', 'AB001_環境']);
    const texts = views[0].rows.flatMap((row) => row.cells.map((c) => c.text));
    expect(texts).toContain('AB001');
    expect(texts).toContain('2本、地上3m');
  });
});
