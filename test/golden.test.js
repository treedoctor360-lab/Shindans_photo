// 答え合わせテスト（作り直しの前後で、結果が1文字も変わらないことを確かめる）
//
// 送受信・確認の流れの部品に、決まった状態を入れたときの結果を、スナップショット（__snapshots__ に保存した答え）と比べる。
// 答えは作り直しの「前」のコードで作って保存した。作り直した後も同じ答えになれば、動きは変わっていない。
// 動きをわざと変えたときだけ、答えを作り直す（npx vitest run -u）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import {
  addSticky,
  answerSticky,
  confirmable,
  reviewState,
  setConfirm,
  stickiesOf,
  treeKey,
  treesForDb,
} from '../src/store/review.js';
import { applyPull, applyPush, outbox, resolveConflict, unsentCount, unsentTrees } from '../src/store/sync.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1', lastSeq: 7 };
const P = (id, o = {}) => blankTree({ id, treeNo: id.toUpperCase(), siteType: 'park', parkName: '架空公園', source: 'app', ...o });
const key = (no) => [cfg.job.year, 'park', no, 1].join('|');

// いろいろな段階の木・付箋・確定の印が混ざった状態
function fixture() {
  const trees = [
    P('a', { done: true, updatedAt: 't-a', height: '10' }), // 送信待ち（初めて）
    P('b', { done: true, sent: true, rev: 2, updatedAt: 't-b' }), // 送信済み・確定済み
    P('c', { done: true, rev: 1, updatedAt: 't-c', conflict: { rev: 2, by: '他', updatedAt: 'x', data: { ...P('c'), height: '99' } } }), // 食い違い中
    P('d', { done: true, source: 'ledger' }), // 台帳で入力済み
    P('e'), // 未入力
    P('f', { done: true, rev: 1, updatedAt: 't-f', height: '7' }), // 送信後に直した
    P('g', { done: true, sent: true, rev: 1, updatedAt: 't-g' }), // 送信済み・付箋なし
    P('h', { done: true, sent: true, rev: 3, updatedAt: 't-h' }), // 確定の後で版が進んだ
  ];
  const stickies = {
    s1: { id: 's1', treeId: key('B'), field: 'species', question: '樹種は？', proposal: 'ケヤキ', by: '事務', at: '1', updatedAt: 'u1', answer: null, closed: false, deleted: false, rev: 0, dirty: true, edited: 'body' },
    s2: { id: 's2', treeId: key('F'), field: 'notes', question: '確認', proposal: '新しい特記', by: '事務', at: '2', updatedAt: 'u2', answer: null, closed: false, deleted: false, rev: 1, dirty: false },
    s3: { id: 's3', treeId: key('G'), field: null, question: 'メモ', proposal: null, by: '事務', at: '3', updatedAt: 'u3', answer: { type: 'reply', text: 'はい', by: '調査', at: '4' }, closed: false, deleted: false, rev: 1, dirty: true, edited: 'answer' },
    s4: { id: 's4', treeId: key('G'), field: null, question: '消した', proposal: null, by: '事務', at: '5', updatedAt: 'u5', answer: null, closed: false, deleted: true, rev: 1, dirty: false },
  };
  const confirms = {
    [key('B')]: { treeId: key('B'), value: true, treeRev: 2, by: '事務', at: '1', updatedAt: 'c-b', rev: 1, dirty: false },
    [key('H')]: { treeId: key('H'), value: true, treeRev: 2, by: '事務', at: '1', updatedAt: 'c-h', rev: 1, dirty: false },
    [key('G')]: { treeId: key('G'), value: false, treeRev: 1, by: '事務', at: '1', updatedAt: 'c-g', rev: 0, dirty: true },
  };
  return { ...migrate(initialState()), trees, stickies, confirms, server: { ...server }, user: { role: 'office', name: '事務' } };
}

// スナップショットに残せる形にする（Map は配列に）
const plain = (v) => JSON.parse(JSON.stringify(v, (_, x) => (x instanceof Map ? [...x.entries()] : x)));

