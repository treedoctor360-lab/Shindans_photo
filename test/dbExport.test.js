// 一覧表への書き戻しと、書き戻し後の照合のテスト（架空の台帳を使う）
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { cellValue } from '../src/excel/cell.js';
import { dbValues, exportDb, verifyDb } from '../src/excel/dbExport.js';
import { mergeLedger, readLedger } from '../src/excel/ledger.js';
import { fixBorderXml, sheetFiles } from '../src/excel/xlsxFix.js';
import { makeLedger } from './helpers/makeLedger.js';

const cfg = structuredClone(cfgJson);

// 台帳を読み込んだ状態から始める
async function setup() {
  const buf = await makeLedger();
  const { rows } = await readLedger(buf, cfg);
  const { trees } = mergeLedger([], rows, cfg);
  return { buf, trees };
}

// アプリで入力した木（AB002：台帳4行目）
const entry = {
  done: true,
  date: '2099-05-06',
  inspector: '試験 二郎・試験 三子',
  species: 'ミホンカエデ',
  height: '１０',
  girths: ['0.3', '0.2'], // 株立 → (0.5)×0.8 = 0.4
  branchLen: '200',
  branchDia: '8', // 25（上限30未満なので数値のまま）
  vigor: '並',
  lean: '無',
  deadBranch: '有',
  deadBranchCount: '2',
  decay: '小',
  fungus: '有',
  fungusName: '不明',
  notes: '・枝の偏り\n・根元の割れ 幅2cm',
  initialNeeded: '否',
  grade: 'C',
  treatSel: ['枯れ枝'],
  treatFree: '',
};

const load = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};
const val = (wb, sheet, addr) => cellValue(wb.getWorksheet(sheet).getCell(addr));

describe('一覧表に書く値', () => {
  it('見本の設定（書き戻しの項目を含む）は正しい', () => expect(validateConfig(cfg)).toEqual({ ok: true, errors: [] }));

  it('「有(…)」の形、株立の幹周、枝長/枝径、特記・処置の組み立て', async () => {
    const { trees } = await setup();
    const t = { ...trees.find((x) => x.treeNo === 'AB002'), ...entry };
    const v = dbValues(t, cfg);
    expect(v).toMatchObject({
      inspector: '試験 二郎・試験 三子', height: 10, girth: 0.4, heightRatio: 79, branchRatio: 25,
      deadBranch: '有(2本)', fungus: '有(名前不明)', decay: '小', note: '枝の偏りあり。', grade: 'C', treat: '枯れ枝剪定', photo: '有',
      fellingReason: null,
    });
    expect(v.date.toISOString()).toBe('2099-05-06T00:00:00.000Z');
  });

  it('枯死の木は点検項目を空欄、詳しい診断「要」なら健全度を空欄、本数がなければ「?」', () => {
    const v1 = dbValues({ ...entry, vigor: '枯' }, cfg);
    expect([v1.lean, v1.deadBranch, v1.fungus, v1.branchRatio]).toEqual([null, null, null, '-']);
    expect(dbValues({ ...entry, initialNeeded: '要' }, cfg).grade).toBeNull();
    expect(dbValues({ ...entry, deadBranchCount: '' }, cfg).deadBranch).toBe('有(?本)');
  });
});

