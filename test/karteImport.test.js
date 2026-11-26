// 記入済みカルテ（1本1シート）の読み込みのテスト（架空の様式・架空の木。写真の中身は適当なバイト列）
//  アプリで書き出したカルテを読み戻して、同じカルテに書き出せることを確かめる（往復）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { photoCaptionKey, simpleKarteRecord } from '../src/core/simpleKarte.js';
import { karteValue } from '../src/core/karteCells.js';
import { exportKarte } from '../src/excel/karteExport.js';
import { addKartePhotos } from '../src/excel/kartePhotos.js';
import { openXlsx, rangeOf } from '../src/excel/xlsxRead.js';
import { isKarteSheet, readKarteCells, karteGroupChoices, karteImageSlots, karteDate, simpleKarteSheetSpec } from '../src/core/karteImport.js';
import { importKarte, currentGroupTrees } from '../src/store/actions.js';
import { initialState } from '../src/store/state.js';
import { groupKey } from '../src/core/groups.js';
import { entryIssues, isEntryStuck } from '../src/core/entrySheet.js';
import { makeSimpleKarteTemplate as makeTemplate, simpleKarteConfig } from './helpers/makeSimpleKarte.js';

const base = simpleKarteConfig(cfgJson);
const slots = [
  { key: 'full', label: '全景', range: 'G2:H8', full: true },
  { key: 'p1', label: '写真1', range: 'A12:B14', caption: 1 },
];
const cfg = {
  ...base,
  karte: {
    ...base.karte,
    unconfirmedOk: true,
    photos: { slots, pad: 2, charPx: 8 },
    sheets: [{ ...base.karte.sheets[0], siteType: 'street', cells: [...base.karte.sheets[0].cells, { cell: 'A11', key: '@photoCaption1' }, { cell: 'D3', key: 'routeNo' }] }],
  },
  addGroups: {
    siteType: 'street',
    label: '路線',
    fields: [{ key: 'routeName', label: '路線名' }, { key: 'routeNo', label: '路線番号' }],
    presets: [
      { label: '試験通り１(テ1)　テストノキ', values: { routeName: '試験通り１(テ1)', routeNo: 'テ1' }, tree: { species: 'テストノキ' } },
      { label: '試験通り１(テ1)　ためしノキ', values: { routeName: '試験通り１(テ1)別', routeNo: 'テ1' }, tree: { species: 'ためしノキ' } },
    ],
  },
};
const info = { siteType: 'street', routeName: '試験通り１(テ1)', routeNo: 'テ1' };
const tree = (no, o = {}) => blankTree({ id: `t${no}`, treeNo: String(no), ...info, species: 'テストノキ', done: true, date: '2099-11-10', measuresV: 2, measures: [], ...o });
const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251);

// 架空の木を、アプリでカルテに書き出す（2番に写真2枚）
async function makeFilled() {
  const t1 = tree(1, {
    girths: ['1.2'],
    branchLen: '300',
    branchDia: '6',
    lean: '無',
    decay: '有',
    measures: [{ kind: 'decay', place: '幹', values: { height: { a: '1.2', b: '' }, size: [{ w: '10', h: '15' }] } }],
    fungus: '有',
    fungusName: 'テストタケ',
    notes: '根が幹を締め付けている。\n枝の偏りが見られる。',
    initialNeeded: cfgJson.initial.yes,
  });
  const t2 = tree(2, { girths: ['0.8'], lean: '有', decay: '無', initialNeeded: cfgJson.initial.no });
  const recs = [t1, t2].map((t) => simpleKarteRecord(t, cfg));
  recs[1][photoCaptionKey(1)] = '試験の見出し';
  const r = await exportKarte(await makeTemplate(), recs, cfg, cfg.karte, { submit: true });
  expect(r.errors).toEqual([]);
  const p = await addKartePhotos(r.buffer, [{ sheet: '2', pics: [{ slot: 'full', data: bytes(900, 1), w: 300, h: 400 }, { slot: 'p1', data: bytes(700, 2), w: 400, h: 300 }] }], cfg.karte.photos);
  expect(p.errors).toEqual([]);
  return { buffer: p.buffer, trees: [t1, t2], recs };
}

