// 詳しい診断の記録を、データ入力用ブックに書き込むテスト（書き込み後の照合も含む）
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import cfgJson from './fixtures/sample-config.json';
import { exportInitialBook } from '../src/excel/initialExport.js';
import { readInitialBook } from '../src/excel/initialBook.js';
import { setCells } from '../src/excel/xmlCells.js';
import { makeInitialBook } from './helpers/makeInitialBook.js';

const cfg = structuredClone(cfgJson);

const rec = (o) => ({ siteType: 'park', dupIndex: 1, parkCode: 'K01', done: true, source: 'app', ...o });
const AB001 = rec({ treeNo: 'AB001', species: 'テストノキ', year: 2099, month: 5, day: 1, inspector: '試験 二郎(資格)', b4: '有（大）', b4Detail: '2本、地上3m', height: 12, girth: 1.5, weather: '有', stake: '無' });
const AB002 = rec({ treeNo: 'ＡＢ００２', species: 'テストノキ', b4: '無' });

const sheetXml = async (buf, name) => {
  const zip = await JSZip.loadAsync(buf);
  const wb = await zip.file('xl/workbook.xml').async('string');
  const names = [...wb.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((m) => m[1]);
  return zip.file(`xl/worksheets/sheet${names.indexOf(name) + 1}.xml`).async('string');
};

describe('セルの XML への書き込み', () => {
  it('書式を残して値を入れる。ない行・ないセルは順番どおりに足す。式のセルには書かない', () => {
    const xml =
      '<worksheet><sheetData><row r="2"><c r="A2" s="3"/><c r="C2" s="4"><v>1</v></c></row><row r="5"><c r="B5"><f>1+1</f><v>2</v></c></row></sheetData><dataValidations/></worksheet>';
    const out = setCells(xml, [
      { addr: 'A2', value: 'あ<&>' },
      { addr: 'B2', value: 3.5 },
      { addr: 'C2', value: '' },
      { addr: 'D4', value: 'x' },
    ]);
    expect(out).toBe(
      '<worksheet><sheetData><row r="2"><c r="A2" s="3" t="inlineStr"><is><t xml:space="preserve">あ&lt;&amp;&gt;</t></is></c><c r="B2"><v>3.5</v></c><c r="C2" s="4"/></row><row r="4"><c r="D4" t="inlineStr"><is><t xml:space="preserve">x</t></is></c></row><row r="5"><c r="B5"><f>1+1</f><v>2</v></c></row></sheetData><dataValidations/></worksheet>',
    );
    expect(() => setCells(xml, [{ addr: 'B5', value: 1 }])).toThrow('式');
  });
});

describe('データ入力用ブックへの書き込み', () => {
  it('入力済みの最後の行より下の空き行に書き、読み直して照合する。ブックで入力済みの木・番号のない木は書かない', async () => {
    const buf = await makeInitialBook();
    const inBook = rec({ treeNo: 'AB009', b4: '無' }); // ブックで入力済み（K01）
    const noNumber = rec({ treeNo: '', b4: '無' });
    const r = await exportInitialBook(buf, [AB001, AB002, inBook, noNumber], cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats.skippedInBook).toEqual(['AB009']);
    expect(r.stats.skippedNoNumber).toBe(1);
    expect(r.stats.written).toEqual([
      { treeNo: 'AB001', sheet: '公園_詳しい診断', row: 7 },
      { treeNo: 'AB001', sheet: '公園_周りの環境', row: 5 },
      { treeNo: 'AB002', sheet: '公園_詳しい診断', row: 8 },
      { treeNo: 'AB002', sheet: '公園_周りの環境', row: 6 },
    ]);

    const after = await readInitialBook(r.buffer, cfg);
    const [main, env] = after.sheets;
    expect(main.rows[2].values).toMatchObject({ serial: 3, year: 2099, month: 5, day: 1, treeNo: 'AB001', parkCode: 'K01', b4: '有（大）', b4Detail: '2本、地上3m', height: 12, girth: 1.5 });
    expect(main.rows[3].values).toMatchObject({ serial: 4, treeNo: 'ＡＢ００２', b4: '無' }); // 番号は入力どおり（変えない）
    expect(env.rows[1].values).toEqual({ treeNo: 'AB001', parkCode: 'K01', weather: '有', stake: '無' });
    expect(env.rows[2].values).toEqual({ treeNo: 'ＡＢ００２', parkCode: 'K01', weather: '無', stake: '' }); // 先に入っている「無」はそのまま

    // ExcelJS でも開ける（Excel が読める形の確認の代わり）。入力規則は増えも減りもしない
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    for (const name of ['公園_詳しい診断', '公園_周りの環境', 'メモ']) {
      const [x, y] = [await sheetXml(buf, name), await sheetXml(r.buffer, name)];
      expect((y.match(/<dataValidation\b/g) || []).length).toBe((x.match(/<dataValidation\b/g) || []).length);
      expect(y.slice(y.indexOf('</sheetData>'))).toBe(x.slice(x.indexOf('</sheetData>')));
    }
    expect(await sheetXml(r.buffer, 'メモ')).toBe(await sheetXml(buf, 'メモ'));
  });

  it('書き込んだファイルをもう一度使うと、書いた木は「ブックで入力済み」になり、続きの行に書く', async () => {
    const r1 = await exportInitialBook(await makeInitialBook(), [AB001], cfg);
    const r2 = await exportInitialBook(r1.buffer, [AB001, AB002], cfg);
    expect(r2.errors).toEqual([]);
    expect(r2.stats.skippedInBook).toEqual(['AB001']);
    expect(r2.stats.written.map((w) => w.row)).toEqual([8, 6]);
  });

  it('ブックの選択肢にない値・空き行の不足・見出しの違い・同じ木の記録が2件、は書かずに知らせる', async () => {
    const buf = await makeInitialBook();
    const bad = await exportInitialBook(buf, [rec({ treeNo: 'AB003', b4: '有' })], cfg);
    expect(bad.buffer).toBeNull();
    expect(bad.errors.join('\n')).toContain('「有」はブックの選択肢にありません');
    // 候補を出すだけの入力規則（選択肢にない値も入れられる）は、選択肢にない値でも書く
    const free = await exportInitialBook(buf, [rec({ treeNo: 'AB003', b4: '無', branchRatio: '25' })], cfg);
    expect(free.errors).toEqual([]);

    const many = ['AB011', 'AB012', 'AB013', 'AB014'].map((n) => rec({ treeNo: n }));
    const full = await exportInitialBook(buf, many, cfg);
    expect(full.buffer).toBeNull();
    expect(full.errors.join('\n')).toContain('AB014：シート「公園_詳しい診断」に空き行が足りません');

    const hdr = await exportInitialBook(await makeInitialBook({ envHeader: '別の見出し' }), [AB001], cfg);
    expect(hdr.buffer).toBeNull();
    expect(hdr.errors.join('\n')).toContain('見出しが設定と違うため書き込めません');

    const dup = await exportInitialBook(buf, [AB001, rec({ treeNo: 'ＡＢ００１' })], cfg);
    expect(dup.errors.join('\n')).toContain('同じ木の記録が2件');
  });
});

describe('任意記入（設定 free）の項目', () => {
  it('ブックの選択肢（入力規則）にない値でも書く。free でない項目は今までどおり止める', async () => {
    const c = structuredClone(cfg);
    const it4 = c.initialSurvey.forms.initial.sections.flatMap((s) => s.items).find((x) => x.key === 'b4');
    it4.free = true;
    const r = await exportInitialBook(await makeInitialBook(), [rec({ treeNo: 'AB003', b4: '自由に書いた値' })], c);
    expect(r.errors).toEqual([]);
    expect(r.stats.written.some((w) => w.treeNo === 'AB003')).toBe(true);
    const bad = await exportInitialBook(await makeInitialBook(), [rec({ treeNo: 'AB003', b4: '自由に書いた値' })], cfg);
    expect(bad.errors.join('\n')).toContain('ブックの選択肢にありません');
  });
});