describe('一覧表への書き戻し', () => {
  it('アプリで入力した木の行だけに書き、照合に通る（他のセル・設定にない列は元のまま）', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats).toEqual({ written: 1, appended: 0, skippedLedgerDone: [], gradeOnly: [], gradeKept: [] });

    const wb = await load(r.buffer);
    const ws = wb.getWorksheet('公園');
    expect(ws.getCell('J4').value).toEqual({ formula: 'ROUND((H4/(I4/3.14)),0)', result: 79 });
    expect(val(wb, '公園', 'L4')).toBe('並');
    expect(val(wb, '公園', 'N4')).toBe('有(2本)');
    expect(val(wb, '公園', 'W4')).toBe('残しておくメモ');
    expect(val(wb, '公園', 'D4')).toBe('ＡＢ００２'); // 番号の列は書き換えない
    // 読み直すと、台帳で入力済みの木として取り込める
    const again = mergeLedger([], (await readLedger(r.buffer, cfg)).rows, cfg).trees.find((t) => t.treeNo === 'AB002');
    expect(again).toMatchObject({ source: 'ledger', vigor: '並', deadBranch: '有', deadBranchCount: '2', fungusName: '名前不明', ledgerDate: '2099-05-06' });
  });

  it('詳しい診断が必要な木は、詳しい診断の結果（initialGrade）があるときだけ健全度を書き、照合に通る', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry, initialNeeded: '要', initialGrade: 'D' } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    const again = mergeLedger([], (await readLedger(r.buffer, cfg)).rows, cfg).trees.find((t) => t.treeNo === 'AB002');
    expect(again.grade).toBe('D');
    expect(dbValues({ ...entry, initialNeeded: '要' }, cfg).grade).toBeNull(); // 結果がなければ空欄のまま
  });

  it('照合：元のファイルにあったシートが、書き出したファイルからなくなっていれば知らせる', async () => {
    const { buf } = await setup();
    const wb = await load(buf);
    const name = wb.worksheets[0].name;
    wb.removeWorksheet(wb.worksheets[0].id);
    const errs = await verifyDb(await wb.xlsx.writeBuffer(), buf, [], cfg);
    expect(errs.join('\n')).toContain(`シート「${name}」が書き出したファイルにありません`);
  });

  it('罫線の色「自動」を付け直す', async () => {
    const { buf, trees } = await setup();
    const r = await exportDb(buf, trees, cfg);
    const styles = await (await JSZip.loadAsync(r.buffer)).file('xl/styles.xml').async('string');
    expect(styles).not.toMatch(/<(left|right|top|bottom) style="[A-Za-z]+"\/>/);
  });

  it('台帳にない木は末尾に足す（通し番号は状態に応じて）', async () => {
    const { buf, trees } = await setup();
    const extra = [
      { ...entry, id: 'n1', siteType: 'park', treeNo: 'ZZ901', dupIndex: 1, source: 'app', parkCode: 'K05', parkName: '架空公園', status: '' },
      { ...entry, id: 'n2', siteType: 'park', treeNo: 'ZZ902', dupIndex: 1, source: 'app', parkCode: 'K05', parkName: '架空公園', status: '残存' },
    ];
    const r = await exportDb(buf, [...trees, ...extra], cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats.appended).toBe(2);
    const wb = await load(r.buffer);
    expect(['A7', 'D7', 'C7', 'B7'].map((a) => val(wb, '公園', a))).toEqual(['追加', 'ZZ901', '架空公園', 'K05']);
    expect(['A8', 'D8'].map((a) => val(wb, '公園', a))).toEqual(['残存', 'ZZ902']);
  });

  it('台帳で入力済みの木・台帳側で入力済みになっていた木は書かない', async () => {
    const { buf, trees } = await setup();
    // AB001 は台帳で入力済み。アプリ側で入力済みにしていても、台帳を正として書かない
    const mine = trees.map((t) => (t.treeNo === 'AB001' && t.siteType === 'park' && t.dupIndex === 1 ? { ...t, ...entry, source: 'app' } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats).toEqual({ written: 0, appended: 0, skippedLedgerDone: ['AB001'], gradeOnly: [], gradeKept: [] });
  });

  it('台帳で入力済みの行（紙から手で入力した行）には、健全度が空欄のときだけ詳しい診断の結果を書く。他のセルは元のまま', async () => {
    const { buf, trees } = await setup();
    const ab1 = (t) => t.treeNo === 'AB001' && t.siteType === 'park' && t.dupIndex === 1;
    expect(trees.find(ab1).source).toBe('ledger');
    const mine = trees.map((t) => (ab1(t) ? { ...t, initialNeeded: '要', initialGrade: 'C' } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ written: 0, appended: 0, gradeOnly: ['AB001'], gradeKept: [] });
    const wb = await load(r.buffer);
    expect(val(wb, '公園', 'S3')).toBe('C');
    expect(val(wb, '公園', 'L3')).toBe('良'); // 他の列は書かない
    expect(r.plan.find((p) => p.row === 3).columns).toHaveLength(1);

    // アプリで入力済みにしていても、台帳側で入力済みになっていた行は健全度だけ
    const app = trees.map((t) => (ab1(t) ? { ...t, ...entry, source: 'app', initialNeeded: '要', initialGrade: 'D' } : t));
    const r2 = await exportDb(buf, app, cfg);
    expect(r2.errors).toEqual([]);
    expect(r2.stats).toMatchObject({ skippedLedgerDone: ['AB001'], gradeOnly: ['AB001'] });
    expect(val(await load(r2.buffer), '公園', 'L3')).toBe('良');
  });

  it('台帳の行に健全度が既に入っていれば書き換えない。違う値なら知らせる', async () => {
    const { buf: b0, trees } = await setup();
    const wb0 = await load(b0);
    wb0.getWorksheet('公園').getCell('S3').value = 'B';
    const buf = await wb0.xlsx.writeBuffer();
    const ab1 = (t) => t.treeNo === 'AB001' && t.siteType === 'park' && t.dupIndex === 1;
    const withGrade = (g) => trees.map((t) => (ab1(t) ? { ...t, initialNeeded: '要', initialGrade: g } : t));
    const r = await exportDb(buf, withGrade('C'), cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ gradeOnly: [], gradeKept: [{ label: 'AB001', now: 'B', grade: 'C' }] });
    expect(val(await load(r.buffer), '公園', 'S3')).toBe('B');
    // 同じ値なら知らせない
    expect((await exportDb(buf, withGrade('B'), cfg)).stats).toMatchObject({ gradeOnly: [], gradeKept: [] });
  });

  it('台帳の行に健全度だけ書くときも、場所の名前が違えば止める', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB001' && t.siteType === 'park' && t.dupIndex === 1 ? { ...t, parkName: '違う公園', initialNeeded: '要', initialGrade: 'C' } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.buffer).toBeNull();
    expect(r.errors.join('\n')).toMatch(/AB001.*場所/);
  });

  it('番号が重複している木は「何本目か」の行に書く', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB001' && t.dupIndex === 2 ? { ...t, ...entry } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    const wb = await load(r.buffer);
    expect(val(wb, '公園', 'L6')).toBe('並'); // 2本目（6行目）
    expect(val(wb, '公園', 'L3')).toBe('良'); // 1本目は元のまま
  });

  it('場所の名前が台帳と違えば、書かずに止める', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry, parkName: '違う公園' } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.buffer).toBeNull();
    expect(r.errors.join('\n')).toMatch(/AB002.*場所/);
  });

  it('読み込んだ後に台帳の行が入れ替わっていたら、書かずに止める（樹種で気付く）', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry } : t));
    const wb = await load(buf);
    wb.getWorksheet('公園').getCell('E4').value = '別の樹種'; // 4行目が別の木に変わった
    const r = await exportDb(await wb.xlsx.writeBuffer(), mine, cfg);
    expect(r.buffer).toBeNull();
    expect(r.errors.join('\n')).toMatch(/樹種/);
  });

  it('アプリで樹種を直していても、照合は読み込んだときの樹種で行う', async () => {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry, species: 'テストノキ' } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    expect(val(await load(r.buffer), '公園', 'E4')).toBe('テストノキ');
  });
});