async function readAll(buffer) {
  const book = await openXlsx(buffer);
  const out = [];
  for (const s of book.sheets) {
    const { cells, images } = await book.readSheet(s);
    out.push({ name: s.name, cells, images, karte: isKarteSheet(cells, cfg) });
  }
  return { book, sheets: out };
}

describe('記入済みカルテの読み込み', () => {
  it('Excel を軽く読む：シートの名前・セルの値・写真の位置と中身', async () => {
    const { buffer } = await makeFilled();
    const { book, sheets } = await readAll(buffer);
    expect(sheets.map((s) => s.name)).toEqual(['1', '2', '選択肢']);
    expect(sheets.map((s) => s.karte)).toEqual([true, true, false]); // 様式の確かめる文字が合うシートだけ
    expect(sheets[0].cells.C3).toBe(1);
    expect(sheets[0].cells.C4).toBe('テストノキ');
    expect(sheets[0].images).toEqual([]);
    expect(sheets[1].images).toHaveLength(2);
    const [a, b] = sheets[1].images;
    expect(a.from.col).toBeGreaterThanOrEqual(7); // G 列から
    expect([...(await book.media(a.path))]).toEqual([...bytes(900, 1)]);
    expect([...(await book.media(b.path))]).toEqual([...bytes(700, 2)]);
    // 写真を枠に当てる：真ん中が入っている枠
    const ss = slots.map((s) => ({ ...s, r: rangeOf(s.range) }));
    expect(karteImageSlots(sheets[1].images, ss).map((x) => x.slot)).toEqual(['full', 'p1']);
  });

  it('読み戻した木は、同じカルテに書き出せる（往復。寸法の文・特記事項・□■・数・日付）', async () => {
    const { buffer, recs } = await makeFilled();
    const { sheets } = await readAll(buffer);
    const spec = simpleKarteSheetSpec(cfg);
    for (const [i, s] of sheets.filter((x) => x.karte).entries()) {
      const r = readKarteCells(s.cells, cfg);
      expect(r.bad).toEqual({});
      const t = blankTree({ ...info, ...r.fields, treeNo: r.treeNo, karteKeep: r.keep });
      const back = simpleKarteRecord(t, cfg);
      for (const c of spec.cells) {
        if (/^@photoCaption/.test(c.key)) continue; // 写真の見出しは写真と一緒に（下のテスト）
        expect(karteValue(c, back), `${s.name} ${c.cell}`).toEqual(karteValue(c, recs[i]));
      }
    }
    const r1 = readKarteCells(sheets[0].cells, cfg);
    expect(r1.fields).toMatchObject({ date: '2099-11-10', girths: ['1.2'], lean: '無', decay: '有', notes: '・根が幹を締め付けている。\n・枝の偏りが見られる。\n・テストタケ' }); // 特記事項の欄の文（1文ずつ）
    expect(r1.keep).toEqual({ '@branchRatio': 50 }); // 枝長/枝径は倍率しかないので、そのまま残して書き戻す
    expect(r1.fields.measures).toEqual([{ kind: 'decay', place: '', values: {}, text: recs[0]['@check:decay'], textAuto: '' }]);
    expect(readKarteCells(sheets[1].cells, cfg).captions).toEqual({ 1: '試験の見出し' });
    // 寸法の行がない木も、寸法の一覧は空の一覧で持つ（新しい形の印 measuresV: 2 と組で。一覧などが読めるように）
    expect(readKarteCells(sheets[1].cells, cfg).fields).toMatchObject({ measuresV: 2, measures: [] });
  });

  it('□■の付き方が選択肢に合わないときは、読めなかった値として残し、入力中にする', async () => {
    const { buffer } = await makeFilled();
    const { sheets } = await readAll(buffer);
    const cells = { ...sheets[1].cells, C7: '■無　■有' };
    const r = readKarteCells(cells, cfg);
    expect(r.bad).toEqual({ lean: '■無　■有' });
    const res = importKarte(initialState(), cfg, [{ sheet: '2', ...r }], info, { file: 'カルテ.xlsx', now: 1000 });
    const t = res.state.trees[0];
    expect(t.done).toBe(false);
    expect(isEntryStuck(t)).toBe(true);
    expect(entryIssues(t, cfg).map((x) => x.text)).toEqual(['傾斜「■無　■有」は選択肢にありません']);
    expect(res.stats.check).toEqual([{ sheet: '2', treeNo: '2', why: ['傾斜「■無　■有」を読めません'] }]);
  });

  it('木にする：入力済み・番号の順・すでにある番号は読み込まない。路線は路線番号と樹種で候補を選ぶ', async () => {
    const { buffer } = await makeFilled();
    const { sheets } = await readAll(buffer);
    const read = sheets.filter((s) => s.karte).map((s) => ({ sheet: s.name, ...readKarteCells(s.cells, cfg) }));
    const g = karteGroupChoices(initialState(), cfg, read);
    expect(g.choices.map((c) => c.label)).toEqual(['試験通り１(テ1)　テストノキ', '試験通り１(テ1)　ためしノキ']);
    expect(g.pick).toBe(g.choices[0].key); // 樹種が合う方
    // 2番だけ先にある路線へ読み込む → 1番は2番の前に入る（路線名の数字は入力表の読み込みと同じく半角にそろう）
    let st = { ...initialState(), trees: [tree(2, { id: 'x2', uid: 'u2', ...g.choices[0].info })] };
    const res = importKarte(st, cfg, read, g.choices[0].info, { file: 'カルテ.xlsx', now: 1000 });
    expect(res.stats.added.map((a) => a.treeNo)).toEqual(['1']);
    expect(res.stats.skipped).toEqual(['2']);
    st = { ...res.state, group: g.choices[0].key };
    expect(currentGroupTrees(st, cfg).map((t) => t.treeNo)).toEqual(['1', '2']);
    const t1 = st.trees.find((t) => t.treeNo === '1');
    expect(t1).toMatchObject({ done: true, sent: false, fromKarte: 'カルテ.xlsx 1', date: '2099-11-10', species: 'テストノキ', routeNo: 'テ1' });
    expect(isEntryStuck(t1)).toBe(false);
  });

  it('様式に印字された文字のままの欄（「H=　　m」「　　cm/　　cm」）は、書いていない欄として読む', async () => {
    const { buffer } = await makeFilled();
    const { sheets } = await readAll(buffer);
    const r = readKarteCells({ ...sheets[1].cells, E8: 'H=　　m' }, cfg);
    expect(r.fields.measures).toEqual([]);
    expect(readKarteCells({ ...sheets[1].cells, E8: '　　cm/　　cm' }, cfg).fields.measures).toEqual([]);
    // 様式のままのシートがあれば、その文字と同じものも書いていない欄
    expect(readKarteCells({ ...sheets[1].cells, E8: '部位：' }, cfg, { E8: '部位：' }).fields.measures).toEqual([]);
    expect(readKarteCells({ ...sheets[1].cells, E8: 'H=1.0m' }, cfg).fields.measures).toHaveLength(1);
  });

  it('日付：Excel の日付の数・文字の日付', () => {
    expect(karteDate(46336)).toBe('2026-11-10');
    expect(karteDate('2026/11/10')).toBe('2026-11-10');
    expect(karteDate('令和8年')).toBe('');
  });

  it('大きなブックでも写真の中身は要るときだけ読む（シートを読んでも写真は取り出さない）', async () => {
    const { buffer } = await makeFilled();
    const book = await openXlsx(buffer);
    const s = await book.readSheet(book.sheets[1]);
    expect(Object.keys(s.images[0])).toEqual(['path', 'ext', 'from', 'to']);
  });

  it('様式のままのシート（樹木番号が空）は木にしない', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await makeTemplate());
    const { sheets } = await readAll(await wb.xlsx.writeBuffer());
    const k = sheets.find((s) => s.karte);
    expect(readKarteCells(k.cells, cfg).treeNo).toBe('');
    const res = importKarte(initialState(), cfg, [{ sheet: k.name, ...readKarteCells(k.cells, cfg) }], info);
    expect(res.stats.added).toEqual([]);
  });
});
