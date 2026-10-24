// 記録の種類の一覧（surveys.js）のテスト
// 2つ目の調査の種類を仮に足して、送受信・付箋・確定が種類ごとに分かれて動くことを確かめる
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import { addSticky, answerSticky, reviewState, setConfirm, treesForDb } from '../src/store/review.js';
import { applyPull, applyPush, outbox, resolveConflict, unsentCount } from '../src/store/sync.js';
import { SURVEYS, findByKey, simpleKey, surveyOfKind } from '../src/store/surveys.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'p', deviceId: 'dev1', lastSeq: 0 };
const P = (id, o = {}) => blankTree({ id, treeNo: id.toUpperCase(), siteType: 'park', parkName: '架空公園', source: 'app', ...o });

// 仮の2つ目の種類：鍵は簡易の鍵の前に印を付けたもの
const EXTRA = { id: 'extra', kind: 'extra', list: 'extras', keyOf: (t, c) => `extra|${simpleKey(t, c)}` };

describe('記録の種類の一覧', () => {
  beforeEach(() => SURVEYS.push(EXTRA));
  afterEach(() => SURVEYS.splice(SURVEYS.indexOf(EXTRA), 1));

  const state = () => ({
    ...migrate(initialState()),
    server: { ...server },
    trees: [P('a', { done: true, updatedAt: 't1' })],
    extras: [P('x1', { treeNo: 'A', done: true, updatedAt: 't2', memo: '仮' })],
  });

  it('種類の名前から一覧を引ける。知らない種類は null', () => {
    expect(surveyOfKind('tree').id).toBe('simple');
    expect(surveyOfKind('extra')).toBe(EXTRA);
    expect(surveyOfKind('sticky')).toBeNull();
  });

  it('同じ樹木番号でも、種類ごとに別の記録として送る', () => {
    const s = state();
    const { records } = outbox(s, cfg);
    expect(records.map((r) => [r.kind, r.id])).toEqual([
      ['tree', 'tree:2099|park|A|1'],
      ['extra', 'extra:extra|2099|park|A|1'],
    ]);
    expect(unsentCount(s)).toBe(2);
  });

  it('送った結果と受け取った記録は、それぞれの種類の配列に入る', () => {
    const s = state();
    const { tokens } = outbox(s, cfg);
    const pushed = applyPush(s, [{ id: 'extra:extra|2099|park|A|1', ok: true, rev: 1 }], tokens, cfg).state;
    expect(pushed.extras[0]).toMatchObject({ rev: 1, sent: true });
    expect(pushed.trees[0].sent).toBeFalsy(); // 簡易の木は送っていない

    const rec = { id: 'extra:extra|2099|park|B|1', kind: 'extra', treeId: 'extra|2099|park|B|1', rev: 1, data: { ...P('b'), done: true } };
    const pulled = applyPull(pushed, [rec], 5, cfg).state;
    expect(pulled.extras.map((t) => t.id)).toEqual(['x1', 'srv:extra|2099|park|B|1']);
    expect(pulled.trees.map((t) => t.id)).toEqual(['a']);
  });

  it('付箋・確定は種類ごとの鍵で結び付き、採用した修正案はその種類の記録に入る', () => {
    let s = state();
    s = { ...s, extras: s.extras.map((t) => ({ ...t, sent: true, rev: 1 })) };
    const x = s.extras[0];
    const added = addSticky(s, x, { field: 'memo', question: '直す？', proposal: '直した' }, cfg, EXTRA);
    expect(added.state.stickies[added.id].treeId).toBe('extra|2099|park|A|1');
    expect(reviewState(x, added.state, cfg, EXTRA)).toBe('asked');
    expect(reviewState(s.trees[0], added.state, cfg)).toBe('submitted'); // 簡易の木には付かない

    const answered = answerSticky(added.state, added.id, { type: 'adopt' }, cfg);
    expect(answered.extras[0]).toMatchObject({ memo: '直した', sent: false });
    expect(answered.trees[0]).toEqual(s.trees[0]);
    expect(findByKey(answered, 'extra|2099|park|A|1', cfg).survey).toBe(EXTRA);

    const confirmed = setConfirm(s, x, true, cfg, EXTRA);
    expect(Object.keys(confirmed.confirms)).toEqual(['extra|2099|park|A|1']);
    expect(treesForDb({ ...confirmed, server: { ...server } }, cfg, {}, EXTRA).trees).toHaveLength(1);
  });

  it('食い違いの解決は、どの種類の記録でもできる', () => {
    const s = state();
    const withConflict = { ...s, extras: [{ ...s.extras[0], conflict: { rev: 2, data: { ...s.extras[0], memo: '相手' } } }] };
    expect(resolveConflict(withConflict, 'x1', 'server').extras[0]).toMatchObject({ memo: '相手', rev: 2, sent: true, conflict: null });
  });
});
