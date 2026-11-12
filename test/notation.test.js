// 書き方の設定：数の桁（fixed）・書かない部位（hidePlaces）・文の形（sentence）・空なら様式の文字を残す（keepIfEmpty）・伐採済み（felled）
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { partText } from '../src/core/detailParts.js';
import { measureLine, putMeasure } from '../src/core/noteMeasures.js';
import { blankTree } from '../src/core/tree.js';
import { missingFields } from '../src/core/rules.js';
import { simpleKarteRecord } from '../src/core/simpleKarte.js';
import { listRemarks } from '../src/excel/listSheet.js';
import { exportKarte } from '../src/excel/karteExport.js';
import ExcelJS from 'exceljs';
import { makeSimpleKarteTemplate, simpleKarteConfig } from './helpers/makeSimpleKarte.js';

// 見本の寸法の設定に、この形の書き方を足したもの
function notationCfg() {
  const cfg = simpleKarteConfig(cfgJson);
  const nm = cfg.noteMeasures;
  nm.join = ' ';
  nm.hidePlaces = ['幹'];
  nm.parts = {
    ...nm.parts,
    hx: { type: 'height', label: '高さ', prefix: 'H=', fixed: 1 },
    sx: { type: 'size', label: '大きさ' },
    dx: { type: 'number', label: '直径', prefix: 'ø=', unit: 'cm', fixed: 1 },
    lx: { type: 'number', label: '長さ', prefix: 'L=', unit: 'm', fixed: 1 },
    nx: { type: 'count', label: '本数' },
  };
  nm.kinds = [
    ...nm.kinds,
    { key: 'kx', label: '架空腐朽', parts: ['hx', 'sx'] },
    { key: 'top', label: '架空頂部', places: [], parts: ['hx', 'dx', 'lx'], sentence: '[{hx}で][{dx}、][{lx}にわたって]架空頂部が枯死している。' },
  ];
  cfg.karte.checkJoin = ' ';
  cfg.karte.notesJoin = '';
  return cfg;
}

describe('書き方の設定', () => {
  const cfg = notationCfg();

  it('fixed：決めた桁で出す（入れた値は変えない）', () => {
    expect(partText({ type: 'height', prefix: 'H=', fixed: 1 }, { a: '0', b: '2' })).toBe('H=0.0～2.0m');
    expect(partText({ type: 'number', prefix: 'ø=', unit: 'cm', fixed: 1 }, '7')).toBe('ø=7.0cm');
    expect(partText({ type: 'number', prefix: 'ø=', unit: 'cm', fixed: 1 }, '約7')).toBe('ø=約7cm'); // 数でなければそのまま
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = structuredClone(cfg);
    bad.noteMeasures.parts.hx.fixed = 5;
    expect(validateConfig(bad).ok).toBe(false);
  });

  it('hidePlaces：幹は書かず、ほかの部位は書く。区切りは半角スペース', () => {
    const line = (place) => measureLine({ ...cfg, noteMeasures: { ...cfg.noteMeasures, line: '{place}{kind}：{text}' } }, 'kx', place, { hx: { a: '1.7' }, sx: [{ w: '16', h: '5' }] });
    expect(line('幹')).toBe('架空腐朽：H=1.7m 16×5cm');
    expect(line('根株')).toBe('根株架空腐朽：H=1.7m 16×5cm');
  });

  it('sentence：入れた欄だけの文にする（[ ] の中が空なら省く）', () => {
    expect(measureLine(cfg, 'top', '', { hx: { a: '5' }, dx: '15', lx: '2' })).toBe('H=5.0mでø=15.0cm、L=2.0mにわたって架空頂部が枯死している。');
    expect(measureLine(cfg, 'top', '', { hx: { a: '5' } })).toBe('H=5.0mで架空頂部が枯死している。');
    expect(measureLine(cfg, 'top', '', {})).toBe('架空頂部が枯死している。');
    const bad = structuredClone(cfg);
    bad.noteMeasures.kinds.at(-1).sentence = '{nowhere}が枯死している。';
    expect(validateConfig(bad).ok).toBe(false);
  });

  it('カルテ：特記事項の文は続けて書く（notesJoin）', () => {
    let t = blankTree({ treeNo: '1', siteType: 'park', measuresV: 2, measures: [], notes: '架空の様子が見られる。' });
    t = putMeasure(t, cfg, { kind: 'top', place: '', values: { hx: { a: '5' } } }, -1);
    expect(simpleKarteRecord(t, cfg)['@notes']).toBe('架空の様子が見られる。H=5.0mで架空頂部が枯死している。');
  });

  it('keepIfEmpty：書く値が空なら様式の文字を残す', async () => {
    const c2 = structuredClone(cfg);
    c2.karte.sheets[0].cells = c2.karte.sheets[0].cells.map((c) => (c.cell === 'E8' ? { ...c, keepIfEmpty: true } : c));
    const wb0 = new ExcelJS.Workbook();
    await wb0.xlsx.load(await makeSimpleKarteTemplate());
    wb0.getWorksheet('架空カルテ様式').getCell('E8').value = 'H=　　m';
    const tpl = await wb0.xlsx.writeBuffer();
    expect(validateConfig(c2).errors).toEqual([]);
    const r = await exportKarte(tpl, [simpleKarteRecord(blankTree({ treeNo: '1', siteType: 'park', decay: '無' }), c2)], c2, c2.karte, { submit: true });
    expect(r.errors).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    expect(wb.getWorksheet('1').getCell('E8').value).toBe('H=　　m');
  });
});

describe('伐採済み（felled）', () => {
  const cfg = { ...notationCfg(), felled: { label: '伐採済み' } };
  const k0 = cfg.checks[0].key;

  it('番号と樹種のほかは未入力に数えない。カルテ・野帳の点検項目の詳細は書かない', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    expect(validateConfig({ ...cfg, felled: 'yes' }).ok).toBe(false);
    const t = blankTree({ treeNo: '1', species: 'テストノキ', siteType: 'park', felled: true, [k0]: '' });
    expect(missingFields(t, cfg)).toEqual([]);
    expect(missingFields({ ...t, felled: false }, cfg).length).toBeGreaterThan(3);
    expect(missingFields(t, { ...cfg, felled: undefined }).length).toBeGreaterThan(3); // 設定がなければ効かない
    expect(simpleKarteRecord(t, cfg)[`@check:${k0}`]).toBe('');
    expect(listRemarks({ ...t, notes: '架空の木は伐採済み。' }, cfg)).toBe('架空の木は伐採済み。');
  });
});
