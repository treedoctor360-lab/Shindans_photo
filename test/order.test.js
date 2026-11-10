// 追加した木の並び（どの木の次か）と、現地の番号に変える
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { groupKey } from '../src/core/groups.js';
import { blankTree } from '../src/core/tree.js';
import { mergeLedger, readLedger } from '../src/excel/ledger.js';
import { addTree, numberNoteLines, renumberToAdded, saveTree, setAddedPlace } from '../src/store/actions.js';
import { initialOf, startInitial } from '../src/store/initial.js';
import { placeAdded } from '../src/store/order.js';
import { initialState } from '../src/store/state.js';
import { simpleKey } from '../src/store/surveys.js';
import { applyPull } from '../src/store/sync.js';
import { makeLedger } from './helpers/makeLedger.js';

const cfg = structuredClone(cfgJson);
const P = (id, o = {}) => blankTree({ id, treeNo: id, species: 'テストノキ', siteType: 'park', parkCode: 'K01', parkName: '架空公園', ledgerRow: { sheet: '公園', row: 1 }, ...o });
const nos = (s) => s.trees.map((t) => t.treeNo || t.uid);
const state = (trees, o = {}) => ({ ...initialState(), trees, group: groupKey(trees[0], cfg), currentId: trees[0].id, session: { date: '2099-05-06', inspector: '試験 二郎' }, server: { deviceId: 'd1' }, ...o });

describe('追加した木の並び', () => {
  it('この木の次に追加すると、その木のすぐ後ろ。同じ木の次に続けて追加すれば追加した順、追加した木の次はその後ろ', () => {
    let s = state([P('A1'), P('A2'), P('A3')]);
    s = addTree(s, cfg, { afterId: 'A1', now: 1 });
    s = { ...s, trees: s.trees.map((t) => (t.id === s.currentId ? { ...t, treeNo: 'N1' } : t)) };
    s = addTree(s, cfg, { afterId: 'A1', now: 2 });
    s = { ...s, trees: s.trees.map((t) => (t.id === s.currentId ? { ...t, treeNo: 'N2' } : t)) };
    expect(nos(s)).toEqual(['A1', 'N1', 'N2', 'A2', 'A3']);
    expect(s.trees[1]).toMatchObject({ after: simpleKey(s.trees[0], cfg), parkName: '架空公園' });
    // 保存してもう1本追加：今の木（N2）の次
    s = { ...s, currentId: s.trees[2].id };
    s = saveTree(s, cfg, { force: true, after: 'add', now: new Date(3).toISOString() }).state;
    expect(nos(s)).toEqual(['A1', 'N1', 'N2', 'd1-4', 'A2', 'A3']);
  });

  it('並べ直しても位置を保つ（一覧表を読み込み直したとき・受け取ったとき）。次の木がなければまとまりの最後', () => {
    const a = P('A1');
    const n = blankTree({ id: 'new:1', uid: 'u1', treeNo: 'N1', siteType: 'park', parkName: '架空公園', after: simpleKey(a, cfg) });
    expect(nos({ trees: placeAdded([a, P('A2'), n], cfg) })).toEqual(['A1', 'N1', 'A2']);
    const lost = { ...n, after: 'どこにもない' };
    expect(nos({ trees: placeAdded([lost, a, P('A2'), P('B1', { parkName: '別公園' })], cfg) })).toEqual(['A1', 'A2', 'N1', 'B1']);
    // 一覧表の行に結び付いた木は、一覧表の並びに従う
    const boundN = { ...n, ledgerRow: { sheet: '公園', row: 9 } };
    expect(nos({ trees: placeAdded([a, P('A2'), boundN], cfg) })).toEqual(['A1', 'A2', 'N1']);
  });

  it('並びを選び直す（入力済みなら送り直す）', () => {
    let s = state([P('A1'), P('A2'), blankTree({ id: 'new:1', uid: 'u1', treeNo: 'N1', siteType: 'park', parkName: '架空公園', done: true, sent: true })]);
    s = setAddedPlace(s, cfg, 'new:1', 'A1', 5);
    expect(nos(s)).toEqual(['A1', 'N1', 'A2']);
    expect(s.trees[1]).toMatchObject({ sent: false, after: simpleKey(s.trees[0], cfg) });
    s = setAddedPlace(s, cfg, 'new:1', '', 6);
    expect(nos(s)).toEqual(['A1', 'A2', 'N1']);
  });

  it('受け取った追加の木も、次の木の後ろに入れる', () => {
    const s = state([P('A1'), P('A2')]);
    const data = { ...blankTree({ uid: 'u9', treeNo: 'N9', siteType: 'park', parkName: '架空公園', done: true, source: 'app' }), after: simpleKey(s.trees[0], cfg) };
    const r = applyPull(s, [{ kind: 'tree', treeId: simpleKey(data, cfg), rev: 1, data }], 1, cfg);
    expect(nos(r.state)).toEqual(['A1', 'N9', 'A2']);
  });
});

