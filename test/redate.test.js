// 調査日をまとめて直す（調査者の操作）のテスト
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import { saveInitial, startInitial, updateInitial } from '../src/store/initial.js';
import { datesOf, fixDateInspector, fixTargets, pairsOf, recordDate, redate, redateTargets } from '../src/store/redate.js';
import { dateFixSig, reviewState, setConfirm } from '../src/store/review.js';
import { applyPull, applyPush, pull, push } from '../src/store/sync.js';
import { INITIAL } from '../src/store/surveys.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1', lastSeq: 0 };
const T = (no, o = {}) =>
  blankTree({ id: `ledger:${no}`, treeNo: no, siteType: 'park', parkCode: 'K01', parkName: '架空公園', place: '架空町', ledgerRow: { sheet: 's', row: 3 }, ...o });
const app = (no, date, o = {}) => T(no, { source: 'app', done: true, date, inspector: '試験 一郎', species: 'テストノキ', grade: 'B', ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, server: { ...server }, session: { date: '2099-05-06', inspector: '試験 一郎' }, ...o });

async function sync(state, g) {
  const r = await push(state, cfg, g.fetchFn);
  const a = applyPush(state, r.results, r.tokens, cfg);
  const p = await pull(a.state, cfg, g.fetchFn);
  return applyPull(a.state, p.records, p.lastSeq, cfg).state;
}

// 詳しい診断の記録を、session の調査日で入力済みにする
function withInitial(s, no) {
  const t = s.trees.find((x) => x.treeNo === no);
  s = startInitial(s, t, cfg).state;
  const id = s.initials.find((r) => r.treeNo === no).id;
  s = updateInitial(s, id, (r) => ({ ...r, overall: 'C' }));
  return saveInitial(s, id, cfg, { force: true }).state;
}

describe('調査日をまとめて直す', () => {
  it('間違えた日付の木だけ、調査日だけを直す（調査者・中身は変えない）。詳しい診断も同じ日付なら一緒に', () => {
    let s = S([app('AB001', '2099-05-06', { initialNeeded: '要' }), app('AB002', '2099-05-06', { inspector: '試験 二郎' }), app('AB003', '2099-05-07'), T('AB004'), T('AB005', { source: 'ledger', done: true, date: '2099-05-06' })]);
    s = withInitial(s, 'AB001');
    expect(recordDate(s.initials[0], cfg, INITIAL)).toBe('2099-05-06');
    const ids = s.trees.map((t) => t.id);
    expect(datesOf(s, cfg, s.trees)).toEqual([
      { date: '2099-05-07', count: 1 },
      { date: '2099-05-06', count: 2 },
    ]);
    const tg = redateTargets(s, cfg, s.trees, '2099-05-06');
    expect([tg.trees.map((t) => t.treeNo), tg.initials.length]).toEqual([['AB001', 'AB002'], 1]); // 台帳の木は直さない

    const r = redate(s, cfg, ids, '2099-05-06', '2099-05-05', '2099-06-01T00:00:00.000Z');
    expect([r.trees, r.initials, r.conflicts]).toEqual([2, 1, 0]);
    const by = (no) => r.state.trees.find((t) => t.treeNo === no);
    expect(by('AB001')).toMatchObject({ date: '2099-05-05', inspector: '試験 一郎', grade: 'B', sent: false, updatedAt: '2099-06-01T00:00:00.000Z' });
    expect(by('AB002')).toMatchObject({ date: '2099-05-05', inspector: '試験 二郎' });
    expect(by('AB003').date).toBe('2099-05-07');
    expect(by('AB005')).toBe(s.trees[4]);
    expect(r.state.initials[0]).toMatchObject({ year: 2099, month: 5, day: 5, overall: 'C', sent: false });

    expect(() => redate(s, cfg, ids, '2099-05-06', '')).toThrow('正しい調査日');
    expect(() => redate(s, cfg, ids, '2099-05-06', '2099-05-06')).toThrow('同じ日付');
  });

  it('食い違いのある木は直さず、数を知らせる', () => {
    const s = S([app('AB001', '2099-05-06', { conflict: { rev: 2, data: {} } }), app('AB002', '2099-05-06')]);
    const r = redate(s, cfg, s.trees.map((t) => t.id), '2099-05-06', '2099-05-05');
    expect([r.trees, r.conflicts]).toEqual([1, 1]);
    expect(r.state.trees[0].date).toBe('2099-05-06');
  });

  it('確定した木の調査日を直しても、送った後も確定のまま。ほかの項目を直したら確定は外れる', async () => {
    const g = makeFakeGas();
    let s = S([app('AB001', '2099-05-06', { sent: false })]);
    s = await sync(s, g);
    s = setConfirm(s, s.trees[0], true, cfg);
    s = await sync(s, g);
    expect(reviewState(s.trees[0], s, cfg)).toBe('confirmed');

    s = redate(s, cfg, [s.trees[0].id], '2099-05-06', '2099-05-05').state;
    s = await sync(s, g);
    expect(s.trees[0]).toMatchObject({ date: '2099-05-05', sent: true, rev: 2 });
    expect(reviewState(s.trees[0], s, cfg)).toBe('confirmed');

    // もう一度直しても確定のまま
    s = redate(s, cfg, [s.trees[0].id], '2099-05-05', '2099-05-04').state;
    s = await sync(s, g);
    expect(reviewState(s.trees[0], s, cfg)).toBe('confirmed');

    // 別の端末（事務）が受け取っても確定のまま
    let office = { ...S([app('AB001', '')]), trees: [], server: { ...server, deviceId: 'pc' } };
    const p = await pull(office, cfg, g.fetchFn);
    office = applyPull(office, p.records, p.lastSeq, cfg).state;
    expect(reviewState(office.trees[0], office, cfg)).toBe('confirmed');

    // ほかの項目を直すと外れる
    s = { ...s, trees: s.trees.map((t) => ({ ...t, grade: 'C', sent: false, updatedAt: '2099-07-01T00:00:00.000Z' })) };
    s = await sync(s, g);
    expect(reviewState(s.trees[0], s, cfg)).toBe('submitted');
  });

  it('確定した詳しい診断の記録も、調査日を直しても確定のまま', async () => {
    const g = makeFakeGas();
    let s = S([app('AB001', '2099-05-06', { initialNeeded: '要', sent: false })]);
    s = withInitial(s, 'AB001');
    s = await sync(s, g);
    s = setConfirm(s, s.initials[0], true, cfg, INITIAL);
    s = await sync(s, g);
    expect(reviewState(s.initials[0], s, cfg, INITIAL)).toBe('confirmed');
    s = redate(s, cfg, [s.trees[0].id], '2099-05-06', '2099-05-05').state;
    s = await sync(s, g);
    expect(s.initials[0]).toMatchObject({ day: 5, sent: true });
    expect(reviewState(s.initials[0], s, cfg, INITIAL)).toBe('confirmed');
  });
});