describe('答え合わせ：送受信', () => {
  it('送る記録・送信待ちの数', () => {
    const s = fixture();
    const o = outbox(s, cfg);
    expect(plain({ records: o.records, tokens: o.tokens, unsent: unsentTrees(s).map((t) => t.id), count: unsentCount(s) })).toMatchSnapshot();
  });

  it('送った結果の当てはめ（成功・食い違い・自分が送った内容と同じ）', () => {
    const s = fixture();
    const { tokens } = outbox(s, cfg);
    const results = [
      { id: `tree:${key('A')}`, ok: true, rev: 1, seq: 8 },
      { id: `tree:${key('F')}`, conflict: true, rev: 2, by: '他', updatedAt: 'x', data: { ...P('f'), height: '8' } },
      { id: 'sticky:s1', ok: true, rev: 1, seq: 9 },
      { id: 'sticky:s3', conflict: true, rev: 2, data: { ...s.stickies.s3, question: 'メモ（直した）', answer: null } },
      { id: `confirm:${key('G')}`, ok: true, rev: 1, seq: 10 },
      { id: 'tree:知らない', ok: true, rev: 1 },
    ];
    const r = applyPush(s, results, tokens, cfg);
    expect(plain(r)).toMatchSnapshot();
    // 送信中に直した木は送信済みにしない
    const s2 = { ...s, trees: s.trees.map((t) => (t.id === 'a' ? { ...t, updatedAt: 't-a2' } : t)) };
    expect(plain(applyPush(s2, results.slice(0, 1), tokens, cfg).state.trees.find((t) => t.id === 'a'))).toMatchSnapshot();
  });

  it('受け取った記録の当てはめ（新しい木・上書き・台帳・食い違い・付箋・確定）', () => {
    const s = fixture();
    const rec = (no, rev, data, by = '他') => ({ id: `tree:${key(no)}`, kind: 'tree', treeId: key(no), rev, by, updatedAt: 'srv', data });
    const records = [
      rec('X', 1, { ...P('x'), id: undefined, done: true, height: '5' }), // 端末にない木
      rec('B', 3, { ...P('b'), id: undefined, done: true, height: '12' }), // 送信済みの木の新しい版
      rec('B', 2, { ...P('b'), id: undefined, height: 'old' }), // 古い版（無視）
      rec('D', 1, { ...P('d'), id: undefined, height: '1' }), // 台帳の木（無視）
      rec('A', 1, (({ id, sent, rev, conflict, order, ...d }) => d)(s.trees[0])), // 自分が送った内容（返事が届かなかった）
      rec('F', 2, { ...P('f'), id: undefined, height: '9' }), // 送っていない修正とぶつかる
      rec('C', 2, { ...P('c'), id: undefined }), // 既に食い違いとして受け取った版
      { id: 'sticky:n1', kind: 'sticky', treeId: key('A'), rev: 1, data: { id: 'n1', treeId: key('A'), field: null, question: '新しい付箋', answer: null } },
      { id: 'sticky:s1', kind: 'sticky', treeId: key('B'), rev: 1, data: { ...s.stickies.s1, answer: { type: 'keep', text: '' }, question: 'サーバー側' } },
      { id: 'sticky:s2', kind: 'sticky', treeId: key('F'), rev: 1, data: { ...s.stickies.s2, question: '古い' } },
      { id: 'sticky:bad', kind: 'sticky', rev: 1, data: {} },
      { id: `confirm:${key('A')}`, kind: 'confirm', treeId: key('A'), rev: 1, data: { treeId: key('A'), value: true, treeRev: 1 } },
      { id: `confirm:${key('G')}`, kind: 'confirm', treeId: key('G'), rev: 1, data: { treeId: key('G'), value: true, treeRev: 1 } },
      { id: 'other:1', kind: 'other', rev: 1, data: {} },
    ];
    expect(plain(applyPull(s, records, 20, cfg))).toMatchSnapshot();
  });

  it('食い違いの解決（相手を使う・自分を使う）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-02T03:04:05Z'));
    const s = fixture();
    expect(plain(resolveConflict(s, 'c', 'server').trees.find((t) => t.id === 'c'))).toMatchSnapshot();
    expect(plain(resolveConflict(s, 'c', 'mine').trees.find((t) => t.id === 'c'))).toMatchSnapshot();
    expect(resolveConflict(s, 'a', 'server').trees).toEqual(s.trees); // 食い違いのない木は変わらない
    vi.useRealTimers();
  });
});

describe('答え合わせ：確認の流れ', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-02T03:04:05Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('木の鍵・確認の段階・付箋の一覧', () => {
    const s = fixture();
    expect(
      plain({
        keys: s.trees.map((t) => treeKey(t, cfg)),
        states: s.trees.map((t) => [t.id, reviewState(t, s, cfg)]),
        stickiesOfG: stickiesOf(s, key('G')).map((x) => x.id),
        confirmable: confirmable(s.trees, s, cfg).map((t) => t.id),
      }),
    ).toMatchSnapshot();
  });

  it('付箋を付ける・返事をする（採用・自分で直す・このまま）', () => {
    const s = fixture();
    const added = addSticky(s, s.trees[0], { field: 'species', question: ' 樹種？ ', proposal: 'ムクノキ' }, cfg);
    expect(plain(added)).toMatchSnapshot();
    const adopt = answerSticky({ ...s, user: { role: 'surveyor', name: '調査' } }, 's2', { type: 'adopt' }, cfg);
    expect(plain({ sticky: adopt.stickies.s2, tree: adopt.trees.find((t) => t.id === 'f') })).toMatchSnapshot();
    const edit = answerSticky(s, 's1', { type: 'edit', text: 'エノキ' }, cfg);
    expect(plain({ sticky: edit.stickies.s1, tree: edit.trees.find((t) => t.id === 'b') })).toMatchSnapshot();
    const keep = answerSticky(s, 's1', { type: 'keep' }, cfg);
    expect(keep.trees).toEqual(s.trees);
    expect(answerSticky(s, '無い', { type: 'keep' }, cfg)).toBe(s);
  });

  it('確定する・外す（できない場合は理由つきで断る）', () => {
    const s = fixture();
    const g = s.trees.find((t) => t.id === 'g');
    const s2 = { ...s, stickies: { ...s.stickies, s3: { ...s.stickies.s3, closed: true } } };
    expect(plain(setConfirm(s2, g, true, cfg).confirms[key('G')])).toMatchSnapshot();
    expect(plain(setConfirm(s, s.trees[1], false, cfg).confirms[key('B')])).toMatchSnapshot();
    expect(() => setConfirm(s, g, true, cfg)).toThrow('未解決の付箋');
    expect(() => setConfirm(s, s.trees[0], true, cfg)).toThrow('まだサーバー');
  });

  it('一覧表に書き込む木', () => {
    const s = fixture();
    const ids = (r) => ({ trees: r.trees.map((t) => t.id), excluded: r.excluded.map((t) => t.id) });
    expect(
      plain({
        review: ids(treesForDb(s, cfg)),
        all: ids(treesForDb(s, cfg, { includeUnconfirmed: true })),
        noServer: ids(treesForDb({ ...s, server: { ...s.server, url: '' } }, cfg)),
      }),
    ).toMatchSnapshot();
  });
});