describe('現地の番号に変える', () => {
  it('入力を現地の番号の追加した木に移し、元の行は空に戻す。詳しい診断・付箋も移り、確定は外れる', () => {
    const base = P('A2', { treeNo: 'AB002', done: true, source: 'app', rev: 3, sent: true, height: '9', initialNeeded: '要', notes: '・枯れ枝あり\n・AB915に変更', ledgerSpecies: 'テストノキ', order: 2 });
    let s = state([P('A1', { treeNo: 'AB001' }), base, P('A3', { treeNo: 'AB003' })]);
    s = startInitial(s, base, cfg).state;
    const oldKey = simpleKey(base, cfg);
    s = {
      ...s,
      initials: s.initials.map((r) => ({ ...r, done: true, rev: 2, sent: true })),
      stickies: { st1: { id: 'st1', treeId: oldKey, text: '質問' }, st2: { id: 'st2', treeId: `initial|${oldKey}`, text: '質問2' } },
      confirms: { [oldKey]: { treeId: oldKey, value: true } },
    };
    expect(numberNoteLines(base, 'AB0915')).toEqual(['・AB915に変更']);
    expect(() => renumberToAdded(s, cfg, 'A2', 'AB002')).toThrow('今の番号と同じ');
    const r = renumberToAdded(s, cfg, 'A2', 'ab0915', { dropLines: ['・AB915に変更'], now: 100 });
    // 並びは同じ位置（元の行の次）
    expect(nos(r)).toEqual(['AB001', 'AB002', 'AB0915', 'AB003']);
    const nt = r.trees[2];
    expect(nt).toMatchObject({ id: 'new:100', uid: 'd1-2s', treeNo: 'AB0915', dupIndex: 1, height: '9', done: true, sent: false, notes: '・枯れ枝あり', renamedFrom: { treeNo: 'AB002', dupIndex: 1 } });
    expect(nt.ledgerRow).toBeUndefined();
    expect(r.currentId).toBe('new:100');
    // 元の行は空（サーバーに届いていたので、空に戻ったことを送る）
    expect(r.trees[1]).toMatchObject({ id: 'A2', treeNo: 'AB002', done: false, height: '', species: 'テストノキ', rev: 3, sent: false, renamedTo: 'd1-2s', ledgerRow: { sheet: '公園', row: 1 } });
    // 詳しい診断は新しい木へ。元の記録は未入力に戻ったことを送る
    expect(initialOf(r, nt, cfg)).toMatchObject({ treeNo: 'AB0915', uid: 'd1-2s', done: true, sent: false });
    expect(r.initials.find((x) => x.renamedTo)).toMatchObject({ done: false, sent: false, rev: 2 });
    const newKey = simpleKey(nt, cfg);
    expect(r.stickies.st1).toMatchObject({ treeId: newKey, dirty: true });
    expect(r.stickies.st2).toMatchObject({ treeId: `initial|${newKey}`, dirty: true });
    expect(r.confirms[oldKey]).toMatchObject({ value: false, dirty: true });
  });

  it('内勤さんが一覧表の番号を直して読み込むと、その行に結び付き、空に戻した元の行の木は外れる', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    let trees = mergeLedger([], rows, cfg).trees;
    const ab2 = trees.find((t) => t.treeNo === 'AB002');
    trees = trees.map((t) => (t === ab2 ? { ...t, done: true, height: '7', vigor: '良' } : t));
    let s = state(trees, { currentId: ab2.id });
    s = renumberToAdded(s, cfg, ab2.id, 'AB0915', { now: 200 });
    // 直す前の一覧表を読み込み直しても、そのまま（元の行は空・新しい木はその次）
    const again = mergeLedger(s.trees, rows, cfg).trees;
    const i = again.findIndex((t) => t.treeNo === 'AB002');
    expect(placeAdded(again, cfg)[i + 1]).toMatchObject({ treeNo: 'AB0915', height: '7' });
    // 内勤さんが番号を直した一覧表
    const fixed = rows.map((r) => (String(r.values.treeNo).normalize('NFKC') === 'AB002' ? { ...r, values: { ...r.values, treeNo: 'AB0915' } } : r));
    const { trees: after, stats } = mergeLedger(s.trees, fixed, cfg);
    expect(stats.addedBound).toEqual(['AB0915']);
    const bound = after.find((t) => t.treeNo === 'AB0915');
    expect(bound).toMatchObject({ uid: 'd1-5k', height: '7', done: true });
    expect(bound.ledgerRow).toBeTruthy();
    expect(after.some((t) => t.treeNo === 'AB002')).toBe(false);
  });

  it('追加した木・台帳で入力済みの木は使えない', () => {
    const s = state([P('A1', { treeNo: 'AB001', source: 'ledger', done: true }), blankTree({ id: 'n', uid: 'u', treeNo: 'X1', siteType: 'park' })]);
    expect(() => renumberToAdded(s, cfg, 'A1', 'AB009')).toThrow('台帳で入力済み');
    expect(() => renumberToAdded(s, cfg, 'n', 'AB009')).toThrow('追加した木');
  });
});

