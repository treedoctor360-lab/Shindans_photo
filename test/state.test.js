// 端末内の保存と、設定・台帳の読み込みのテスト
// IndexedDB は Node にないので、テスト用の代わり（fake-indexeddb）を使う
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { idbGet, idbPut, idbReset } from '../src/store/idb.js';
import { applyLedger, importLedger, initialState, loadAll, loadConfigText, migrate, readLedgerFile, saveState } from '../src/store/state.js';
import { blankTree } from '../src/core/tree.js';
import { makeLedger } from './helpers/makeLedger.js';

const cfg = structuredClone(cfgJson);

beforeEach(async () => {
  await idbReset();
  indexedDB.deleteDatabase('shindans_photo');
});

describe('端末内の保存', () => {
  it('保存した値を読み戻せる（ファイルの中身も）', async () => {
    await idbPut('x', { a: 1 });
    await idbPut('bin', new Uint8Array([1, 2, 3]).buffer);
    expect(await idbGet('x')).toEqual({ a: 1 });
    expect([...new Uint8Array(await idbGet('bin'))]).toEqual([1, 2, 3]);
    expect(await idbGet('none')).toBeUndefined();
  });

  it('初めて開いたときは空の状態、保存すれば次回はその状態', async () => {
    const first = (await loadAll()).state;
    expect(first.server.deviceId).toMatch(/^[a-z0-9]+$/); // 端末の印は初回に作る
    expect({ ...first, server: { ...first.server, deviceId: '' } }).toEqual(initialState());
    const s = { ...first, session: { date: '2099-04-05', inspector: '試験 一郎' }, trees: [blankTree({ id: 't1' })] };
    await saveState(s);
    await idbReset(); // アプリを開き直したのと同じ
    expect((await loadAll()).state).toEqual(s);
  });

  it('古い形・壊れた状態でも起動できる形に直す', () => {
    expect(migrate(null).trees).toEqual([]);
    expect(migrate({ trees: [1], session: { date: 'x' } })).toMatchObject({ trees: [1], session: { date: 'x', inspector: '' }, view: 'settings' });
  });
});

describe('設定ファイルの読み込み', () => {
  it('正しい設定は保存して使う', async () => {
    const r = await loadConfigText(JSON.stringify(cfg), null);
    expect(r.errors).toEqual([]);
    expect((await loadAll()).config).toEqual(cfg);
  });

  it('壊れた JSON・不正な設定は保存せず、前の設定のまま', async () => {
    const prev = await loadConfigText(JSON.stringify(cfg), null);
    const bad1 = await loadConfigText('{ こわれた', prev.config);
    expect(bad1.config).toBe(prev.config);
    expect(bad1.errors[0]).toMatch(/JSON/);
    const bad2 = await loadConfigText(JSON.stringify({ ...cfg, version: 99 }), prev.config);
    expect(bad2.config).toBe(prev.config);
    expect((await loadAll()).config.version).toBe(cfg.version);
  });
});

describe('台帳の読み込み', () => {
  it('木を取り込み、元のファイルも保存する（一覧表へ書き戻すときに使う）', async () => {
    const buf = await makeLedger();
    const r = await importLedger(initialState(), '架空の台帳.xlsx', buf, cfg, '2099-04-10');
    expect(r.stats.all).toBe(5);
    expect(r.state.trees.length).toBe(5);
    expect(r.state.ledgerInfo).toMatchObject({ name: '架空の台帳.xlsx', date: '2099-04-10' });
    // 一覧表形式の表示用に、シートの種類ごとの見出しの並びを残す
    expect(r.state.ledgerInfo.columns.park.slice(0, 4).map((c) => c.header)).toEqual(['連番', '公園コード', '公園名', '木の番号']);
    const saved = await idbGet('ledger');
    expect(saved.name).toBe('架空の台帳.xlsx');
    expect(saved.buffer.byteLength).toBe(buf.byteLength);
  });

  it('台帳でないファイルなら知らせる', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('関係ない').addRow(['a', 'b']);
    await expect(importLedger(initialState(), 'x.xlsx', await wb.xlsx.writeBuffer(), cfg, '2099-04-10')).rejects.toThrow(/樹木番号の列/);
  });
});

describe('木の印（id）の修復', () => {
  it('印がない木・同じ印の木に新しい印を付ける。正しい木はそのまま', async () => {
    const { repairIds, migrate: mig } = await import('../src/store/state.js');
    const a = { id: 'a', treeNo: 'A1' };
    const r = repairIds([a, { treeNo: 'B1' }, { id: 'a', treeNo: 'C1' }, { id: '', treeNo: '' }, { id: null }]);
    expect(r[0]).toBe(a);
    const ids = r.map((t) => t.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((x) => typeof x === 'string' && x)).toBe(true);
    expect(r[2]).toMatchObject({ treeNo: 'C1' });
    expect(mig({ trees: [{ treeNo: 'X' }] }).trees[0].id).toBeTruthy();
    // 開いていた木の印が直ったときは、一覧から始める（別の木を開かない）
    expect(mig({ trees: [{ treeNo: 'X' }], currentId: 'gone', view: 'form' })).toMatchObject({ currentId: '', view: 'list' });
    expect(mig({ trees: [{ id: 'k', treeNo: 'X' }], currentId: 'k', view: 'form' })).toMatchObject({ currentId: 'k', view: 'form' });
  });
});

describe('台帳を読んでいる間に届いた変更を消さない', () => {
  it('読むのと状態に入れるのを分け、入れるときはその時点の最新の状態に入れる', async () => {
    const buf = await makeLedger();
    const before = importLedger(initialState(), '架空の台帳.xlsx', buf, cfg, '2099-04-10');
    const start = (await before).state;
    // 読んでいる間に、送受信で AB002 の入力が届いた
    const parsed = await readLedgerFile('架空の台帳.xlsx', buf, cfg, '2099-04-11');
    const latest = { ...start, trees: start.trees.map((t) => (t.treeNo === 'ＡＢ００２' || t.treeNo === 'AB002' ? { ...t, source: 'app', done: true, vigor: '並', rev: 3, sent: true } : t)) };
    const r = applyLedger(latest, parsed, cfg);
    const ab002 = r.state.trees.find((t) => t.treeNo === 'ＡＢ００２' || t.treeNo === 'AB002');
    expect(ab002).toMatchObject({ source: 'app', done: true, vigor: '並', rev: 3 });
    expect(r.state.ledgerInfo).toMatchObject({ name: '架空の台帳.xlsx', date: '2099-04-11' });
  });
});
