// 画面の操作（一覧・入力）で状態を変える処理のテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { groupKey, groupKeys, groupLabel } from '../src/core/groups.js';
import { blankTree } from '../src/core/tree.js';
import { initialState } from '../src/store/state.js';
import { addTree, fillChecksNone, normalizeField, nextTodo, pressAlertAction, pressOption, saveTree, toggleTreat } from '../src/store/actions.js';

const cfg = structuredClone(cfgJson);
const P = (id, o = {}) => blankTree({ id, treeNo: id, species: 'テストノキ', siteType: 'park', parkCode: 'K01', parkName: '架空公園', ...o });
const full = { height: '8', girths: ['0.5'], vigor: '良', lean: '無', deadBranch: '無', decay: '無', fungus: '無', initialNeeded: '否', grade: 'A' };

function state(trees, o = {}) {
  return { ...initialState(), trees, group: groupKey(trees[0], cfg), currentId: trees[0].id, session: { date: '2099-05-06', inspector: '試験 二郎' }, ...o };
}

describe('まとまり（公園・路線）', () => {
  it('名前でまとめ、コードが分かれていても1つにする', () => {
    const ts = [P('a'), P('b', { parkCode: 'K02' }), P('c', { parkName: '別公園', parkCode: 'K09' }), blankTree({ id: 'r', siteType: 'street', routeNo: 'R1', routeName: '架空通り' })];
    const keys = groupKeys(ts, cfg);
    expect(keys).toEqual(['park:架空公園', 'park:別公園', 'street:架空通り']);
    expect(keys.map((k) => groupLabel(ts, k, cfg))).toEqual(['[公園] K01・K02 架空公園', '[公園] K09 別公園', '[道路] R1 架空通り']);
  });
});