describe('内勤さんに渡す Excel', () => {
  it('差し込む行の一覧：追加した木は前の行の次、番号を直した木は元の行の番号を直す', async () => {
    const { insertRows } = await import('../src/excel/entryList.js');
    let s = state([P('A1', { treeNo: 'AB001' }), P('A2', { treeNo: 'AB002', done: true, source: 'app', height: '5' }), P('A3', { treeNo: 'AB003' })]);
    s = addTree(s, cfg, { afterId: 'A1', now: 1 });
    s = { ...s, trees: s.trees.map((t) => (t.id === s.currentId ? { ...t, treeNo: 'AB0900', species: 'アラカシ', done: true } : t)) };
    s = renumberToAdded(s, cfg, 'A2', 'AB0915', { now: 2 });
    const rows = insertRows(s, cfg, [groupKey(s.trees[0], cfg)]);
    expect(rows.map((r) => [r.kind, r.treeNo, r.prev, r.from])).toEqual([
      ['行を差し込む', 'AB0900', 'AB001', ''],
      ['番号を直す', 'AB0915', '', 'AB002'],
    ]);
  });

  it('入力内容の一覧：選んだ公園だけ。簡易は一覧表と同じ列＋状態・特記全文、詳しい診断はブックの列', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const { buildEntryList } = await import('../src/excel/entryList.js');
    const a = P('A1', { treeNo: 'AB001', done: true, source: 'app', height: '8', girths: ['0.5'], initialNeeded: '要', notes: '・枝の偏り' });
    let s = state([a, P('A2', { treeNo: 'AB002' }), P('B1', { treeNo: 'AB100', parkName: '別公園', done: true, source: 'app' })]);
    s = startInitial(s, a, cfg).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true, b4: '有（大）' })) };
    const r = await buildEntryList(s, cfg, [groupKey(a, cfg)]);
    expect(r.count).toEqual({ trees: 2, initials: 1 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['簡易', '詳しい診断', '環境']);
    const ws = wb.getWorksheet('簡易');
    expect(ws.getCell('A1').value).toBe('確認用（提出不可）');
    const heads = ws.getRow(2).values.slice(1);
    expect(heads[0]).toBe('状態');
    expect(heads.at(-1)).toBe('特記事項（全文）');
    const nos = [3, 4, 5].map((i) => ws.getRow(i).getCell(heads.indexOf('樹木番号') + 1).value);
    expect(nos).toEqual(['AB001', 'AB002', null]); // 別公園は出ない
    expect(ws.getRow(3).getCell(heads.length).value).toBe('・枝の偏り');
    const ini = wb.getWorksheet('詳しい診断');
    const ih = ini.getRow(2).values.slice(1);
    expect(ih[0]).toBe('状態');
    expect(ih.find((h) => /^F /.test(h))).toBe('F 基本情報/樹木番号');
    expect(ini.getRow(3).getCell(ih.findIndex((h) => /^I /.test(h)) + 1).value).toBe('有（大）');
  });
});