describe('書き戻し後の照合（不具合を見逃さないか）', () => {
  // 正しく書き出したあと、ファイルをわざと壊して照合にかける
  async function tampered(change) {
    const { buf, trees } = await setup();
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry } : t));
    const r = await exportDb(buf, mine, cfg);
    const wb = await load(r.buffer);
    change(wb.getWorksheet('公園'));
    return verifyDb(await wb.xlsx.writeBuffer(), buf, r.plan, cfg);
  }

  it('書いた値の誤り', async () => {
    expect((await tampered((ws) => (ws.getCell('N4').value = '有(3本)'))).join('\n')).toMatch(/AB002：deadBranch/);
  });
  it('樹高/幹径の式の誤り（別の行を参照）', async () => {
    expect((await tampered((ws) => (ws.getCell('J4').value = { formula: 'ROUND((H5/(I5/3.14)),0)', result: 79 }))).join('\n')).toMatch(/式/);
  });
  it('書いていない行の変化（1行ずれて書いた場合など）', async () => {
    expect((await tampered((ws) => (ws.getCell('L5').value = '並'))).join('\n')).toMatch(/5行目12列目/);
  });
  it('書いた行の、書いていない列の変化', async () => {
    expect((await tampered((ws) => (ws.getCell('W4').value = null))).join('\n')).toMatch(/4行目23列目/);
  });
  it('番号の行の増減', async () => {
    const errs = await tampered((ws) => (ws.getCell('D9').value = 'AB002'));
    expect(errs.join('\n')).toMatch(/AB002：行が2行/);
  });
  it('何も壊していなければ合格', async () => expect(await tampered(() => {})).toEqual([]));
});

