// 確認用のカルテ（1本1シート）を作るテスト（書き出した後の照合も含む）
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import cfgJson from './fixtures/sample-config.json';
import { karteValue } from '../src/core/karteCells.js';
import { validateConfig } from '../src/core/config.js';
import { exportKarte, normalizeSheet, readKarteTemplate } from '../src/excel/karteExport.js';
import { sheetFiles } from '../src/excel/xlsxFix.js';
import { makeKarteTemplate } from './helpers/makeKarteTemplate.js';

const cfg = structuredClone(cfgJson);
const rec = (o) => ({ siteType: 'park', dupIndex: 1, parkCode: 'K01', done: true, source: 'app', ...o });
const AB001 = rec({
  treeNo: 'AB001',
  year: 2099,
  month: 5,
  day: 1,
  inspector: '試験 二郎(資格)',
  height: 12,
  girth: '１.５',
  lean: '有（危険）',
  b4: '有（大）',
  b4Detail: '2本、地上3m',
  overall: 'C',
  weather: '有',
  stake: '支柱なし',
});
const AB002 = rec({ treeNo: 'ＡＢ００２', lean: '無', b4: '無', overall: '-', weather: '無', stake: '有' });

const load = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};
const sheetXml = async (buf, name) => {
  const zip = await JSZip.loadAsync(buf);
  const f = (await sheetFiles(zip)).find((x) => x.name === name).file;
  return zip.file(f).async('string');
};

describe('カルテのセルに書く値', () => {
  const c = (o) => ({ cell: 'A1', key: 'v', ...o });
  it('□の形：選んだものだけ■にする（first・contains・exact・full・map）', () => {
    expect(karteValue(c({ boxes: '□無 □有', match: 'first' }), { v: '有（危険）' })).toBe('□無 ■有');
    expect(karteValue(c({ boxes: '□無 □有', match: 'first', full: true }), { v: '有（大）' })).toBe('□無 ■有（大）');
    expect(karteValue(c({ boxes: '□無 □有', match: 'first', full: true }), { v: '無' })).toBe('■無 □有');
    expect(karteValue(c({ boxes: '□安全　□危険', match: 'contains' }), { v: '有（危険）' })).toBe('□安全　■危険');
    expect(karteValue(c({ boxes: '□安全　□危険', match: 'contains' }), { v: '無' })).toBe('□安全　□危険');
    // exact：「悪い」は「少し悪い」に当たらない
    const vig = '□良い　□普通　□少し悪い　□悪い　□なし';
    expect(karteValue(c({ boxes: vig }), { v: '悪い' })).toBe('□良い　□普通　□少し悪い　■悪い　□なし');
    expect(karteValue(c({ boxes: vig, map: { 枯死: 'なし' } }), { v: '枯死' })).toBe('□良い　□普通　□少し悪い　□悪い　■なし');
    // 空・当てはまらない値は□だけ（設定に■が混ざっていても□にそろえる）
    expect(karteValue(c({ boxes: '■無 □有' }), {})).toBe('□無 □有');
    expect(karteValue(c({ boxes: '□A □B' }), { v: 'Z' })).toBe('□A □B');
  });
  it('文字：つなぐ・数にする・決まった値は空欄・正規表現で一部だけ', () => {
    expect(karteValue(c({ keys: ['y', 'm', 'd'], join: '/' }), { y: 2099, m: 5, d: 1 })).toBe('2099/5/1');
    expect(karteValue(c({ keys: ['y', 'm', 'd'], join: '/' }), {})).toBe('');
    expect(karteValue(c({ num: true }), { v: '１.５' })).toBe(1.5);
    expect(karteValue(c({ num: true }), { v: '-' })).toBe('-');
    expect(karteValue(c({}), { v: 12 })).toBe('12');
    expect(karteValue(c({ omit: ['無', '有'], pattern: '｜(.*)$' }), { v: '有' })).toBe('');
    expect(karteValue(c({ omit: ['無', '有'], pattern: '｜(.*)$' }), { v: '有｜根元' })).toBe('根元');
    expect(karteValue(c({ omit: ['無', '有'], pattern: '｜(.*)$' }), { v: '支柱なし' })).toBe('支柱なし');
  });
});