describe('【再現】同じ番号の行が、別の場所の行として上に入った一覧表を読み込む', () => {
  it('入力のある木は別の場所の行に当たらず、場所の合う行に結び付く（詳しい診断の記録・付箋も一緒）。書き込みもその行', async () => {
    const { applyLedger } = await import('../src/store/state.js');
    const { exportDb } = await import('../src/excel/dbExport.js');
    const ExcelJS = (await import('exceljs')).default;
    const buf = await makeLedger();
    const parsed = await readLedger(buf, cfg);
    const nk = (v) => String(v ?? '').normalize('NFKC');
    let trees = mergeLedger([], parsed.rows, cfg).trees;
    const mine = trees.find((t) => nk(t.treeNo) === 'AB002');
    const filled = { ...mine, done: true, source: 'app', rev: 2, sent: true, height: '7', girths: ['0.4'], vigor: '良', initialNeeded: '要', date: '2099-05-06', inspector: '試験 二郎' };
    let s = state(trees.map((t) => (t === mine ? filled : t)));
    s = startInitial(s, filled, cfg).state;
    const oldKey = simpleKey(filled, cfg);
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true, rev: 1, sent: true })), stickies: { st1: { id: 'st1', treeId: oldKey, text: '質問' } } };
    // 内勤さんが、同じ番号 AB002 の行（別の公園・別の樹種・入力済み）をいちばん上に入れた
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('公園');
    const first = 3; // 見出し・凡例の次
    ws.insertRow(first, [9, 'K09', '別の架空公園', 'AB002', 'ベツノキ', new Date(Date.UTC(2099, 3, 7)), '試験 三郎', 5, 0.3, '', '', '並']);
    const map = { height: 8 }; // H 列
    const buf2 = await wb.xlsx.writeBuffer();
    const parsed2 = await readLedger(buf2, cfg);
    expect(parsed2.rows.filter((r) => nk(r.values.treeNo) === 'AB002').map((r) => r.values.parkName)).toEqual(['別の架空公園', '架空公園']);

    const r = applyLedger(s, { ...parsed2, info: {} }, cfg);
    expect(r.stats.rebound).toEqual(['AB002（架空公園）']);
    expect(r.stats.placeMoved).toEqual([]);
    const ab = r.state.trees.filter((t) => nk(t.treeNo) === 'AB002');
    const other = ab.find((t) => t.parkName === '別の架空公園');
    const kept = ab.find((t) => t.parkName === '架空公園');
    expect(ab).toHaveLength(2);
    expect(other).toMatchObject({ source: 'ledger', species: 'ベツノキ', dupIndex: 1 }); // 別の公園の行は台帳の内容
    expect(other.height).not.toBe('7');
    expect(kept).toMatchObject({ source: 'app', done: true, height: '7', vigor: '良', dupIndex: 1, rowDup: 2, uid: expect.stringMatching(/^mv-/) });
    expect(kept.ledgerRow).toBeTruthy();
    expect(initialOf(r.state, kept, cfg)).toMatchObject({ done: true, treeNo: 'AB002' });
    // 元の鍵の記録は、中身のない未入力の記録として残る（サーバーに未入力に戻ったことを送る）
    const left = initialOf(r.state, other, cfg);
    expect(left).toMatchObject({ done: false, sent: false });
    expect(left.species).toBeUndefined();
    expect(r.state.stickies.st1.treeId).toBe(simpleKey(kept, cfg));
    // もう一度読み込んでも変わらない
    const again = applyLedger(r.state, { ...parsed2, info: {} }, cfg);
    expect(again.stats.rebound).toEqual([]);
    expect(again.state.trees.find((t) => t.id === kept.id)).toMatchObject({ height: '7', rowDup: 2 });
    // 一覧表への書き込みは、場所の合う行（2本目）へ
    const out = await exportDb(buf2, again.state.trees, cfg);
    expect(out.errors).toEqual([]);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(out.buffer);
    const ws2 = wb2.getWorksheet(ws.name);
    expect(String(ws2.getRow(kept.ledgerRow.row).getCell(map.height).value)).toBe('7');
    expect(String(ws2.getRow(first).getCell(map.height).value)).not.toBe('7');
  });
});