describe('xlsx の補正', () => {
  it('色のない罫線に「自動」を付ける', () => {
    expect(fixBorderXml('<left style="thin"/><top style="thin"><color rgb="FF000000"/></top>')).toBe(
      '<left style="thin"><color auto="1"/></left><top style="thin"><color rgb="FF000000"/></top>',
    );
  });
  it('シートの並び順と中のファイルの対応を取る', async () => {
    const zip = await JSZip.loadAsync(await makeLedger());
    const files = await sheetFiles(zip);
    expect(files.map((x) => x.name)).toEqual(['公園', '道路', '集計']);
    for (const x of files) expect(zip.file(x.file)).not.toBeNull();
  });
});

describe('追加した木の番号が、台帳の別の場所の木と同じとき', () => {
  // 現地の番号札が、台帳では別の場所の木の番号だった（台帳にない木として追加した）
  const added = { ...entry, id: 'new:1', uid: 'dev-1', siteType: 'park', treeNo: 'AB002', dupIndex: 1, source: 'app', status: '追加', parkCode: 'K09', parkName: '別の架空公園', species: 'ベツノキ' };

  it('台帳の行（別の場所）には書かず、末尾に足す。照合に通る', async () => {
    const { buf, trees } = await setup();
    const r = await exportDb(buf, [...trees, added], cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ written: 0, appended: 1 });
    const wb = await load(r.buffer);
    expect(['D7', 'C7', 'E7'].map((a) => val(wb, '公園', a))).toEqual(['AB002', '別の架空公園', 'ベツノキ']);
    expect(val(wb, '公園', 'L4') || '').toBe(''); // 台帳の AB002（架空公園）は元のまま（未入力）
  });

  it('足した後の一覧表にもう一度書き戻すときは、足した行（同じ場所）を見つける（二重に足さない）', async () => {
    const { buf, trees } = await setup();
    const first = await exportDb(buf, [...trees, added], cfg);
    const r = await exportDb(first.buffer, [...trees, added], cfg);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ appended: 0, skippedLedgerDone: ['AB002'] });
  });

  it('台帳を読み込み直しても、追加した木が台帳の別の場所の木に入れ替わらない', async () => {
    const { buf, trees } = await setup();
    const { rows } = await readLedger(buf, cfg);
    // 追加した木が一覧の後ろにある状態（読み込み直すと、台帳にない木は後ろに並ぶ）
    for (let i = 0; i < 2; i++) {
      const { trees: again } = mergeLedger([...trees, added], rows, cfg);
      const a = again.find((t) => t.uid === 'dev-1');
      expect(a).toMatchObject({ parkName: '別の架空公園', species: 'ベツノキ', done: true, source: 'app' });
      expect(a.ledgerRow).toBeUndefined();
      const l = again.filter((t) => t.treeNo === 'AB002' && t.ledgerRow);
      expect(l).toHaveLength(1);
      expect(l[0].parkName).toBe('架空公園');
    }
  });
});

