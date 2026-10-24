// サーバー（GAS）とのやり取りのテスト
// gas/Code.js を「にせの Google」（test/helpers/fakeGas.js）の上でそのまま動かし、アプリ側の送信・受信と組み合わせて確かめる
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import { addSticky, answerSticky, closeSticky, reviewState, setConfirm, treeKey, treesForDb } from '../src/store/review.js';
import {
  applyPull,
  applyPush,
  callServer,
  fromBase64,
  getFile,
  outbox,
  pull,
  push,
  putFile,
  rejectedMessage,
  resolveConflict,
  toBase64,
  unsentCount,
  unsentList,
  unsentTrees,
} from '../src/store/sync.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1' };
const P = (id, o = {}) => blankTree({ id, treeNo: id.toUpperCase(), siteType: 'park', parkName: '架空公園', source: 'app', ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, server: { ...server, lastSeq: 0 }, ...o });

// 送って、結果を当てはめて、受け取る（アプリの「やり取り」と同じ順番）
async function sync(state, g) {
  const r = await push(state, cfg, g.fetchFn);
  const a = applyPush(state, r.results, r.tokens, cfg);
  const p = await pull(a.state, cfg, g.fetchFn);
  const b = applyPull(a.state, p.records, p.lastSeq, cfg);
  return { state: b.state, saved: a.saved, conflicts: [...a.conflicts, ...b.conflicts], changedTrees: b.changedTrees, newStickies: b.newStickies };
}

describe('サーバーの計算部分（gas/Code.js）', () => {
  const { lib } = makeFakeGas();
  const rec = (id, baseRev, data = {}) => ({ id, kind: 'tree', treeId: id.slice(5), baseRev, by: '人', updatedAt: 'u', data });

  it('新しい記録は版1で追加。版が合えば上書きして版を上げ、合わなければ断る', () => {
    const p1 = lib.planPush([], [rec('tree:A', 0, { h: 1 })], 2099, 'now', 'dev1');
    expect(p1.results).toEqual([{ id: 'tree:A', ok: true, rev: 1, seq: 1 }]);
    const rows = p1.appends;
    const p2 = lib.planPush(rows.map((r) => [...r]), [rec('tree:A', 1, { h: 2 })], 2099, 'now', 'dev2');
    expect(p2.results[0]).toMatchObject({ ok: true, rev: 2, seq: 2 });
    expect(p2.updates[0].index).toBe(0);
    // 版1を見て直した別の端末 → 断られ、サーバーの今の内容が返る
    const p3 = lib.planPush(rows.map((r) => [...r]), [rec('tree:A', 0, { h: 9 })], 2099, 'now', 'dev3');
    expect(p3.results[0]).toMatchObject({ conflict: true, rev: 1, data: { h: 1 }, by: '人' });
    expect(p3.updates).toHaveLength(0);
    expect(p3.history).toHaveLength(0);
  });

  it('同じ送信の中で同じ記録が続いても、版が正しく進む', () => {
    const p = lib.planPush([], [rec('tree:A', 0), rec('tree:A', 1)], 2099, 'now', 'dev1');
    expect(p.results.map((r) => r.rev)).toEqual([1, 2]);
    expect(p.appends).toHaveLength(1);
    expect(p.history).toHaveLength(2);
  });

  it('形の違う記録は断る', () => {
    const p = lib.planPush([], [{ id: 'x', kind: 'other' }], 2099, 'now', 'dev1');
    expect(p.results[0].error).toBeTruthy();
  });

  it('受け取りは、その年度で通し番号が since より後のものだけ（壊れた行は飛ばす）', () => {
    const row = (id, year, seq, json = '{}') => [id, String(year), 'tree', id, 1, seq, '', '', '', '', json];
    const l = lib.listSince([row('a', 2099, 3), row('b', 2099, 1), row('c', 2098, 9), row('d', 2099, 5, '{こわれ')], 2099, 1);
    expect(l.records.map((r) => r.id)).toEqual(['a']);
    expect(l.lastSeq).toBe(3);
  });
});