describe('カルテの様式の設定の確かめ', () => {
  it('見本の設定は正しい', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
  });
  it('ない項目・正しくない番地・使えない match は誤り', () => {
    const bad = structuredClone(cfg);
    bad.initialSurvey.karte.sheets[0].cells.push({ cell: 'Z9', key: 'noSuchItem' }, { cell: 'z1', key: 'height' }, { cell: 'Z2', key: 'lean', boxes: '□無 □有', match: 'near' });
    const errs = validateConfig(bad).errors.join('\n');
    expect(errs).toContain('noSuchItem');
    expect(errs).toContain('cells[11].cell');
    expect(errs).toContain('match');
  });
});

describe('確認用のカルテの出力', () => {
  it('1本につき書式ごとに1シート。値・様式の書式・結合・入力規則・式が残り、印刷のヘッダーに確認用の印', async () => {
    const tpl = await makeKarteTemplate();
    const r = await exportKarte(tpl, [AB002, AB001], cfg);
    expect(r.errors).toEqual([]);
    const wb = await load(r.buffer);
    // 並び：番号の順。周りの環境は「_環境」を付けた名前。関係ないシートは入らない
    expect(wb.worksheets.map((w) => w.name)).toEqual(['AB001', 'AB001_環境', 'AB002', 'AB002_環境']);
    const a = wb.getWorksheet('AB001');
    expect(a.getCell('E1').value).toBe('2099/5/1');
    expect(a.getCell('C2').value).toBe('AB001');
    expect(a.getCell('C3').value).toBe(12);
    expect(a.getCell('C4').value).toBe(1.5);
    expect(a.getCell('C6').value).toBe('□無 ■有');
    expect(a.getCell('E6').value).toBe('□安全　■危険');
    expect(a.getCell('C7').value).toBe('□無 ■有（大）');
    expect(a.getCell('E7').value).toBe('2本、地上3m');
    expect(a.getCell('C8').value).toBe('□A □B ■C □D □E');
    expect(a.getCell('C9').value).toBe('様式のまま残る文字');
    expect(a.getCell('A10').value).toBe('確認用（提出不可）');
    expect(a.getCell('C2').font?.bold).toBe(true);
    expect(a.getCell('C5').value.formula).toBe('IFERROR(ROUND(C3/(C4/3.14),0),0)');
    expect(a.getCell('C6').dataValidation?.type).toBe('list');
    expect(a.model.merges).toContain('A1:B1');
    const b = wb.getWorksheet('AB002');
    expect(b.getCell('C2').value).toBe('ＡＢ００２'); // 番号はブックと同じく記録のまま（シートの名前だけ半角）
    expect(b.getCell('C6').value).toBe('■無 □有');
    expect(b.getCell('C8').value).toBe('□A □B □C □D □E'); // 「-」は選ばない
    const e = wb.getWorksheet('AB001_環境');
    expect(e.getCell('C3').value).toBe('□無 ■有');
    expect(e.getCell('C4').value).toBe('□無 □有');
    expect(e.getCell('E4').value).toBe('支柱なし');
    expect(wb.getWorksheet('AB002_環境').getCell('E4').value).toBe(null);
    const xml = await sheetXml(r.buffer, 'AB001');
    expect(xml).toContain('<headerFooter><oddHeader>&amp;R確認用（提出不可）</oddHeader></headerFooter>');
    expect(xml).not.toMatch(/codeName|r:id=/);
    // 式の前回の結果は消し、開いたときに計算し直す
    expect(xml).toMatch(/<f>IFERROR\(ROUND\(C3\/\(C4\/3\.14\),0\),0\)<\/f><\/c>/);
    const zip = await JSZip.loadAsync(r.buffer);
    expect(await zip.file('xl/workbook.xml').async('string')).toContain('fullCalcOnLoad="1"');
    // 選んだ状態のシートは最初の1枚だけ（複数だと「グループ」になる）
    const views = await Promise.all((await sheetFiles(zip)).map(async (f) => (await zip.file(f.file).async('string')).includes('tabSelected="1"')));
    expect(views.slice(1)).toEqual([false, false, false]);
    expect(r.stats.sheets.map((s) => s.form)).toEqual(['initial', 'environment', 'initial', 'environment']);
  });

  it('replaceFormula の欄は、様式の式を値に置き換えて書く（株立の幹周の並び・樹高/幹径の数値など）', async () => {
    const c2 = structuredClone(cfg);
    const cells = c2.initialSurvey.karte.sheets[0].cells;
    cells.find((x) => x.cell === 'C4').key = '@girthList';
    cells.push({ cell: 'C5', key: '@heightRatio', num: true, replaceFormula: true });
    expect(validateConfig(c2).errors).toEqual([]);
    const r = await exportKarte(await makeKarteTemplate(), [{ ...AB001, '@girthList': '2.1、0.80、0.90', '@heightRatio': 13 }], c2);
    expect(r.errors).toEqual([]);
    const a = (await load(r.buffer)).getWorksheet('AB001');
    expect(a.getCell('C4').value).toBe('2.1、0.80、0.90');
    expect(a.getCell('C5').value).toBe(13);
    // replaceFormula がなければ、式のセルには書かない
    cells.at(-1).replaceFormula = false;
    expect((await exportKarte(await makeKarteTemplate(), [AB001], c2)).errors.join('\n')).toContain('C5 には式');
  });

  it('fmt：表示形式に、入力した値などの文字を足す（値は数のまま、様式の式もそのまま計算できる）', async () => {
    const c2 = structuredClone(cfg);
    const cells = c2.initialSurvey.karte.sheets[0].cells;
    cells.find((x) => x.cell === 'C4').fmt = '0.00" m（{@girthStems} の和×0.8）"';
    cells.push({ cell: 'C5', keep: true, fmt: '#" 倍（アプリ {@heightRatio}倍）";;"（アプリ {@heightRatio}倍）"' });
    expect(validateConfig(c2).errors).toEqual([]);
    const multi = { ...AB001, girth: 2.66, '@girthStems': '2.1、0.80、0.90', '@heightRatio': 15 };
    const single = { ...AB002, girth: 1.5, '@girthStems': '', '@heightRatio': '' };
    const r = await exportKarte(await makeKarteTemplate(), [multi, single], c2);
    expect(r.errors).toEqual([]);
    const wb = await load(r.buffer);
    const a = wb.getWorksheet('AB001');
    expect(a.getCell('C4').value).toBe(2.66); // 値は数のまま
    expect(a.getCell('C4').numFmt).toBe('0.00" m（2.1、0.80、0.90 の和×0.8）"');
    expect(a.getCell('C5').value.formula).toBe('IFERROR(ROUND(C3/(C4/3.14),0),0)'); // 式は残る
    expect(a.getCell('C5').numFmt).toBe('#" 倍（アプリ 15倍）";;"（アプリ 15倍）"');
    // 足す文字が空なら、様式の表示形式のまま
    const b = wb.getWorksheet('AB002');
    expect(b.getCell('C4').value).toBe(1.5);
    expect(b.getCell('C4').numFmt || 'General').not.toContain('の和');
    expect(b.getCell('C5').value.formula).toBe('IFERROR(ROUND(C3/(C4/3.14),0),0)');
  });

  it('同じ番号の木（別の場所）はシートの名前を重ねない', async () => {
    const r = await exportKarte(await makeKarteTemplate(), [AB001, { ...AB001, parkCode: 'K02' }], cfg);
    expect(r.errors).toEqual([]);
    expect((await load(r.buffer)).worksheets.map((w) => w.name)).toEqual(['AB001', 'AB001_環境', 'AB001(2)', 'AB001_環境(2)']);
  });

  it('様式が見つからない・見出しが違う・書くセルに式があるときは作らない', async () => {
    const other = structuredClone(cfg);
    other.initialSurvey.karte.sheets[1].sheet = '^ないシート$';
    let r = await exportKarte(await makeKarteTemplate(), [AB001], other);
    expect(r.buffer).toBe(null);
    expect(r.errors.join('\n')).toContain('見つかりません');
    r = await exportKarte(await makeKarteTemplate({ title: '別のカルテ' }), [AB001], cfg);
    expect(r.buffer).toBe(null);
    expect(r.errors.join('\n')).toContain('A1');
    r = await exportKarte(await makeKarteTemplate({ withFormulaTarget: true }), [AB001], cfg);
    expect(r.buffer).toBe(null);
    expect(r.errors.join('\n')).toContain('C8 には式');
  });

  it('様式の読み込み：見つかったシートと、確かめた結果', async () => {
    const t = await readKarteTemplate(await makeKarteTemplate(), cfg);
    expect(t.errors).toEqual([]);
    expect(t.sheets.map((s) => s.name)).toEqual(['公園_カルテ', '公園_環境カルテ']);
  });

  it('写せない部品（図など）があるシートは誤り', () => {
    expect(() => normalizeSheet('<worksheet><sheetData/><hyperlinks><hyperlink ref="A1" r:id="rId3"/></hyperlinks></worksheet>', '')).toThrow('写せない');
    // 様式の選択の印・マクロ用の名前・印刷の設定の関連付け・式の前回の結果は外す
    expect(
      normalizeSheet('<worksheet><sheetPr codeName="Sheet7"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1" s="2" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row></sheetData><pageSetup paperSize="9" r:id="rId1"/></worksheet>', ''),
    ).toBe('<worksheet><sheetPr/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1" s="2"><f>"a"&amp;"b"</f></c></row></sheetData><pageSetup paperSize="9"/></worksheet>');
    // ヘッダーがすでにあれば右側だけを入れ替える
    expect(normalizeSheet('<worksheet><sheetData/><headerFooter><oddHeader>&amp;L左&amp;R右</oddHeader></headerFooter></worksheet>', '印')).toContain('<oddHeader>&amp;L左&amp;R印</oddHeader>');
  });
});