describe('入力の操作', () => {
  it('選択ボタン：もう一度押すと解除、詳しい診断「要」で健全度を空欄、枯死以外で緊急入力を戻す', () => {
    let t = P('a', { grade: 'B' });
    t = pressOption(t, 'lean', '有', cfg);
    expect(t.lean).toBe('有');
    expect(pressOption(t, 'lean', '有', cfg).lean).toBe('');
    expect(pressOption(t, 'initialNeeded', '要', cfg)).toMatchObject({ initialNeeded: '要', grade: '' });
    expect(pressOption({ ...t, vigor: '枯', deadOverride: true }, 'vigor', '良', cfg).deadOverride).toBe(false);
  });

  it('写真の有無：自動判定と同じ値を押すと手入力を外す', () => {
    const t = P('a', { vigor: '良' }); // 弱点なし → 自動は「無」
    expect(pressOption(t, 'photoOverride', '有', cfg).photoOverride).toBe('有');
    expect(pressOption({ ...t, photoOverride: '有' }, 'photoOverride', '無', cfg).photoOverride).toBe('');
  });

  it('点検項目：まだ選んでいない項目だけをすべて「無」にする（選んである項目・樹勢は変えない）', () => {
    const r = fillChecksNone(P('a', { deadBranch: '有', deadBranchCount: '4' }), cfg);
    expect(r.keys).toEqual(['lean', 'decay', 'fungus']);
    expect(r.tree).toMatchObject({ lean: '無', deadBranch: '有', deadBranchCount: '4', decay: '無', fungus: '無' });
    expect(r.tree.vigor).toBeFalsy();
    expect(fillChecksNone(r.tree, cfg).keys).toEqual([]); // もう選んでいない項目はない
  });

  it('処置のボタン・確定時の補正（番号は半角大文字、樹種は置き換え）', () => {
    expect(toggleTreat(toggleTreat(P('a'), '縮小'), '縮小').treatSel).toEqual([]);
    expect(normalizeField(P('a', { treeNo: ' ａｂ１２３ ' }), 'treeNo', cfg).treeNo).toBe('AB123');
    expect(normalizeField(P('a', { species: 'キュウメイノキ' }), 'species', cfg).species).toBe('テストノキ');
    expect(normalizeField(P('a', { height: '１２．５' }), 'height', cfg).height).toBe('12.5');
  });

  it('保存：未入力があれば止め、確認後は保存。調査日・調査者を記録して次の未入力へ', () => {
    const s = state([P('a'), P('b', { done: true, source: 'ledger' }), P('c')]);
    const r1 = saveTree(s, cfg);
    expect(r1.saved).toBe(false);
    expect(r1.missing).toContain('樹高');
    const r2 = saveTree(s, cfg, { force: true });
    expect(r2.saved).toBe(true);
    expect(r2.state.trees[0]).toMatchObject({ done: true, source: 'app', date: '2099-05-06', inspector: '試験 二郎' });
    expect(r2.state.currentId).toBe('c'); // 台帳で入力済みの b は飛ばす
  });

  it('「保存」だけ：同じ木のまま（次の木・一覧に移らない）。最後の木でも一覧に戻らない', () => {
    const s = state([P('a', full), P('c')]);
    const r = saveTree(s, cfg, { after: 'stay' });
    expect(r.saved).toBe(true);
    expect(r.state.trees[0]).toMatchObject({ done: true, source: 'app', date: '2099-05-06' });
    expect(r.state.currentId).toBe('a');
    expect(r.state.view).toBe(s.view);
    const last = saveTree(state([P('a', full)]), cfg, { after: 'stay' });
    expect(last.state.currentId).toBe('a');
    expect(last.state.view).toBe(s.view);
    // 未入力があれば、ほかの保存と同じく止める
    expect(saveTree(state([P('a')]), cfg, { after: 'stay' }).saved).toBe(false);
  });

  it('最後の未入力を保存したら一覧に戻る。台帳で入力済みの木は保存しない', () => {
    const s = state([P('a', full)]);
    const r = saveTree(s, cfg);
    expect(r.saved).toBe(true);
    expect(r.state.view).toBe('list');
    expect(saveTree(state([P('x', { source: 'ledger', done: true })]), cfg).saved).toBe(false);
  });

  it('保存の後の行き先：一覧へ／同じ区画にもう1本追加（次の未入力の木は開かない）', () => {
    const added = P('new:1', { ...full, treeNo: '', uid: 'dev-1', area: '北区画' });
    const s = state([P('a'), added], { currentId: 'new:1' });
    const toList = saveTree(s, cfg, { after: 'list', force: true }); // 番号なし（テープなし）は未入力のまま保存
    expect(toList.state.view).toBe('list');
    expect(toList.state.currentId).toBe('new:1'); // 台帳の未入力の木 a には移らない
    const add = saveTree(s, cfg, { after: 'add', force: true, now: '2099-05-06T00:00:00.000Z' });
    const nt = add.state.trees.find((t) => t.id === add.state.currentId);
    expect(nt.id).not.toBe('new:1');
    expect(nt).toMatchObject({ treeNo: '', done: false, area: '北区画', parkCode: 'K01' });
    expect(add.state.trees.find((t) => t.id === 'new:1').done).toBe(true);
  });

  it('次の未入力は、今の木より後ろ→前の順に探す', () => {
    const s = state([P('a'), P('b', { done: true }), P('c')], { currentId: 'c' });
    expect(nextTodo(s, cfg).id).toBe('a');
  });

  it('台帳で入力済みの木を再調査にする・控えに戻す', () => {
    const backup = { ...P('a', { height: '9.9', done: true }), source: 'app' };
    const s = state([P('a', { source: 'ledger', done: true, height: '8.5', appBackup: backup })]);
    const r1 = pressAlertAction(s, 'a', { type: 'resurvey' }, null, cfg);
    expect(r1.trees[0]).toMatchObject({ source: 'app', done: false, height: '8.5' });
    const r2 = pressAlertAction(s, 'a', { type: 'useApp' }, null, cfg);
    expect(r2.trees[0]).toMatchObject({ source: 'app', height: '9.9' });
  });

  it('台帳にない木を追加：場所の情報を写し、まとまりの最後に入れる', () => {
    const s = state([P('a'), P('b'), blankTree({ id: 'r', siteType: 'street', routeName: '架空通り' })]);
    const r = addTree(s, cfg, { area: '北', now: 1 });
    expect(r.trees.map((t) => t.id)).toEqual(['a', 'b', 'new:1', 'r']);
    expect(r.trees[2]).toMatchObject({ siteType: 'park', parkName: '架空公園', parkCode: 'K01', status: '新規', area: '北', treeNo: '' });
    expect([r.currentId, r.view]).toEqual(['new:1', 'form']);
  });
});