describe('送信と受信（にせの Google で通しで確認）', () => {
  it('合言葉が違えば断る。サーバーに合言葉がなければ断る', async () => {
    const g = makeFakeGas();
    await expect(callServer({ ...server, pass: 'ちがう' }, { action: 'ping' }, g.fetchFn)).rejects.toThrow('合言葉が違います');
    await expect(callServer(server, { action: 'ping' }, makeFakeGas({ passphrase: '' }).fetchFn)).rejects.toThrow('PASSPHRASE');
    expect((await callServer(server, { action: 'ping' }, g.fetchFn)).ok).toBe(true);
  });

  it('入力済みでまだ送っていない木だけ送り、送れたら送信済み・版1にする。履歴にも残る', async () => {
    const g = makeFakeGas();
    const s = S([
      P('a1', { done: true, updatedAt: '2099-05-01T00:00:00Z' }),
      P('a2', { done: true, sent: true, rev: 1 }),
      P('a3'), // 未入力
      P('a4', { done: true, source: 'ledger' }), // 台帳で入力済み
    ]);
    expect(unsentTrees(s).map((t) => t.id)).toEqual(['a1']);
    const { state, saved } = await sync(s, g);
    expect(saved).toBe(1);
    expect(state.trees.find((t) => t.id === 'a1')).toMatchObject({ sent: true, rev: 1 });
    const rows = g.sheets.get('records').cells;
    expect(rows[0][0]).toBe('ID');
    expect(rows[1].slice(0, 6)).toEqual(['tree:2099|park|A1|1', '2099', 'tree', '2099|park|A1|1', 1, 1]);
    expect(JSON.parse(rows[1][10])).not.toHaveProperty('sent'); // 端末だけの印は送らない
    expect(g.sheets.get('history').cells).toHaveLength(2);
    expect(unsentCount(state)).toBe(0);
  });

  it('送信中に直した木は、送信済みにしない（次の送信でもう一度送る）', async () => {
    const g = makeFakeGas();
    const s = S([P('a1', { done: true, updatedAt: '2099-05-01T00:00:00Z' }), P('a2', { done: true, updatedAt: '2099-05-01T00:00:00Z' })]);
    const r = await push(s, cfg, g.fetchFn);
    const latest = { ...s, trees: s.trees.map((t) => (t.id === 'a1' ? { ...t, height: '9', updatedAt: '2099-05-01T00:00:09Z' } : t)) };
    const after = applyPush(latest, r.results, r.tokens, cfg).state;
    expect(after.trees.map((t) => [t.id, !!t.sent, t.rev])).toEqual([['a1', false, 1], ['a2', true, 1]]);
    // 次の送信は版1を土台にするので、断られない
    const again = await sync(after, g);
    expect(again.conflicts).toEqual([]);
    expect(again.state.trees[0]).toMatchObject({ sent: true, rev: 2 });
  });

  it('別の端末で送った木を受け取れる。端末にない木は同じまとまりの最後に入る。台帳で入力済みの木は上書きしない', async () => {
    const g = makeFakeGas();
    const phone = S([
      P('a1', { done: true, height: '8', updatedAt: 'x' }),
      P('n1', { treeNo: 'ZZ900', done: true, status: '新規', updatedAt: 'x' }),
      P('x9', { treeNo: 'X9', done: true, updatedAt: 'x' }),
    ]);
    await sync(phone, g);

    const office = S([P('a1'), P('a2'), P('x9', { source: 'ledger', done: true, treeNo: 'X9', height: '5' }), P('b1', { parkName: '別公園' })], {
      server: { ...server, deviceId: 'pc', lastSeq: 0 },
    });
    const { state, changedTrees } = await sync(office, g);
    expect(changedTrees).toEqual(['A1', 'ZZ900']);
    const byNo = Object.fromEntries(state.trees.map((t) => [t.treeNo, t]));
    expect(byNo.A1).toMatchObject({ id: 'a1', height: '8', done: true, sent: true, rev: 1 });
    expect(byNo.X9.height).toBe('5');
    expect(state.trees.map((t) => t.treeNo)).toEqual(['A1', 'A2', 'X9', 'ZZ900', 'B1']); // 架空公園のまとまりの最後
    expect(state.server.lastSeq).toBe(3);
    // 2回目は変わったものだけ（何もない）
    const again = await sync(state, g);
    expect(again.changedTrees).toEqual([]);
  });

  it('【上書き防止】同じ木を2台で直したら、後から送った方は断られ、どちらを使うか選べる', async () => {
    const g = makeFakeGas();
    const base = await sync(S([P('a1', { done: true, height: '8', updatedAt: 'x' })]), g);
    const devA = base.state;
    const devB = { ...base.state, server: { ...base.state.server, deviceId: 'dev2' } };
    const edit = (s, h) => ({ ...s, trees: s.trees.map((t) => ({ ...t, height: h, sent: false, updatedAt: h })) });

    const a = await sync(edit(devA, '10'), g);
    expect(a.conflicts).toEqual([]);
    const b = await sync(edit(devB, '12'), g); // B は A の修正を知らずに直した
    expect(b.conflicts).toEqual(['A1']);
    const t = b.state.trees[0];
    expect(t.height).toBe('12'); // 自分の入力は消さない
    expect(t.conflict).toMatchObject({ rev: 2, data: { height: '10' } });
    expect(outbox(b.state, cfg).records).toHaveLength(0); // 選ぶまでは送らない

    // 「自分の方を使う」→ 相手の版を土台に送り直す
    const mine = await sync(resolveConflict(b.state, t.id, 'mine'), g);
    expect(mine.conflicts).toEqual([]);
    expect(mine.state.trees[0]).toMatchObject({ height: '12', rev: 3, sent: true });
    // 「相手の方を使う」
    const theirs = resolveConflict(b.state, t.id, 'server');
    expect(theirs.trees[0]).toMatchObject({ height: '10', rev: 2, sent: true, conflict: null });
  });

  it('【再発防止】サーバーに断られた記録は、どれが・なぜ断られたかを返す（未送信のまま残す）', () => {
    const st = S([P('a1', { done: true, updatedAt: 'x' })]);
    const { records, tokens } = outbox(st, cfg);
    const r = applyPush(st, [{ id: records[0].id, error: '記録の形が違います' }], tokens, cfg);
    expect(r.rejected).toEqual([{ label: 'A1', error: '記録の形が違います' }]);
    expect(unsentCount(r.state)).toBe(1); // 送れていないので未送信のまま
    expect(rejectedMessage(r.rejected)).toContain('A1（記録の形が違います）');
    expect(rejectedMessage(r.rejected)).toContain('新しい版'); // 古いサーバーのときの直し方
    expect(rejectedMessage([])).toBe('');
  });

  it('【再発防止】2台で同じ木を削除した：食い違いにせず、削除済みとして片付ける（前に残った食い違いも）', async () => {
    const g = makeFakeGas();
    const base = await sync(S([P('n1', { done: true, treeNo: '', species: 'テストノキ', updatedAt: 'x' })]), g);
    const devA = base.state;
    const devB = { ...base.state, server: { ...base.state.server, deviceId: 'dev2' } };
    const del = (st, at) => ({ ...st, trees: st.trees.map((t) => ({ ...t, deleted: true, done: false, sent: false, updatedAt: at })) });
    await sync(del(devA, 'a'), g);
    const b = await sync(del(devB, 'b'), g); // 時刻だけ違う
    expect(b.conflicts).toEqual([]);
    expect(b.state.trees[0]).toMatchObject({ deleted: true, sent: true, conflict: null, rev: 2 }); // サーバーの版（A の削除）にそろう
    expect(unsentCount(b.state)).toBe(0);
    // 前の版のアプリで残ってしまった食い違いも、次のやり取りで片付ける
    const stuck = { ...b.state, trees: [{ ...b.state.trees[0], sent: false, rev: 2, conflict: { rev: 3, by: '', updatedAt: 'a', data: { ...b.state.trees[0], updatedAt: 'a' } } }] };
    const c = applyPull(stuck, [], 0, cfg);
    expect(c.state.trees[0]).toMatchObject({ deleted: true, sent: true, conflict: null, rev: 3 });
    expect(unsentCount(c.state)).toBe(0);
  });

  it('【再発防止】送信はサーバーに届いたが返事が届かなかった：送り直しても自分どうしの食い違いにしない', async () => {
    const g = makeFakeGas();
    const s = S([P('a1', { done: true, height: '8', updatedAt: 'x' })]);
    await push(s, cfg, g.fetchFn); // サーバーには保存されたが、返事を受け取る前に通信が切れた（端末は未送信のまま）
    const again = await sync(s, g);
    expect(again.conflicts).toEqual([]);
    expect(again.state.trees[0]).toMatchObject({ sent: true, rev: 1, conflict: null });
    // 受け取りの側でも同じ（送り直す前に受け取った場合）
    const p = await pull(s, cfg, g.fetchFn);
    const r = applyPull(s, p.records, p.lastSeq, cfg);
    expect(r.conflicts).toEqual([]);
    expect(r.state.trees[0]).toMatchObject({ sent: true, rev: 1 });
    // 返事を失った後でさらに直していた場合は、従来どおり食い違いとして見せる（中身が違うので）
    const edited = { ...s, trees: s.trees.map((t) => ({ ...t, height: '9', updatedAt: 'y' })) };
    expect((await sync(edited, g)).conflicts).toEqual(['A1']);
  });

  it('【再発防止】2台で同じ内容に直した（保存した時刻だけ違う）：食い違いにせず、送信済みにする（前に残った食い違いも）', async () => {
    const g = makeFakeGas();
    const base = await sync(S([P('a1', { done: true, height: '8', updatedAt: 'x' })]), g);
    const devA = base.state;
    const devB = { ...base.state, server: { ...base.state.server, deviceId: 'dev2' } };
    const edit = (s, at) => ({ ...s, trees: s.trees.map((t) => ({ ...t, height: '10', sent: false, updatedAt: at })) });
    await sync(edit(devA, 'a'), g);
    // 送るとき（サーバーに断られた返事に、同じ内容が入っている）
    const b = await sync(edit(devB, 'b'), g);
    expect(b.conflicts).toEqual([]);
    expect(b.state.trees[0]).toMatchObject({ height: '10', rev: 2, sent: true, conflict: null });
    expect(unsentCount(b.state)).toBe(0);
    // 受け取るとき（まだ送っていない自分の修正と、届いた版の中身が同じ）
    const p = await pull(edit(devB, 'c'), cfg, g.fetchFn);
    const r = applyPull(edit(devB, 'c'), p.records, p.lastSeq, cfg);
    expect(r.conflicts).toEqual([]);
    expect(r.state.trees[0]).toMatchObject({ rev: 2, sent: true, conflict: null });
    // 前の版のアプリで残った、中身が同じ食い違いは、受け取ったときに片付ける
    const old = { ...devB, trees: devB.trees.map((t) => ({ ...t, height: '10', sent: false, updatedAt: 'd', conflict: { rev: 2, by: '', updatedAt: 'a', data: { ...b.state.trees[0], updatedAt: 'a', id: undefined, rev: undefined, sent: undefined, conflict: undefined, order: undefined } } })) };
    expect(unsentCount(old)).toBe(1);
    const q = await pull(old, cfg, g.fetchFn);
    const r2 = applyPull(old, q.records, q.lastSeq, cfg);
    expect(r2.state.trees[0]).toMatchObject({ rev: 2, sent: true, conflict: null });
    expect(unsentCount(r2.state)).toBe(0);
  });

  it('未送信の一覧：どの記録か・なぜ送れていないか（食い違いで選ぶ待ち）が分かる', () => {
    const s = S([
      P('a1', { done: true, sent: false }),
      P('a2', { done: true, sent: false, rev: 1, conflict: { rev: 2, data: {} } }),
      P('a3', { done: true, sent: true, rev: 1 }),
    ]);
    expect(unsentCount(s)).toBe(2);
    expect(unsentList(s, cfg).map((x) => [x.label, x.conflict])).toEqual([
      ['A1', false],
      ['A2', true],
    ]);
  });

  it('受け取った版が、まだ送っていない自分の修正とぶつかったら、上書きせずに食い違いにする', async () => {
    const g = makeFakeGas();
    const base = await sync(S([P('a1', { done: true, height: '8', updatedAt: 'x' })]), g);
    const other = { ...base.state, trees: base.state.trees.map((t) => ({ ...t, height: '10', sent: false, updatedAt: 'y' })) };
    await sync(other, g);
    const mine = { ...base.state, trees: base.state.trees.map((t) => ({ ...t, height: '12', sent: false, updatedAt: 'z' })) };
    const p = await pull(mine, cfg, g.fetchFn);
    const r = applyPull(mine, p.records, p.lastSeq, cfg);
    expect(r.conflicts).toEqual(['A1']);
    expect(r.state.trees[0]).toMatchObject({ height: '12', conflict: { rev: 2 } });
  });

  it('設定・原本・台帳のファイルを置いて、取り出せる（置き直すと前のファイルはゴミ箱へ）', async () => {
    const g = makeFakeGas();
    expect(await getFile(server, 'template', g.fetchFn)).toBeNull();
    const bytes = new Uint8Array(70000).map((_, i) => i % 251);
    await putFile(server, 'template', '原本.xlsx', bytes.buffer, g.fetchFn);
    const f = await getFile(server, 'template', g.fetchFn);
    expect(f.name).toBe('原本.xlsx');
    expect(new Uint8Array(f.buffer)).toEqual(bytes);
    const firstId = g.props.get('FILE_template');
    await putFile(server, 'template', '原本2.xlsx', new Uint8Array([1]).buffer, g.fetchFn);
    expect(g.files.get(firstId).trashed).toBe(true);
    await expect(putFile(server, 'other', 'x', new Uint8Array([1]).buffer, g.fetchFn)).rejects.toThrow('種類');
  });

  it('【再発防止】スクリプトからスプレッドシートが見つからないとき：分かる言葉で知らせ、SPREADSHEET_ID があればそれを使う', async () => {
    const g = makeFakeGas({ bound: false });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await expect(putFile(server, 'config', 'c.json', bytes, g.fetchFn)).rejects.toThrow('SPREADSHEET_ID');
    await expect(push(S([P('a1', { done: true, updatedAt: 'x' })]), cfg, g.fetchFn)).rejects.toThrow('SPREADSHEET_ID');
    g.props.set('SPREADSHEET_ID', 'ss');
    await putFile(server, 'config', 'c.json', bytes, g.fetchFn);
    const r = await push(S([P('a1', { done: true, updatedAt: 'x' })]), cfg, g.fetchFn);
    expect(r.results[0].ok).toBe(true);
  });

  it('base64 の変換', () => {
    const b = new Uint8Array([0, 1, 254, 255]).buffer;
    expect(new Uint8Array(fromBase64(toBase64(b)))).toEqual(new Uint8Array(b));
  });
});