describe('【再発防止】名前付き範囲（オートフィルター・印刷範囲など）を崩さない', () => {
  // ExcelJS は読み書きで名前付き範囲を崩し、Excel で開くと「修復」になっていた
  const NAMES = [
    '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">公園!$A$2:$V$8</definedName>',
    '<definedName name="_xlnm.Print_Area" localSheetId="0">公園!$A$1:$V$8</definedName>',
    '<definedName name="_xlnm.Print_Titles" localSheetId="0">公園!$1:$2</definedName>',
    '<definedName name="壊れた名前">#REF!</definedName>',
    '<definedName name="列の名前">公園!$A:$A</definedName>',
    '<definedName name="式の名前">OFFSET(公園!$A$1,0,0,COUNTA(公園!$A:$A),1)</definedName>',
  ].join('');
  async function withNames() {
    const zip = await JSZip.loadAsync(await makeLedger());
    const xml = await zip.file('xl/workbook.xml').async('string');
    zip.file('xl/workbook.xml', xml.replace('</sheets>', `</sheets><definedNames>${NAMES}</definedNames>`));
    return zip.generateAsync({ type: 'uint8array' });
  }
  const namesOf = async (buf) => (await (await JSZip.loadAsync(buf)).file('xl/workbook.xml').async('string')).match(/<definedNames>[\s\S]*?<\/definedNames>/)[0];

  it('書き戻したファイルの名前付き範囲は、元のファイルと1文字も違わない', async () => {
    const buf = await withNames();
    const { rows } = await readLedger(buf, cfg);
    const { trees } = mergeLedger([], rows, cfg);
    const mine = trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry } : t));
    const r = await exportDb(buf, mine, cfg);
    expect(r.errors).toEqual([]);
    expect(await namesOf(r.buffer)).toBe(`<definedNames>${NAMES}</definedNames>`);
  });

  it('照合：名前付き範囲が崩れていれば知らせる', async () => {
    const buf = await withNames();
    const wb = await load(buf);
    const broken = await wb.xlsx.writeBuffer(); // ExcelJS でそのまま書き出すと崩れる
    expect((await verifyDb(broken, buf, [], cfg)).join('\n')).toMatch(/名前付き範囲/);
  });
});

describe('【再発防止】外部リンク（別のブックを指す名前付き範囲の参照先）を落とさない', () => {
  // ExcelJS は外部リンクの部品を書き出さず、「[1]シート!$A$1」の名前の参照先がなくなって Excel で「修復」になっていた
  const LINK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalBook r:id="rId1"><sheetNames><sheetName val="架空のシート"/></sheetNames></externalBook></externalLink>';
  const LINK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="/架空/別のブック.xlsm" TargetMode="External"/></Relationships>';
  async function withLink() {
    const zip = await JSZip.loadAsync(await makeLedger());
    zip.file('xl/externalLinks/externalLink1.xml', LINK);
    zip.file('xl/externalLinks/_rels/externalLink1.xml.rels', LINK_RELS);
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    zip.file('xl/_rels/workbook.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>'));
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/></Types>'));
    const wb = await zip.file('xl/workbook.xml').async('string');
    zip.file('xl/workbook.xml', wb.replace('</sheets>', '</sheets><externalReferences><externalReference r:id="rId99"/></externalReferences><definedNames><definedName name="外部の名前">[1]架空のシート!$T$7</definedName></definedNames>'));
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('書き戻したファイルに、外部リンクの部品・関連付け・ファイルの種類が元のとおりにある', async () => {
    const buf = await withLink();
    const { rows } = await readLedger(buf, cfg);
    const { trees } = mergeLedger([], rows, cfg);
    const r = await exportDb(buf, trees.map((t) => (t.treeNo === 'AB002' ? { ...t, ...entry } : t)), cfg);
    expect(r.errors).toEqual([]);
    const z = await JSZip.loadAsync(r.buffer);
    const wb = await z.file('xl/workbook.xml').async('string');
    // シートの一覧 → 外部リンク → 名前付き範囲 の並び（Excel の決まり）
    expect(wb).toMatch(/<\/sheets><externalReferences><externalReference r:id="(rIdExt1)"\/><\/externalReferences><definedNames>/);
    expect(await z.file('xl/externalLinks/externalLink1.xml').async('string')).toBe(LINK);
    expect(await z.file('xl/externalLinks/_rels/externalLink1.xml.rels').async('string')).toBe(LINK_RELS);
    expect(await z.file('xl/_rels/workbook.xml.rels').async('string')).toContain('Id="rIdExt1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"');
    expect(await z.file('[Content_Types].xml').async('string')).toContain('PartName="/xl/externalLinks/externalLink1.xml"');
  });

  it('照合：外部リンクがなくなっていれば知らせる', async () => {
    const buf = await withLink();
    const broken = await (await load(buf)).xlsx.writeBuffer(); // ExcelJS でそのまま書き出すと落ちる
    expect((await verifyDb(broken, buf, [], cfg)).join('\n')).toMatch(/外部リンク/);
  });
});
