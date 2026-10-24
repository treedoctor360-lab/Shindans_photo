// 文が枠に収まるかの見積もりのテスト
import { describe, expect, it } from 'vitest';
import { fitSize, linesNeeded, sheetGeometry } from '../src/excel/fitText.js';

describe('文の大きさの見積もり', () => {
  it('列の幅・行の高さ・結合から枠の大きさを出す', () => {
    const xml =
      '<worksheet><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="10"/><col min="2" max="3" width="5"/></cols>' +
      '<sheetData><row r="2" ht="30"/></sheetData><mergeCells><mergeCell ref="B1:C2"/></mergeCells></worksheet>';
    const box = sheetGeometry(xml);
    expect(box('A1')).toEqual({ width: Math.trunc(10 * 7 + 5) * 0.75, height: 15 });
    expect(box('B1')).toEqual({ width: 2 * Math.trunc(5 * 7 + 5) * 0.75, height: 45 });
  });

  it('全角は文字の大きさ、半角はその6割で見積もり、折り返した行の数を出す', () => {
    expect(linesNeeded('あいう', 10, 34)).toBe(1); // 30pt
    expect(linesNeeded('あいうえ', 10, 34)).toBe(2);
    expect(linesNeeded('a\nb', 10, 100)).toBe(2);
  });

  it('1行に収まれば変えない。収まらなければ折り返して入る一番大きい大きさ。最小でも入らなければ fits: false', () => {
    expect(fitSize('短い', { width: 100, height: 15 }, 11)).toEqual({ size: 11, wrap: false, fits: true });
    const r = fitSize('あ'.repeat(20), { width: 100, height: 30 }, 11);
    expect(r.wrap).toBe(true);
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThan(11);
    expect(fitSize('あ'.repeat(200), { width: 100, height: 15 }, 11)).toEqual({ size: 7, wrap: true, fits: false });
  });
});
