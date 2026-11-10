// 野帳の出力と照合のテスト（架空の原本・架空の設定を使う）
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree } from '../src/core/tree.js';
import { cellValue } from '../src/excel/cell.js';
import { buildPages, exportFieldSheet, optionColumns, pageMeta, verifyFieldSheet } from '../src/excel/fieldSheet.js';
import { sheetFiles } from '../src/excel/xlsxFix.js';
import { makeTemplate } from './helpers/makeTemplate.js';

const cfg = structuredClone(cfgJson);

// 入力済みの木
const doneTree = (no, o = {}) =>
  blankTree({
    id: no, treeNo: no, species: 'テストノキ', siteType: 'park', done: true, date: '2099-05-06', inspector: '試験 二郎(資格)・試験 三子(資格)',
    height: '8', girths: ['0.5'], branchLen: '200', branchDia: '8', vigor: '並', lean: '無', deadBranch: '有', deadBranchCount: '2',
    decay: '無', fungus: '有', fungusName: 'ナガイナマエタケ', notes: '・枝の偏り\n・根元の割れ 幅2cm', initialNeeded: '否', grade: 'B', treatSel: ['枯れ枝'], ...o,
  });
const todo = (no, o = {}) => blankTree({ id: no, treeNo: no, species: 'ミホンカエデ', siteType: 'park', ...o });

const load = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};

// 用紙ごとの図形の名前（樹木番号|列|選択肢|選んだか）
async function shapeTags(buf) {
  const zip = await JSZip.loadAsync(buf);
  const out = [];
  for (const f of await sheetFiles(zip)) {
    const rel = await zip.file(`xl/worksheets/_rels/${f.file.split('/').pop()}.rels`)?.async('string');
    const target = rel?.match(/Target="\.\.\/drawings\/([^"]+)"/)?.[1];
    const xml = target ? await zip.file(`xl/drawings/${target}`).async('string') : '';
    out.push([...xml.matchAll(/name="([^"]*)"/g)].map((m) => m[1]));
  }
  return out;
}

describe('用紙の割り付けと見出し', () => {
  it('見本の設定（野帳の書式を含む）は正しい', () => expect(validateConfig(cfg)).toEqual({ ok: true, errors: [] }));

  it('区画ごとに分け、1枚に決まった本数ずつ入れる', () => {
    const ts = ['A1', 'A2', 'A3', 'A4'].map((n) => todo(n, { area: '北' })).concat([todo('B1', { area: '南' })]);
    expect(buildPages(ts, cfg).map((p) => [p.area, p.trees.map((t) => t.treeNo)])).toEqual([
      ['北', ['A1', 'A2', 'A3']],
      ['北', ['A4']],
      ['南', ['B1']],
    ]);
    expect(buildPages([], cfg)).toEqual([{ area: '', trees: [] }]);
  });

  it('見出しの調査者・日付は、その用紙の木の調査記録から決める', () => {
    expect(pageMeta([doneTree('A1'), todo('A2')], cfg)).toEqual({ inspector: '試験 二郎(資格)・試験 三子(資格)', date: '99年5月6日', multi: false });
    expect(pageMeta([todo('A2')], cfg)).toEqual({ inspector: '', date: '99年　　月　　日', multi: false });
    const ledgerTree = { ...doneTree('A3'), source: 'ledger', ledgerDate: '2099-05-01', ledgerInspector: '別人 一(資格)' };
    expect(pageMeta([doneTree('A1'), ledgerTree], cfg)).toEqual({ inspector: '行ごとに記載', date: '99年5月1ほか日', multi: true });
  });

  it('選択肢の詳細（本数・キノコの名前）は、選んだときだけ入れ、長い名前は折り返す', () => {
    const cols = optionColumns(doneTree('A1'), cfg);
    expect(cols.find((c) => c.field === 'deadBranch').opts[2].lines).toEqual(['有', '(2本)']);
    expect(cols.find((c) => c.field === 'fungus').opts[1].lines).toEqual(['有', '(ナガイ', 'ナマエ', 'タケ)']);
    const none = optionColumns(doneTree('A1', { deadBranch: '無', fungus: '有', fungusName: '' }), cfg);
    expect(none.find((c) => c.field === 'deadBranch').opts[2].lines).toEqual(['有', '(　本)']);
    expect(none.find((c) => c.field === 'fungus').opts[1].lines).toEqual(['有', '(不明)']);
  });

  it('枯死の木は点検項目を選ばない。詳しい診断「要」なら健全度を選ばない', () => {
    const dead = optionColumns(doneTree('A1', { vigor: '枯' }), cfg);
    expect(dead.find((c) => c.field === 'deadBranch').val).toBe('');
    expect(dead.find((c) => c.field === 'vigor').val).toBe('枯');
    expect(optionColumns(doneTree('A1', { initialNeeded: '要' }), cfg).find((c) => c.field === 'grade').val).toBe('');
  });
});