describe('長い文を枠に収める', () => {
  const load = async (buf) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return wb.worksheets[0];
  };
  it('枠に収まらない文は、文字を小さくして折り返す（7pt まで）。収まる文・様式に元からある文（□無 □有）はそのまま', async () => {
    const long = '地上0～0.5m、30cm×50cm、コフキタケ、周囲長比≧1/3（芯達）、根元の北側に小さな腐朽あり、樹皮の枯死が広い【13cm/80cm】';
    const r = await exportKarte(await makeKarteTemplate(), [{ ...AB001, b4Detail: long }], structuredClone(cfgJson));
    expect(r.errors).toEqual([]);
    const ws = await load(r.buffer);
    const e7 = ws.getCell('E7');
    expect(e7.value).toBe(long);
    expect(e7.alignment?.wrapText).toBe(true);
    expect(e7.font.size).toBeLessThan(11);
    expect(e7.font.size).toBeGreaterThanOrEqual(7);
    expect(ws.getCell('C6').alignment?.wrapText).toBeFalsy(); // □無 ■有 は様式の書式のまま
    expect(r.stats.tooLong).toEqual([]);

    // 短い文は何も変えない
    const r2 = await exportKarte(await makeKarteTemplate(), [{ ...AB001, b4Detail: '2本' }], structuredClone(cfgJson));
    expect((await load(r2.buffer)).getCell('E7').alignment?.wrapText).toBeFalsy();
  });

  it('7pt でも収まらない文は、どのシートのどの欄かを知らせる（ファイルは作る）', async () => {
    const huge = '長い文。'.repeat(80);
    const r = await exportKarte(await makeKarteTemplate(), [{ ...AB001, b4Detail: huge }], structuredClone(cfgJson));
    expect(r.errors).toEqual([]);
    expect(r.stats.tooLong).toEqual([{ sheet: 'AB001', cell: 'E7' }]);
    const e7 = (await load(r.buffer)).getCell('E7');
    expect(e7.value).toBe(huge); // 文は切らない
    expect(e7.font.size).toBe(7);
  });

  it('最小の大きさは設定で変えられる（5〜11）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.karte.minFontSize = 4;
    expect(validateConfig(c).errors.join('\n')).toContain('minFontSize');
  });
});