describe('調査日・調査者をまとめて直す', () => {
  it('「調査日＋調査者」の組を本数つきで出す。組を選び、調査者だけ・両方を直せる。選ばなかった木は直さない', () => {
    let s = S([
      app('AB001', '2099-05-06', { inspector: '試験 一郎', initialNeeded: '要' }),
      app('AB002', '2099-05-06', { inspector: '試験 一郎' }),
      app('AB003', '2099-05-06', { inspector: '試験 二郎' }),
      app('AB004', '2099-05-05', { inspector: '試験 一郎' }),
    ]);
    s = { ...s, session: { date: '2099-05-06', inspector: '試験 一郎' } };
    s = withInitial(s, 'AB001');
    expect(pairsOf(s, cfg, s.trees).map((p) => [p.date, p.inspector, p.trees.map((t) => t.treeNo)])).toEqual([
      ['2099-05-06', '試験 一郎', ['AB001', 'AB002']],
      ['2099-05-06', '試験 二郎', ['AB003']],
      ['2099-05-05', '試験 一郎', ['AB004']],
    ]);
    const from = { date: '2099-05-06', inspector: '試験 一郎' };
    const to = { date: '2099-05-04', inspector: '試験 三子' };
    const ids = s.trees.filter((t) => t.treeNo !== 'AB002').map((t) => t.id); // AB002 は外す
    const tg = fixTargets(s, cfg, s.trees.filter((t) => ids.includes(t.id)), from, to);
    expect([tg.trees.map((t) => t.treeNo), tg.initials.length]).toEqual([['AB001'], 1]);
    const r = fixDateInspector(s, cfg, ids, from, to, '2099-06-01T00:00:00.000Z');
    expect([r.trees, r.initials]).toEqual([1, 1]);
    const by = (no) => r.state.trees.find((t) => t.treeNo === no);
    expect(by('AB001')).toMatchObject({ date: '2099-05-04', inspector: '試験 三子', grade: 'B', sent: false });
    expect(by('AB002')).toMatchObject({ date: '2099-05-06', inspector: '試験 一郎' }); // 外した木
    expect(by('AB003')).toMatchObject({ date: '2099-05-06', inspector: '試験 二郎' }); // 別の組
    expect(r.state.initials[0]).toMatchObject({ year: 2099, month: 5, day: 4, inspector: '試験 三子', overall: 'C' });

    // 調査者だけ（調査日は変えない）
    const r2 = fixDateInspector(s, cfg, s.trees.map((t) => t.id), { date: '2099-05-06', inspector: '試験 二郎' }, { inspector: '試験 一郎' });
    expect(r2.state.trees.find((t) => t.treeNo === 'AB003')).toMatchObject({ date: '2099-05-06', inspector: '試験 一郎' });
    expect(r2.trees).toBe(1);
    // 変わらないなら断る。調査者を空にはできない
    expect(() => fixDateInspector(s, cfg, ids, from, { inspector: '試験 一郎' })).toThrow('直す木がありません');
    expect(() => fixDateInspector(s, cfg, ids, from, { inspector: ' ' })).toThrow('調査者を入れてください');
  });

  it('確定した木の調査者を直しても確定のまま。前の版（調査日だけ）で直した記録も確定のまま', async () => {
    const g = makeFakeGas();
    let s = S([app('AB001', '2099-05-06', { sent: false })]);
    s = await sync(s, g);
    s = setConfirm(s, s.trees[0], true, cfg);
    s = await sync(s, g);
    s = fixDateInspector(s, cfg, [s.trees[0].id], { date: '2099-05-06', inspector: '試験 一郎' }, { inspector: '試験 二郎' }).state;
    s = await sync(s, g);
    expect(s.trees[0]).toMatchObject({ inspector: '試験 二郎', sent: true });
    expect(reviewState(s.trees[0], s, cfg)).toBe('confirmed');

    // 前の版の印（v なし。調査日だけを除いた写し）
    const old = { ...s.trees[0], dateFix: { fromRev: s.trees[0].dateFix.fromRev, sig: dateFixSig(s.trees[0], cfg, undefined, 1) } };
    expect(reviewState(old, { ...s, trees: [old] }, cfg)).toBe('confirmed');
  });
});