describe('確認の流れ（事務の付箋 → 調査者の返事 → 事務の確定）', () => {
  // 調査者のスマホと事務の PC を用意し、調査者が1本送ったところから始める
  async function setup() {
    const g = makeFakeGas();
    const phone0 = S([P('a1', { done: true, dbNote: 'クズ巻き付き有', updatedAt: 'x' })], { user: { role: 'surveyor', name: '調査 一郎' } });
    const phone = (await sync(phone0, g)).state;
    const pc0 = S([P('a1')], { user: { role: 'office', name: '事務 花子' }, server: { ...server, deviceId: 'pc', lastSeq: 0 } });
    const pc = (await sync(pc0, g)).state;
    return { g, phone, pc };
  }

  it('付箋の修正案を調査者が「採用」すると、入力内容に入り、事務が確定できる', async () => {
    const { g, phone, pc } = await setup();
    const t = pc.trees[0];
    expect(reviewState(t, pc, cfg)).toBe('submitted');

    // 事務：一覧表用の特記に修正案を付ける
    const { state: pc1, id } = addSticky(pc, t, { field: 'dbNote', question: 'この書き方で良いか？', proposal: 'クズの巻き付きあり' }, cfg);
    expect(reviewState(t, pc1, cfg)).toBe('asked');
    expect(() => setConfirm(pc1, t, true, cfg)).toThrow('未解決の付箋');
    const pc2 = (await sync(pc1, g)).state;

    // 調査者：受け取って採用 → 入力内容が変わり、送られる
    const got = await sync(phone, g);
    expect(got.newStickies).toBe(1);
    const p1 = answerSticky(got.state, id, { type: 'adopt' }, cfg);
    expect(p1.trees[0]).toMatchObject({ dbNote: 'クズの巻き付きあり', dbNoteManual: true, sent: false });
    const p2 = (await sync(p1, g)).state;
    expect(p2.trees[0]).toMatchObject({ sent: true, rev: 2 });

    // 事務：受け取ると「回答済み」、読んで閉じれば確定できる
    const pc3 = (await sync(pc2, g)).state;
    expect(pc3.trees[0].dbNote).toBe('クズの巻き付きあり'); // 事務は書き直していない
    expect(pc3.stickies[id].answer).toMatchObject({ type: 'adopt', by: '調査 一郎' });
    expect(reviewState(pc3.trees[0], pc3, cfg)).toBe('answered');
    const pc4 = setConfirm(closeSticky(pc3, id), pc3.trees[0], true, cfg);
    expect(reviewState(pc4.trees[0], pc4, cfg)).toBe('confirmed');
    const pc5 = (await sync(pc4, g)).state;
    expect(pc5.confirms[treeKey(pc5.trees[0], cfg)]).toMatchObject({ value: true, treeRev: 2, by: '事務 花子', dirty: false });

    // 調査者の端末にも確定が届く
    const p3 = (await sync(p2, g)).state;
    expect(reviewState(p3.trees[0], p3, cfg)).toBe('confirmed');

    // 確定の後に入力内容が変わったら、確定は外れる
    const p4 = (await sync({ ...p3, trees: p3.trees.map((x) => ({ ...x, height: '9', sent: false, updatedAt: 'later' })) }, g)).state;
    const pc6 = (await sync(pc5, g)).state;
    expect(reviewState(pc6.trees[0], pc6, cfg)).toBe('submitted');
    expect(reviewState(p4.trees[0], p4, cfg)).toBe('submitted');
  });

  it('「このままで良い」「返事だけ」は入力内容を変えない。「自分で直す」は書いた値が入る', async () => {
    const { phone, pc } = await setup();
    const t = pc.trees[0];
    let s = pc;
    const ids = [];
    for (const q of ['案1', '案2', '案3']) {
      const r = addSticky(s, t, { field: 'dbNote', question: '?', proposal: q }, cfg);
      s = r.state;
      ids.push(r.id);
    }
    const ph = { ...phone, stickies: Object.fromEntries(Object.entries(s.stickies).map(([k, v]) => [k, { ...v, dirty: false, rev: 1 }])) };
    const keep = answerSticky(ph, ids[0], { type: 'keep' }, cfg);
    expect(keep.trees[0].dbNote).toBe('クズ巻き付き有');
    expect(keep.trees[0].sent).toBe(true);
    const reply = answerSticky(ph, ids[1], { type: 'reply', text: '現地で確認します' }, cfg);
    expect(reply.trees[0].dbNote).toBe('クズ巻き付き有');
    expect(reply.stickies[ids[1]].answer.text).toBe('現地で確認します');
    const edit = answerSticky(ph, ids[2], { type: 'edit', text: 'クズ巻き付き（幹の半分）' }, cfg);
    expect(edit.trees[0].dbNote).toBe('クズ巻き付き（幹の半分）');
  });

  it('事務が付箋を書き直すのと、調査者の返事が同時でも、どちらも消えない', async () => {
    const { g, phone, pc } = await setup();
    const { state: pc1, id } = addSticky(pc, pc.trees[0], { field: null, question: '写真は撮ったか？' }, cfg);
    const pc2 = (await sync(pc1, g)).state;
    const ph = (await sync(phone, g)).state;

    // 事務が質問を書き足して送る
    const pc3 = (await sync({ ...pc2, stickies: { ...pc2.stickies, [id]: { ...pc2.stickies[id], question: '写真は撮ったか？（全景）', dirty: true, edited: 'body', updatedAt: 'b' } } }, g)).state;
    // 調査者は古い付箋に返事 → サーバーで断られるが、持ち主ごとに合わせて送り直す
    let ph2 = (await sync(answerSticky(ph, id, { type: 'reply', text: '撮りました' }, cfg), g)).state;
    expect(ph2.stickies[id].dirty).toBe(true);
    ph2 = (await sync(ph2, g)).state;
    expect(ph2.stickies[id]).toMatchObject({ question: '写真は撮ったか？（全景）', answer: { text: '撮りました' }, dirty: false });
    const pc4 = (await sync(pc3, g)).state;
    expect(pc4.stickies[id]).toMatchObject({ question: '写真は撮ったか？（全景）', answer: { text: '撮りました' } });
  });
});