describe('野帳の出力', () => {
  it('入力済みの木は値と○、未入力の木は番号・樹種だけ（選択肢は原本のまま）。照合に通る', async () => {
    const tpl = await makeTemplate();
    const pages = buildPages([doneTree('AB001'), todo('AB002', { status: '残存', prevNote: '前の特記' }), doneTree('AB003', { girths: ['0.3', '0.2'] })], cfg);
    const r = await exportFieldSheet(tpl, pages, cfg, { title: '架空公園' });
    expect(r.errors).toEqual([]);
    const ws = (await load(r.buffer)).worksheets[0];
    const v = (a) => cellValue(ws.getCell(a));
    expect(v('B1')).toBe('架空公園');
    expect(v('H1')).toBe('試験 二郎(資格)・試験 三子(資格)');
    expect([v('A4'), v('A5'), v('B4'), v('C4'), v('D4'), v('J4'), v('L4')]).toEqual(['AB001', 'テストノキ', 8, 0.5, '200/8', '否', '枯れ枝剪定']);
    expect(v('I4')).toBe('・枝の偏り\n・根元の割れ 幅2cm');
    expect(v('E4')).toBe(''); // 入力済みの木の選択肢は図形で描く
    expect([v('A6'), v('A7'), v('E6')]).toEqual(['AB002\n前回:前の特記', 'ミホンカエデ\n残存', '良\n並\n枯']);
    expect(v('C8')).toBe('0.30\n0.20\n→0.40'); // 株立は各幹周と記録値
    const tags = (await shapeTags(r.buffer))[0];
    expect(tags.filter((t) => t.endsWith('|1')).sort()).toEqual(
      ['AB001|4|並|1', 'AB001|5|有|1', 'AB001|6|有|1', 'AB001|7|無|1', 'AB001|10|B|1', 'AB001|13|有|1',
       'AB003|4|並|1', 'AB003|5|有|1', 'AB003|6|有|1', 'AB003|7|無|1', 'AB003|10|B|1', 'AB003|13|有|1'].sort(),
    );
    expect(tags.some((t) => t.startsWith('AB002'))).toBe(false);
  });

  it('特記事項・処置の文が枠に収まらなければ、文字を小さくする（最小 6pt）。短い文は 9pt のまま', async () => {
    const tpl = await makeTemplate();
    const long = Array.from({ length: 6 }, (_, i) => `・根株の腐朽：H0～0.${i + 1}m、40×20cm、20/170`).join('\n');
    const huge = '・長い文。'.repeat(60);
    const pages = buildPages([doneTree('AB001', { notes: long }), doneTree('AB002'), doneTree('AB003', { notes: huge })], cfg);
    const r = await exportFieldSheet(tpl, pages, cfg);
    expect(r.errors).toEqual([]);
    const ws = (await load(r.buffer)).worksheets[0];
    expect(ws.getCell('I4').font.size).toBeLessThan(9);
    expect(ws.getCell('I4').font.size).toBeGreaterThanOrEqual(6);
    expect(ws.getCell('I4').alignment.wrapText).toBe(true);
    expect(ws.getCell('I6').font.size).toBe(9);
    expect(ws.getCell('L6').font.size).toBe(9);
    // 6pt でも収まらない欄は知らせる（文は切らない）
    expect(ws.getCell('I8').font.size).toBe(6);
    expect(r.tooLong).toEqual([{ page: '1', treeNo: 'AB003', field: '特記事項' }]);
  });

  it('最小の大きさは設定で変えられる（5〜9）', () => {
    const c = structuredClone(cfg);
    c.fieldSheet.minFontSize = 4;
    expect(validateConfig(c).errors.join('\n')).toContain('minFontSize');
  });

  it('前回の調査の印を番号の欄に書く。印が消えていたら照合で見つける', async () => {
    const tpl = await makeTemplate();
    const pages = buildPages([doneTree('AB001', { prevMarks: ['前回詳(2090)'] }), todo('AB002', { prevNote: '前の特記', prevMarks: ['前回詳(2090)'] })], cfg);
    const r = await exportFieldSheet(tpl, pages, cfg);
    expect(r.errors).toEqual([]);
    const ws = (await load(r.buffer)).worksheets[0];
    expect(cellValue(ws.getCell('A4'))).toBe('AB001\n前回詳(2090)');
    expect(cellValue(ws.getCell('A6'))).toBe('AB002\n前回:前の特記\n前回詳(2090)');
    // 印のない出力を、印がある前提で照合すると食い違いになる
    const plain = await exportFieldSheet(tpl, buildPages([doneTree('AB001'), todo('AB002')], cfg), cfg);
    const errs = await verifyFieldSheet(plain.buffer, tpl, pages, cfg);
    expect(errs.filter((e) => e.includes('前回の印'))).toHaveLength(2);
  });

  it('罫線の色「自動」を付け直す。2枚目以降も原本と同じ罫線になる', async () => {
    const pages = buildPages(['A1', 'A2', 'A3', 'A4'].map((n) => doneTree(n)), cfg);
    const r = await exportFieldSheet(await makeTemplate(), pages, cfg);
    expect(r.errors).toEqual([]);
    const styles = await (await JSZip.loadAsync(r.buffer)).file('xl/styles.xml').async('string');
    expect(styles).not.toMatch(/<(left|right|top|bottom) style="[A-Za-z]+"\/>/);
    const wb = await load(r.buffer);
    // 結合セルの下側（5行目）の罫線が、複製した2枚目でも残っている
    expect(wb.worksheets[1].getCell('E5').border?.bottom?.style).toBe('thin');
  });

  it('【再発防止】シートの番号と中のファイル名がずれた原本でも、○は正しい用紙に付く', async () => {
    const tpl = await makeTemplate({ sheetId: 5 });
    const ts = ['P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'R1'].map((n) => doneTree(n));
    const r = await exportFieldSheet(tpl, buildPages(ts, cfg), cfg);
    expect(r.errors).toEqual([]);
    const tags = await shapeTags(r.buffer);
    expect(tags.map((list) => [...new Set(list.map((t) => t[0]))])).toEqual([['P'], ['Q'], ['R']]);
  });
});

describe('野帳の照合（不具合を見逃さないか）', () => {
  // 正しく書き出したあと、中身をわざと壊して照合にかける
  async function tampered(change) {
    const tpl = await makeTemplate();
    const pages = buildPages(['A1', 'A2', 'A3', 'B1'].map((n) => doneTree(n)).concat([todo('B2')]), cfg);
    const r = await exportFieldSheet(tpl, pages, cfg);
    expect(r.errors).toEqual([]);
    const zip = await JSZip.loadAsync(r.buffer);
    await change(zip);
    return verifyFieldSheet(await zip.generateAsync({ type: 'uint8array' }), tpl, pages, cfg);
  }
  const drawing = (zip, n) => zip.file(`xl/drawings/drawing${n}.xml`);
  const edit = async (zip, path, fn) => zip.file(path, fn(await zip.file(path).async('string')));

  it('何も壊していなければ合格', async () => expect(await tampered(async () => {})).toEqual([]));

  it('○が別の用紙に付いた（図形の付け先の取り違え）', async () => {
    const errs = await tampered(async (zip) => {
      const [a, b] = await Promise.all([drawing(zip, 1).async('string'), drawing(zip, 2).async('string')]);
      zip.file('xl/drawings/drawing1.xml', b);
      zip.file('xl/drawings/drawing2.xml', a);
    });
    expect(errs.join('\n')).toMatch(/この用紙にない木/);
  });

  it('○が別の選択肢に付いた', async () => {
    const errs = await tampered((zip) => edit(zip, 'xl/drawings/drawing1.xml', (x) => x.replace('name="A1|4|並|1"', 'name="A1|4|良|1"')));
    expect(errs.join('\n')).toMatch(/A1：vigor の○が「良」/);
  });

  it('○の図形が丸ではなくなった（選んだのに囲まれていない）', async () => {
    const errs = await tampered((zip) =>
      edit(zip, 'xl/drawings/drawing1.xml', (x) => x.replace(/(name="A1\|4\|並\|1"[\s\S]*?prst=")ellipse/, '$1rect')),
    );
    expect(errs.join('\n')).toMatch(/A1：vigor の○が「なし」/);
  });

  it('図形が1本分下の行にずれた', async () => {
    const errs = await tampered((zip) =>
      edit(zip, 'xl/drawings/drawing1.xml', (x) => x.replace(/(<xdr:from><xdr:col>4<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>)3(<)/, '$15$2')),
    );
    expect(errs.join('\n')).toMatch(/別の場所/);
  });

  it('図形が足りない', async () => {
    const errs = await tampered((zip) => edit(zip, 'xl/drawings/drawing1.xml', (x) => x.replace(/<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>/, '')));
    expect(errs.join('\n')).toMatch(/図形の数が合いません/);
  });

  it('樹木番号・値の行ずれ、未入力の木の選択肢の欄の変化', async () => {
    const errs = await tampered(async (zip) => {
      const files = await sheetFiles(zip);
      await edit(zip, files[0].file, (x) => x); // 1枚目はそのまま
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await zip.generateAsync({ type: 'uint8array' }));
      wb.worksheets[0].getCell('B4').value = 9.9;
      wb.worksheets[0].getCell('A6').value = 'A9';
      wb.worksheets[1].getCell('E6').value = null;
      const z2 = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
      for (const [name, f] of Object.entries(z2.files)) if (!f.dir) zip.file(name, await f.async('uint8array'));
    });
    const s = errs.join('\n');
    expect(s).toMatch(/A1：樹高が9.9/);
    expect(s).toMatch(/6行目：樹木番号が「A9」/);
    expect(s).toMatch(/B2：未入力の木の選択肢の欄/);
  });
});

describe('選んだものだけを書く書き方（fieldSheet.optionStyle: selected）', () => {
  const sel = structuredClone(cfgJson);
  Object.assign(sel.fieldSheet, { optionStyle: 'selected', optionWidth: 0.7, widenCol: 'I', selectedFontPt: 12 });

  it('選んだ選択肢だけを○なしで書き、選択肢の列を細くした分を特記事項の列に足す（用紙の幅は同じ）。照合に通る', async () => {
    expect(validateConfig(sel).errors).toEqual([]);
    const tpl = await makeTemplate();
    const pages = buildPages([doneTree('AB001'), todo('AB002'), doneTree('AB003', { grade: '' })], sel);
    const r = await exportFieldSheet(tpl, pages, sel);
    expect(r.errors).toEqual([]);
    const tags = (await shapeTags(r.buffer))[0];
    // 選んだものだけ（AB003 は健全度が空なので健全度の図形はない）
    expect(tags.sort()).toEqual(
      ['AB001|4|並|1', 'AB001|5|有|1', 'AB001|6|有|1', 'AB001|7|無|1', 'AB001|10|B|1', 'AB001|13|有|1',
       'AB003|4|並|1', 'AB003|5|有|1', 'AB003|6|有|1', 'AB003|7|無|1', 'AB003|13|有|1'].sort(),
    );
    const zip = await JSZip.loadAsync(r.buffer);
    const xml = await zip.file('xl/drawings/drawing1.xml').async('string');
    expect(xml).not.toContain('prst="ellipse"'); // ○で囲まない
    expect(xml).toContain('sz="1200"');
    // 列の幅：選択肢の列は 0.7 倍、細くした分を特記事項の列へ
    const before = (await load(tpl)).worksheets[0];
    const after = (await load(r.buffer)).worksheets[0];
    const w = (ws, L) => ws.getColumn(L).width ?? sel.fieldSheet.defaultColWidth;
    const opt = sel.fieldSheet.optionCols.map((o) => o.col);
    for (const L of opt) expect(w(after, L)).toBeCloseTo(w(before, L) * 0.7, 1);
    const total = (ws) => [...opt, 'I'].reduce((a, L) => a + w(ws, L), 0);
    expect(total(after)).toBeCloseTo(total(before), 1);
    expect(w(after, 'I')).toBeGreaterThan(w(before, 'I'));
    // 未入力の木の選択肢の欄は原本の文字のまま
    expect(cellValue(after.getCell('E6'))).toBe('良\n並\n枯');
  });

  it('選んだ選択肢と違う図形・○で囲んだ図形は照合で見つける', async () => {
    const tpl = await makeTemplate();
    const pages = buildPages([doneTree('A1')], sel);
    const r = await exportFieldSheet(tpl, pages, sel);
    const zip = await JSZip.loadAsync(r.buffer);
    const path = 'xl/drawings/drawing1.xml';
    const x = await zip.file(path).async('string');
    zip.file(path, x.replace('name="A1|4|並|1"', 'name="A1|4|良|1"'));
    expect((await verifyFieldSheet(await zip.generateAsync({ type: 'uint8array' }), tpl, pages, sel)).join('\n')).toMatch(/A1：vigor の○が「良」/);
    zip.file(path, x.replace(/(name="A1\|5\|有\|1"[\s\S]*?prst=")rect/, '$1ellipse'));
    expect((await verifyFieldSheet(await zip.generateAsync({ type: 'uint8array' }), tpl, pages, sel)).join('\n')).toMatch(/A1：\w+ の○が「なし」（正しくは「有」）/);
  });
});

describe('列の幅・余白・枝長/枝径の比（fieldSheet.colWidths・sideMarginMm・branchFontPt・branchRatioLine）', () => {
  const wcfg = structuredClone(cfgJson);
  Object.assign(wcfg.fieldSheet, { optionStyle: 'selected', optionWidth: 0.8, widenCol: 'I', colWidths: { D: 8, M: 8 }, sideMarginMm: 7.5, branchFontPt: 8, branchRatioLine: true });
  const w = (ws, L) => ws.getColumn(L).width ?? wcfg.fieldSheet.defaultColWidth;

  it('決めた列の幅にし、余白を狭めた分も含めて差を特記事項の列で受ける。照合に通る', async () => {
    expect(validateConfig(wcfg).errors).toEqual([]);
    const tpl = await makeTemplate();
    const r = await exportFieldSheet(tpl, buildPages([doneTree('AB001')], wcfg), wcfg);
    expect(r.errors).toEqual([]);
    const before = (await load(tpl)).worksheets[0];
    const after = (await load(r.buffer)).worksheets[0];
    expect(w(after, 'D')).toBe(8);
    expect(w(after, 'M')).toBe(8);
    expect(w(after, 'L')).toBe(w(before, 'L')); // 決めていない列（処置）は変えない
    // 余白：左右 0.7in → 7.5mm。狭めた分（mm）を列の幅の数に直して足す（縮小率 100%）
    expect(after.pageSetup.margins.left).toBeCloseTo(7.5 / 25.4, 5);
    expect(after.pageSetup.margins.right).toBeCloseTo(7.5 / 25.4, 5);
    const gain = ((0.7 * 2 * 25.4 - 15) / 25.4) * 72 / 0.75 / wcfg.fieldSheet.charPx;
    const cols = 'ABCDEFGHIJKLMN'.split('');
    const total = (ws) => cols.reduce((a, L) => a + w(ws, L), 0);
    expect(total(after)).toBeCloseTo(total(before) + gain, 1);
  });

  it('枝長/枝径は決めた大きさで書き、下の行に比を足す（上限以上は表記の文字）。台帳の木は台帳の値のまま', async () => {
    const tpl = await makeTemplate();
    const ledger = doneTree('AB003', { source: 'ledger', branchLen: '', branchDia: '', ledgerBranchRatio: '12.5' });
    const r = await exportFieldSheet(tpl, buildPages([doneTree('AB001'), doneTree('AB002', { branchLen: '300', branchDia: '8' }), ledger], wcfg), wcfg);
    expect(r.errors).toEqual([]);
    const ws = (await load(r.buffer)).worksheets[0];
    expect(cellValue(ws.getCell('D4'))).toBe('200/8\n25');
    expect(cellValue(ws.getCell('D6'))).toBe('300/8\n30倍以上');
    expect(cellValue(ws.getCell('D8'))).toBe(12.5);
    expect(ws.getCell('D4').font.size).toBe(8);
    expect(ws.getCell('D4').alignment).toMatchObject({ wrapText: true, vertical: 'middle', horizontal: 'center' });
  });

  it('設定がなければ今までどおり（10pt・比なし・列の幅と余白はそのまま）', async () => {
    const tpl = await makeTemplate();
    const r = await exportFieldSheet(tpl, buildPages([doneTree('AB001')], cfg), cfg);
    const ws = (await load(r.buffer)).worksheets[0];
    expect(cellValue(ws.getCell('D4'))).toBe('200/8');
    expect(ws.getCell('D4').font.size).toBe(10);
    expect(w(ws, 'D')).toBe(6);
  });

  it('枝長/枝径の値が違えば照合で見つける', async () => {
    const tpl = await makeTemplate();
    const pages = buildPages([doneTree('AB001')], wcfg);
    const r = await exportFieldSheet(tpl, pages, wcfg);
    const wb = await load(r.buffer);
    wb.worksheets[0].getCell('D4').value = '200/8';
    expect((await verifyFieldSheet(await wb.xlsx.writeBuffer(), tpl, pages, wcfg)).join('\n')).toMatch(/AB001：枝長\/枝径が「200\/8」/);
  });

  it('【再現】細くした列で、選んだ選択肢の字と原本の見出しの字が枠からはみ出さない', async () => {
    // 不具合：選択肢の列を細くすると、選んだ選択肢の字（12pt）と原本の見出しの字が枠からはみ出していた
    const narrow = structuredClone(wcfg);
    narrow.fieldSheet.optionWidth = 0.5;
    const twb = await load(await makeTemplate());
    twb.worksheets[0].getCell('E2').value = '樹勢の良し悪しを見る';
    const tpl = await twb.xlsx.writeBuffer();
    const r = await exportFieldSheet(tpl, buildPages([doneTree('AB001')], narrow), narrow);
    expect(r.errors).toEqual([]);
    const ws = (await load(r.buffer)).worksheets[0];
    expect(ws.getCell('E2').font?.size ?? 11).toBeLessThan(11); // 見出しを小さくした
    expect(ws.getCell('I2').font?.size ?? 11).toBe(11); // 広げた列の見出しはそのまま
    // 選んだ選択肢（樹勢「並」）の字：幅を1割多めに見積もり、左右 4pt ずつ空けて列に収める
    const xml = await (await JSZip.loadAsync(r.buffer)).file('xl/drawings/drawing1.xml').async('string');
    const sz = Number(xml.match(/name="AB001\|4\|並\|1"[\s\S]*?sz="(\d+)"/)[1]) / 100;
    const colPt = Math.trunc(w(ws, 'E') * narrow.fieldSheet.charPx + 5) * 0.75;
    expect(sz).toBeLessThan(12);
    expect(sz * 1.1 + 8).toBeLessThanOrEqual(colPt + 1e-6);
  });
});

describe('【再現】同じ用紙に同じ番号の木が2本ある', () => {
  // 不具合：番号が同じ木（例 台帳の木と、現場で追加した同じ番号の木）が同じ用紙にあると、
  //  図形の名前（樹木番号）で木を見分けていたため、照合で「図形が別の場所にあります」「○が2つ」になり、保存できなかった
  it('2本目の図形には「番号~2」の印を付け、照合に通る', async () => {
    const tpl = await makeTemplate();
    const pages = buildPages([doneTree('AB001'), doneTree('AB001', { id: 'x2', vigor: '良' })], cfg);
    const r = await exportFieldSheet(tpl, pages, cfg);
    expect(r.errors).toEqual([]);
    const tags = (await shapeTags(r.buffer))[0];
    expect(tags.filter((t) => t.startsWith('AB001|4|') && t.endsWith('|1'))).toEqual(['AB001|4|並|1']);
    expect(tags.filter((t) => t.startsWith('AB001~2|4|') && t.endsWith('|1'))).toEqual(['AB001~2|4|良|1']);
    // 1本目と2本目の図形を入れ替えたら見つける
    const zip = await JSZip.loadAsync(r.buffer);
    const x = await zip.file('xl/drawings/drawing1.xml').async('string');
    zip.file('xl/drawings/drawing1.xml', x.replace('name="AB001|4|並|1"', 'name="AB001|4|良|1"'));
    expect((await verifyFieldSheet(await zip.generateAsync({ type: 'uint8array' }), tpl, pages, cfg)).join('\n')).toMatch(/AB001：vigor の○が「良」/);
  });
});
