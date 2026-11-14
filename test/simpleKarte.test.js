// 簡易診断のカルテ（設定 karte。1本1シート。提出用）を作るテスト（架空の様式・架空の木）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree } from '../src/core/tree.js';
import { putMeasure, setMeasureText } from '../src/core/noteMeasures.js';
import { excelDate, simpleKarteRecord } from '../src/core/simpleKarte.js';
import { exportKarte } from '../src/excel/karteExport.js';

import { BOX, LEAN, makeSimpleKarteTemplate as makeTemplate, simpleKarteConfig } from './helpers/makeSimpleKarte.js';

const cfg = simpleKarteConfig(cfgJson);

const tree = (no, o = {}) => blankTree({ id: `t${no}`, treeNo: String(no), siteType: 'park', species: 'テストノキ', done: true, measuresV: 2, measures: [], ...o });

describe('簡易診断のカルテ', () => {
  it('設定の確かめ：今の形は通り、知らない項目・form は断る', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (cells, form = 'simple') => validateConfig({ ...cfg, karte: { sheets: [{ ...cfg.karte.sheets[0], form, cells }] } }).ok;
    expect(bad([{ cell: 'C3', key: 'nowhere' }])).toBe(false);
    expect(bad([{ cell: 'C3', key: 'treeNo' }], 'initial')).toBe(false);
    expect(bad([{ cell: 'C3', key: '@check:decay', skipEmpty: 'yes' }])).toBe(false);
    expect(validateConfig({ ...cfg, karte: { ...cfg.karte, measureLine: '{place}だけ' } }).ok).toBe(false);
  });

  it('記録：幹周・枝長/枝径・日付の数、点検項目ごとの部位・寸法、特記事項（項目に付けていない寸法を足す）', () => {
    let t = tree(1, { date: '2099-05-06', girths: ['0.5', '0.3'], branchLen: '200', branchDia: '7', decay: '有', notes: '・自由な記録' });
    t = putMeasure(t, cfg, { kind: 'decay', place: '根株', values: { height: { a: '0', b: '0.2' }, size: [{ w: '20', h: '20' }] } }, -1);
    t = putMeasure(t, cfg, { kind: 'tap', place: '幹', values: { height: { a: '1' } } }, -1);
    const r = simpleKarteRecord(t, cfg);
    expect(r['@girth']).toBe(Math.round(0.8 * cfg.calc.multiStemFactor * 100) / 100);
    expect(r['@branchRatio']).toBe(28.57);
    expect(r['@dateSerial']).toBe(excelDate('2099-05-06'));
    expect(excelDate('1900-03-01')).toBe(61); // Excel の日付の数（1900/3/1 は 61）
    expect(r['@check:decay']).toBe('地上0～0.2m、20cm×20cm 根株');
    expect(r['@notes']).toBe('自由な記録　幹の打診音異常：地上1m');
  });

  it('寸法の文を手で直してあれば、点検項目の欄・特記事項にその文を書く', () => {
    let t = tree(3, { decay: '有' });
    t = putMeasure(t, cfg, { kind: 'decay', place: '根株', values: { size: [{ w: '10', h: '4' }] } }, -1);
    t = putMeasure(t, cfg, { kind: 'tap', place: '幹', values: { height: { a: '1' } } }, -1);
    expect(simpleKarteRecord(t, cfg)['@check:decay']).toBe('10cm×4cm 根株');
    t = setMeasureText(t, cfg, 0, '地際 10cm×4cm');
    t = setMeasureText(t, cfg, 1, '幹の下の方');
    const r = simpleKarteRecord(t, cfg);
    expect(r['@check:decay']).toBe('地際 10cm×4cm');
    expect(r['@notes']).toBe('打診音異常：幹の下の方'); // 項目に付けていない寸法は「種類：文」
  });

  it('書き出し：1本1シート（番号の数の順）、□を■に、印は入れず、照合を通る', async () => {
    let t1 = tree(10, { date: '2099-05-06', girths: ['1.2'], decay: '小', lean: '有', initialNeeded: cfgJson.initial.yes, notes: '短い' });
    t1 = putMeasure(t1, cfg, { kind: 'decay', place: '幹', values: { height: { a: '1' }, size: [{ w: '10', h: '30' }] } }, -1);
    const t2 = tree(2, { date: '2099-05-07', lean: '無', decay: '無', initialNeeded: cfgJson.initial.no });
    const r = await exportKarte(await makeTemplate(), [t1, t2].map((t) => simpleKarteRecord(t, cfg)), cfg, cfg.karte, { submit: true });
    expect(r.errors).toEqual([]);
    expect(r.stats.sheets.map((s) => s.name)).toEqual(['2', '10']);
    expect(r.stats.sheets).toHaveLength(2); // そのまま写すシートは本数に数えない
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['2', '10', '選択肢']); // 選択肢の一覧のシートは名前のまま最後に
    const a = wb.getWorksheet('10');
    expect(a.getCell('C3').value).toBe(10);
    expect(a.getCell('C2').value).toEqual(new Date(Date.UTC(2099, 4, 6))); // 日付の表示形式なので日付として読める
    expect(a.getCell('C7').value).toBe('□無　■有');
    expect(a.getCell('C8').value).toBe('□無  ■有');
    expect(a.getCell('E8').value).toBe('地上1m、10cm×30cm 幹');
    expect(a.getCell('C9').value).toBe('短い');
    expect(a.getCell('C10').value).toBe('■必要 □不要');
    const b = wb.getWorksheet('2');
    expect(b.getCell('C7').value).toBe('■無　□有');
    expect(b.getCell('C8').value).toBe('■無  □有');
    expect(b.getCell('C10').value).toBe('□必要 ■不要');
    // 提出用なので「確認用」の印（印刷のヘッダー）は入れない
    const xml = await (await JSZip.loadAsync(r.buffer)).file('xl/worksheets/sheet1.xml').async('string');
    expect(xml).not.toMatch(/確認用/);
  });

  it('長い文：文字を小さくしても収まらなければ、行の高さは変えずに知らせる', async () => {
    const long = 'とても長い記録の文。'.repeat(30);
    const t = tree(3, { notes: long });
    const r = await exportKarte(await makeTemplate(), [simpleKarteRecord(t, cfg)], cfg, cfg.karte, { submit: true });
    expect(r.errors).toEqual([]);
    expect(r.stats.tooLong).toEqual([{ sheet: '3', cell: 'C9' }]);
    expect(r.stats.grown).toEqual([]);
  });

  it('そのまま写すシートが様式にないときは作らずに知らせる', async () => {
    const c2 = { ...cfg, karte: { ...cfg.karte, keepSheets: ['^ないシート$'] } };
    const r = await exportKarte(await makeTemplate(), [simpleKarteRecord(tree(1), c2)], c2, c2.karte, { submit: true });
    expect(r.buffer).toBeNull();
    expect(r.errors.join()).toMatch(/そのまま写すシート/);
  });
});
