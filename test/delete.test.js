// 木の削除・入力の取り消しと、追加した木の鍵のテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { groupKey } from '../src/core/groups.js';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import { addTree, deleteTree, isAddedTree, restoreTree, updateTree, withdrawTree } from '../src/store/actions.js';
import { reviewState, setConfirm, treeKey, treesForDb } from '../src/store/review.js';
import { applyPull, applyPush, pull, push, unsentCount } from '../src/store/sync.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1', lastSeq: 0 };
// 台帳から読み込んだ木（ledgerRow がある）
const L = (no, o = {}) =>
  blankTree({ id: `ledger:${no}`, treeNo: no, siteType: 'park', parkCode: 'K01', parkName: '架空公園', ledgerRow: { sheet: 's', row: 3 }, ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, group: groupKey(trees[0], cfg), server: { ...server }, ...o });

async function sync(state, g) {
  const r = await push(state, cfg, g.fetchFn);
  const a = applyPush(state, r.results, r.tokens, cfg);
  const p = await pull(a.state, cfg, g.fetchFn);
  const b = applyPull(a.state, p.records, p.lastSeq, cfg);
  return { state: b.state, conflicts: [...a.conflicts, ...b.conflicts], changedTrees: b.changedTrees };
}

// 一覧にない木を追加して、入力済みにする
function addDone(s, now, fields = {}) {
  const added = addTree(s, cfg, { now });
  return updateTree(added, added.currentId, (t) => ({ ...t, species: 'テストノキ', done: true, updatedAt: `u${now}`, ...fields }));
}

describe('追加した木の鍵', () => {
  it('【再発防止】番号なしの木を2本追加しても、サーバーで1本目とぶつからない', async () => {
    const g = makeFakeGas();
    let s = S([L('A1')]);
    s = addDone(s, 1, { status: 'テープなし', height: '1' });
    s = addDone(s, 2, { status: 'テープなし', height: '2' });
    const added = s.trees.filter(isAddedTree);
    expect(added).toHaveLength(2);
    expect(treeKey(added[0], cfg)).not.toBe(treeKey(added[1], cfg));
    const r = await sync(s, g);
    expect(r.conflicts).toEqual([]);
    expect(r.state.trees.filter(isAddedTree).map((t) => [t.height, t.rev, t.sent])).toEqual([
      ['1', 1, true],
      ['2', 1, true],
    ]);
  });

  it('送信の後で番号を書き換えても、同じ木として送り直す（サーバーに古い番号の記録が残らない）', async () => {
    const g = makeFakeGas();
    let s = (await sync(addDone(S([L('A1')]), 1, { treeNo: 'ZZ001' }), g)).state;
    const id = s.trees.find(isAddedTree).id;
    s = updateTree(s, id, (t) => ({ ...t, treeNo: 'ZZ002', sent: false, updatedAt: 'u9' }));
    const r = await sync(s, g);
    expect(r.conflicts).toEqual([]);
    expect(g.sheets.get('records').cells.length - 1).toBe(1); // 記録は1件のまま
  });

  it('台帳の木の鍵は今までどおり（番号で見分ける）', () => {
    expect(treeKey(L('A1'), cfg)).toBe('2099|park|A1|1');
  });
});

describe('追加した木の削除', () => {
  it('サーバーに届いていない木は、端末から消す', () => {
    let s = addDone(S([L('A1')]), 1);
    const id = s.currentId;
    s = deleteTree(s, id);
    expect(s.trees.map((t) => t.id)).toEqual(['ledger:A1']);
    expect(unsentCount(s)).toBe(0);
  });

  it('送信済みの木は「削除した」印を送り、他の端末でも削除になる。元に戻せる', async () => {
    const g = makeFakeGas();
    let phone = (await sync(addDone(S([L('A1')]), 1), g)).state;
    let office = (await sync(S([L('A1')], { server: { ...server, deviceId: 'pc' } }), g)).state;
    expect(office.trees.filter(isAddedTree)).toHaveLength(1);

    const id = phone.trees.find(isAddedTree).id;
    phone = deleteTree(phone, id);
    expect(phone.trees.find((t) => t.id === id)).toMatchObject({ deleted: true, sent: false });
    expect(unsentCount(phone)).toBe(1);
    phone = (await sync(phone, g)).state;
    expect(phone.trees.find((t) => t.id === id)).toMatchObject({ deleted: true, sent: true, rev: 2 });

    office = (await sync(office, g)).state;
    const there = office.trees.find(isAddedTree);
    expect(there.deleted).toBe(true);
    expect(reviewState(there, office, cfg)).toBe('deleted');
    expect(treesForDb(office, cfg, { includeUnconfirmed: true }).trees.find(isAddedTree)).toBeUndefined();

    phone = (await sync(restoreTree(phone, id), g)).state;
    office = (await sync(office, g)).state;
    expect(office.trees.find(isAddedTree).deleted).toBe(false);
  });

  it('確定していた木を削除すると、確定は外れる', async () => {
    const g = makeFakeGas();
    let s = (await sync(addDone(S([L('A1')]), 1), g)).state;
    const t = s.trees.find(isAddedTree);
    s = setConfirm(s, t, true, cfg);
    expect(reviewState(t, s, cfg)).toBe('confirmed');
    s = (await sync(deleteTree(s, t.id), g)).state;
    expect(reviewState(s.trees.find(isAddedTree), s, cfg)).toBe('deleted');
  });

  it('食い違いのある送信済みの木は、先に食い違いを解決するまで削除しない', () => {
    const t = { ...L('X'), ledgerRow: undefined, id: 'new:1', uid: 'd-1', source: 'app', done: true, rev: 1, conflict: { rev: 2, data: {} } };
    const s = S([L('A1'), t]);
    expect(() => deleteTree(s, 'new:1')).toThrow('食い違い');
  });

  it('台帳の木は削除できない（入力の取り消しを使う）', () => {
    const s = S([L('A1', { source: 'app', done: true })]);
    expect(() => deleteTree(s, 'ledger:A1')).toThrow('台帳');
  });
});

describe('台帳の木の入力の取り消し', () => {
  it('未入力に戻し、送信済みなら他の端末でも未入力になる（入力した値は下書きとして残る）', async () => {
    const g = makeFakeGas();
    let phone = (await sync(S([L('A1', { source: 'app', done: true, height: '8', updatedAt: 'u1' })]), g)).state;
    let office = (await sync(S([L('A1')], { server: { ...server, deviceId: 'pc' } }), g)).state;
    expect(office.trees[0]).toMatchObject({ done: true, height: '8' });

    phone = withdrawTree(phone, 'ledger:A1');
    expect(phone.trees[0]).toMatchObject({ done: false, height: '8', sent: false });
    expect(unsentCount(phone)).toBe(1);
    phone = (await sync(phone, g)).state;
    office = (await sync(office, g)).state;
    expect(office.trees[0]).toMatchObject({ done: false, height: '8' });
    expect(reviewState(office.trees[0], office, cfg)).toBe('draft');
  });

  it('追加した木・入力していない木は取り消しの対象外', () => {
    const s = addDone(S([L('A1')]), 1);
    expect(() => withdrawTree(s, s.currentId)).toThrow('削除');
    expect(() => withdrawTree(s, 'ledger:A1')).toThrow('入力済み');
  });
});