describe('一覧表に書き込む木', () => {
  const trees = [P('a1', { done: true, sent: true, rev: 1 }), P('a2', { done: true, sent: true, rev: 1 }), P('a3'), P('x1', { source: 'ledger', done: true })];
  const s = S(trees);
  const confirmed = setConfirm(s, trees[0], true, cfg);

  it('サーバーを使っているときは、アプリで入力した木のうち確定した木だけ（台帳・未入力の木はそのまま渡す）', () => {
    const r = treesForDb(confirmed, cfg);
    expect(r.trees.map((t) => t.id)).toEqual(['a1', 'a3', 'x1']);
    expect(r.excluded.map((t) => t.id)).toEqual(['a2']);
  });
  it('「未確定も含める」なら全部。サーバーを使っていなければ全部', () => {
    expect(treesForDb(confirmed, cfg, { includeUnconfirmed: true }).excluded).toEqual([]);
    expect(treesForDb({ ...confirmed, server: { url: '' } }, cfg).excluded).toEqual([]);
  });
  it('確定の後で入力が変わった木は書き込まない', () => {
    const changed = { ...confirmed, trees: confirmed.trees.map((t) => (t.id === 'a1' ? { ...t, rev: 2 } : t)) };
    expect(treesForDb(changed, cfg).excluded.map((t) => t.id)).toEqual(['a1', 'a2']);
  });
});

describe('端末の状態の引き継ぎ（版1 → 今の版）', () => {
  it('付箋・確定・使う人の欄を足し、アプリで入力した木は新しいサーバーへ送り直す', () => {
    const old = { stateVersion: 1, trees: [P('a', { done: true, sent: true }), P('b', { source: 'ledger', done: true }), P('c')], server: { url: 'u' } };
    const s = migrate(old);
    expect(s).toMatchObject({ stickies: {}, confirms: {}, user: { role: 'surveyor', name: '' }, stateVersion: 3, initials: [] });
    expect(s.server.lastSeq).toBe(0);
    expect(s.trees.map((t) => !!t.sent)).toEqual([false, false, false]);
    expect(s.trees[1].source).toBe('ledger');
    // 版2どうしでは送信済みのまま
    expect(migrate({ ...s, trees: [P('a', { done: true, sent: true, rev: 1 })] }).trees[0].sent).toBe(true);
  });
});
