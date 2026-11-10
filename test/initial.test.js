// 詳しい診断（初期診断など）の記録のテスト：対象・引き継ぎ・鍵・送受信・ブックとの二重入力・付箋
// IndexedDB は Node にないので、テスト用の代わり（fake-indexeddb）を使う
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree } from '../src/core/tree.js';
import { importInitialBook, initialState, migrate } from '../src/store/state.js';
import { measureLine, measureRecord, toMeasuresV2 } from '../src/core/noteMeasures.js';
import { initialWarnings, simpleNotesStatus } from '../src/store/initial.js';
import { bookEntry, bookValues, discardInitial, karteExtras, karteRecords, fillNone, gradeWriteBack, initialOf, initialsForBook, withdrawInitial, initialStatus, initialTargets, inheritFrom, missingInitial, optionsOf, saveInitial, startInitial, updateInitial, measureStatus, syncMeasures, applyMeasures } from '../src/store/initial.js';
import { addSticky, answerSticky, closeSticky, fieldLabel, reviewFields, reviewState, reviewStatesOf, setConfirm, treeKey } from '../src/store/review.js';
import { applyPull, applyPush, outbox, pull, push } from '../src/store/sync.js';
import { INITIAL, initialKey } from '../src/store/surveys.js';
import { makeFakeGas } from './helpers/fakeGas.js';
import { makeInitialBook } from './helpers/makeInitialBook.js';

const cfg = structuredClone(cfgJson);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1', lastSeq: 0 };
const T = (no, o = {}) =>
  blankTree({ id: `ledger:${no}`, treeNo: no, siteType: 'park', parkCode: 'K01', parkName: '架空公園', place: '架空町', ledgerRow: { sheet: 's', row: 3 }, ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, server: { ...server }, ...o });
// 簡易診断で「詳しい診断が必要」と入力した木
const need = (no, o = {}) => T(no, { source: 'app', done: true, initialNeeded: '要', species: 'テストノキ', height: '12', girths: ['0.5', '0.3'], branchLen: '400', branchDia: '10', lean: '有', ...o });

async function sync(state, g) {
  const r = await push(state, cfg, g.fetchFn);
  const a = applyPush(state, r.results, r.tokens, cfg);
  const p = await pull(a.state, cfg, g.fetchFn);
  return applyPull(a.state, p.records, p.lastSeq, cfg).state;
}

describe('詳しい診断の対象と引き継ぎ', () => {
  it('対象は簡易診断で「必要」とした木（台帳の木も含む。削除した木は除く）', () => {
    const s = S([need('AB001'), T('AB002', { initialNeeded: '否', done: true }), T('AB003', { source: 'ledger', done: true, initialNeeded: '要' }), need('AB004', { deleted: true })]);
    expect(initialTargets(s, cfg).map((x) => [x.tree.treeNo, x.status])).toEqual([
      ['AB001', 'todo'],
      ['AB003', 'todo'],
    ]);
  });

  it('設定に詳しい診断がなければ、対象はない', () => {
    const c = structuredClone(cfgJson);
    delete c.initialSurvey;
    expect(initialTargets(S([need('AB001')]), c)).toEqual([]);
  });

  it('簡易診断の値を設定どおりに引き継ぐ（株立の幹周・枝長/枝径の上限・選択肢の言い換え・数は数で）', () => {
    const { values, keys } = inheritFrom(need('AB001'), cfg);
    expect(values).toEqual({
      species: 'テストノキ',
      place: '架空町',
      height: 12,
      girth: 0.64, // (0.5＋0.3)×0.8
      branchRatio: '30≦', // 40倍 → 「30倍以上」→ 言い換え
      lean: '有（危険）',
    });
    expect(keys).toEqual(['species', 'place', 'height', 'girth', 'branchRatio', 'lean']);
    // 台帳の木の枝長/枝径は、台帳の値
    expect(inheritFrom(T('X', { source: 'ledger', initialNeeded: '要', ledgerBranchRatio: '12.5' }), cfg).values.branchRatio).toBe(12.5);
  });

  it('記録を作ると、元の木と同じ見分け方の鍵になり、もう一度押しても2件にならない', () => {
    let s = S([need('AB001')]);
    const r1 = startInitial(s, s.trees[0], cfg, { now: 't1' });
    expect(r1.created).toBe(true);
    expect(initialKey(r1.record, cfg)).toBe(`initial|${treeKey(s.trees[0], cfg)}`);
    expect(r1.record).toMatchObject({ treeNo: 'AB001', siteType: 'park', dupIndex: 1, parkCode: 'K01', height: 12, done: false, source: 'app', inherited: expect.any(Array) });
    s = r1.state;
    const r2 = startInitial(s, s.trees[0], cfg);
    expect(r2.created).toBe(false);
    expect(s.initials).toHaveLength(1);
    expect(initialStatus(s.trees[0], s, cfg)).toBe('draft');
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true })) };
    expect(initialStatus(s.trees[0], s, cfg)).toBe('done');
    expect(initialOf(s, s.trees[0], cfg).id).toBe('ini:ledger:AB001');
  });

  it('追加した木（uid で見分ける木）も、同じ uid の鍵になる', () => {
    const t = need('ZZ9', { ledgerRow: undefined, id: 'new:1', uid: 'dev1-abc' });
    const { record } = startInitial(S([t]), t, cfg);
    expect(initialKey(record, cfg)).toBe('initial|2099|park|+dev1-abc|1');
  });

  it('対象でない木は記録を作らない', () => {
    const t = T('AB002', { initialNeeded: '否' });
    expect(() => startInitial(S([t]), t, cfg)).toThrow('対象ではない');
  });

  it('設定の引き継ぎの形を確かめる', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.inherit.x = { from: '@unknown' };
    expect(validateConfig(c).errors.join()).toContain('initialSurvey.inherit');
  });
});

describe('確認用カルテに出す値（株立の幹周・樹高/幹径・枝長/枝径）', () => {
  it('株立は幹ごとの幹周を入力のまま並べる。樹高/幹径・枝長/枝径は数値のまま', () => {
    const tree = need('AB001', { girths: ['2.1', '０.80', '0.90'], height: '12', branchLen: '400', branchDia: '10' });
    const rec = { height: 12, girth: 2.66 }; // 詳しい診断の幹周は（和）×係数
    const x = karteExtras(tree, rec, cfg);
    expect(x['@girthList']).toBe('2.1、0.80、0.90');
    expect(x['@heightRatio']).toBe(Math.round(12 / (2.66 / cfg.calc.pi)));
    expect(x['@branchRatio']).toBe(40); // 上限以上でも「40≦倍」にせず数値
    expect(x['@girthStems']).toBe('2.1、0.80、0.90'); // 株立のときだけ
    expect(x['@branchInput']).toBe('400/10'); // 何を入れたか（枝長/枝径）
    expect(x['@heightInput']).toBe(`12.0/${(2.66 / cfg.calc.pi).toFixed(2)}`); // 樹高/幹径の元の値（樹高 m／幹径 m）
  });
  it('単幹は幹周の数。詳しい診断で直した樹高・幹周で樹高/幹径を出す。枝長/枝径は小数第2位まで', () => {
    const tree = need('AB001', { girths: ['1.5'], height: '10', branchLen: '7', branchDia: '0.3' });
    const x = karteExtras(tree, { height: 11, girth: 1.5 }, cfg);
    expect(x['@girthList']).toBe('1.5');
    expect(x['@heightRatio']).toBe(Math.round(11 / (1.5 / cfg.calc.pi)));
    expect(x['@branchRatio']).toBe(23.33);
    expect(x['@girthStems']).toBe(''); // 単幹は空
    expect(x['@branchInput']).toBe('7/0.3');
    expect(x['@heightInput']).toBe('11.0/0.48');
  });
  it('記録から元の木を探して値を足す', () => {
    const tree = need('AB001', { girths: ['1.2', '0.9'] });
    let s = S([tree]);
    s = startInitial(s, tree, cfg).state;
    const [r] = karteRecords(s, s.initials, cfg);
    expect(r['@girthList']).toBe('1.2、0.9');
    expect(r.treeNo).toBe('AB001');
  });
  it('弱点の詳細に、文に出さない入力の数（周囲長／幹周など）を【】で足す（確認用カルテだけ）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.circ = { type: 'pair', label: '周囲長／幹周', unit: 'cm', noText: true };
    c.initialSurvey.forms.initial.sections[1].items[0].parts.push('circ');
    const tree = need('AB001');
    let s = S([tree]);
    s = startInitial(s, tree, c).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, b4: '有（小）', b4DetailParts: { count: '2', circ: { a: '70', b: '210' } }, b4Detail: '2本' })) };
    expect(karteRecords(s, s.initials, c)[0].b4Detail).toBe('2本【70cm/210cm】');
    expect(s.initials[0].b4Detail).toBe('2本'); // 記録（ブックに書く文）は変えない
    // 入力の数がなければ足さない
    expect(karteRecords(s, s.initials, cfg)[0].b4Detail).toBe('2本');
  });
  it('文に出さない数を写す設定にする前に作った記録も、寸法の数で補って【】に出す（文を手で直していなければ）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.circ = { type: 'pair', label: '周囲長／幹周', noText: true };
    c.initialSurvey.forms.initial.sections[1].items[0].parts.push('circ');
    c.noteMeasures.kinds.find((k) => k.key === 'deadBranch').parts.push('circ');
    c.initialSurvey.fromMeasures[0].parts.circ = 'circ';
    const values = { count: '2', circ: { a: '25', b: '187' } };
    const line = measureLine(c, 'deadBranch', '', values);
    const tree = need('AB001', { notes: `・${line}`, measures: [measureRecord('deadBranch', '', values, line)] });
    let s = S([tree]);
    s = startInitial(s, tree, cfg).state; // 前の設定で作った記録（周囲長／幹周を持っていない）
    expect(s.initials[0].b4DetailParts.circ).toBeUndefined();
    expect(karteRecords(s, s.initials, c)[0].b4Detail).toBe(`${s.initials[0].b4Detail}【25/187】`);
    // 文を手で直した記録には補わない
    const manual = { ...s, initials: s.initials.map((r) => ({ ...r, b4Detail: '手で直した', b4DetailManual: true })) };
    expect(karteRecords(manual, manual.initials, c)[0].b4Detail).toBe('手で直した');
  });
  it('枯死の木の枝長/枝径は表記の文字', () => {
    const tree = need('AB001', { vigor: cfg.deadVigor, branchLen: '7', branchDia: '0.3' });
    expect(karteExtras(tree, { height: 10, girth: 1 }, cfg)['@branchRatio']).toBe(cfg.calc.deadLabel);
  });
  it('元の木が分からない・入力が足りないときは空', () => {
    const x = karteExtras(null, { girth: 1.2 }, cfg);
    expect(x['@girthList']).toBe('1.2');
    expect(x['@heightRatio']).toBe('');
    expect(x['@branchRatio']).toBe('');
    expect(x['@heightInput']).toBe('');
  });
});

describe('データ入力用ブックとの二重入力', () => {
  it('ブックに手で入力済みの木は「ブックで入力済み」になり、記録は作らない（force を付ければ作れる）', async () => {
    let s = S([need('AB009'), need('AB001')]);
    const r = await importInitialBook(s, 'book.xlsx', await makeInitialBook(), cfg, '2099-05-06');
    s = r.state;
    expect(s.initialBookInfo).toMatchObject({ name: 'book.xlsx', date: '2099-05-06', errors: [] });
    expect(s.initialBookInfo.filled).toContain('initial|park|K01|AB009');
    // 別の場所（K09）の同じ番号の行があっても、K01 の AB001 は対象のまま
    expect(initialTargets(s, cfg).map((x) => x.status)).toEqual(['book', 'todo']);
    expect(() => startInitial(s, s.trees[0], cfg)).toThrow('入力済み');
    const forced = startInitial(s, s.trees[0], cfg, { force: true }).state;
    expect(initialStatus(forced.trees[0], { ...forced, initials: forced.initials.map((x) => ({ ...x, done: true })) }, cfg)).toBe('both');
  });
});

describe('詳しい診断の記録の送受信と付箋', () => {
  it('入力済みにした記録は種類 initial で送られ、他の端末に届く。簡易診断の木とは別の記録', async () => {
    const g = makeFakeGas();
    let phone = startInitial(S([need('AB001', { sent: true, rev: 1 })]), need('AB001'), cfg).state;
    phone = { ...phone, initials: phone.initials.map((r) => ({ ...r, done: true, b4: '有（小）', updatedAt: 'u2' })) };
    const { records } = outbox(phone, cfg);
    expect(records.map((x) => [x.kind, x.id])).toEqual([['initial', 'initial:initial|2099|park|AB001|1']]);
    phone = await sync(phone, g);
    expect(phone.initials[0]).toMatchObject({ rev: 1, sent: true });

    const office = await sync(S([T('AB001', { source: 'app', done: true, initialNeeded: '要' })], { server: { ...server, deviceId: 'pc' } }), g);
    expect(office.initials).toHaveLength(1);
    expect(office.initials[0]).toMatchObject({ treeNo: 'AB001', b4: '有（小）', done: true, rev: 1 });
    expect(office.trees[0].b4).toBeUndefined(); // 簡易診断の木には入らない
  });

  it('付箋は記録の種類ごとに分かれる（詳しい診断の付箋は、簡易診断の木の付箋にならない）', () => {
    let s = startInitial(S([need('AB001', { sent: true, rev: 1 })]), need('AB001'), cfg).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true, sent: true, rev: 1 })) };
    const r = addSticky(s, s.initials[0], { field: 'b4Detail', question: '高さは？' }, cfg, INITIAL);
    expect(r.state.stickies[r.id].treeId).toBe('initial|2099|park|AB001|1');
    expect(reviewState(r.state.initials[0], r.state, cfg, INITIAL)).toBe('asked');
    expect(reviewState(r.state.trees[0], r.state, cfg)).toBe('submitted');
  });

  it('付箋を付けられる項目は入力画面のすべての項目（弱点は詳細も）。採用すると記録に入り、数の項目は数のまま', () => {
    const fields = reviewFields(cfg, INITIAL);
    expect(fields.map((f) => f.key)).toEqual(expect.arrayContaining(['b4', 'b4Detail', 'height']));
    expect(fieldLabel('b4Detail', cfg, INITIAL)).toMatch(/（詳細）$/);
    expect(fieldLabel(null, cfg, INITIAL)).toBe('記録全体');

    let s = startInitial(S([need('AB001', { sent: true, rev: 1 })]), need('AB001'), cfg).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, done: true, sent: true, rev: 1 })) };
    expect(s.initials[0].height).toBe(12);
    const a = addSticky(s, s.initials[0], { field: 'height', question: '樹高は？', proposal: '１３．５' }, cfg, INITIAL);
    const b = addSticky(a.state, a.state.initials[0], { field: 'b4', proposal: '有（小）' }, cfg, INITIAL);
    expect(reviewStatesOf(b.state.trees[0], b.state, cfg)).toEqual(['submitted', 'asked']);

    s = { ...b.state, user: { role: 'surveyor', name: '試験' } };
    s = answerSticky(s, a.id, { type: 'adopt' }, cfg);
    s = answerSticky(s, b.id, { type: 'adopt' }, cfg);
    expect(s.initials[0]).toMatchObject({ height: 13.5, b4: '有（小）', sent: false }); // 数は数のまま（全角でも）
    expect(reviewState(s.initials[0], s, cfg, INITIAL)).toBe('answered');
    expect(() => setConfirm(s, s.initials[0], true, cfg, INITIAL)).toThrow('付箋');

    // 確認済みにして、送信済みになれば確定できる。確定した記録だけがブックに書き込む対象
    s = closeSticky(closeSticky(s, a.id), b.id);
    s = { ...s, initials: s.initials.map((r) => ({ ...r, sent: true, rev: 2 })) };
    s = setConfirm(s, s.initials[0], true, cfg, INITIAL);
    expect(reviewState(s.initials[0], s, cfg, INITIAL)).toBe('confirmed');
    expect(initialsForBook(s, cfg).records.map((r) => r.treeNo)).toEqual(['AB001']);
    expect(s.confirms['initial|2099|park|AB001|1'].value).toBe(true);
    expect(s.confirms['2099|park|AB001|1']).toBeUndefined(); // 簡易診断の木は確定していない
  });
});

describe('入力画面の部品（並び・選択肢・すべて無・未入力・保存）', () => {
  it('設定の画面の並びを確かめる', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[0].items[0].type = 'slider';
    expect(validateConfig(c).errors.join()).toContain('initialSurvey.forms.initial.sections[0].items[0]');
    const d = structuredClone(cfgJson);
    d.initialSurvey.forms.initial.sections[1].items.push({ key: 'b4Detail', label: 'x', type: 'text' });
    expect(validateConfig(d).errors.join()).toContain('key が重複');
  });

  it('選択肢は設定にあればそれ、なければブックの入力規則から', async () => {
    let s = S([need('AB001')]);
    s = (await importInitialBook(s, 'b.xlsx', await makeInitialBook(), cfg, '2099-05-06')).state;
    const items = cfg.initialSurvey.forms.initial.sections.flatMap((x) => x.items);
    const lean = items.find((x) => x.key === 'lean');
    const b4 = items.find((x) => x.key === 'b4');
    expect(optionsOf(lean, s, 'initial', 'park')).toEqual(['無', '有（安全）', '有（危険）']);
    expect(optionsOf(b4, s, 'initial', 'park')).toEqual(['無', '有（小）', '有（大）']);
    expect(optionsOf(b4, S([]), 'initial', 'park')).toBeNull(); // ブックを読み込んでいなければない
  });

  it('「すべて無」は、まだ選んでいない選択肢の項目だけに入れる', () => {
    const sec = cfg.initialSurvey.forms.environment.sections[0];
    const opts = (it) => it.options || ['支柱なし', '無', '有'];
    const r = fillNone({ weather: '有' }, sec, cfg, opts);
    expect(r.record).toEqual({ weather: '有', stake: '無' });
    expect(r.keys).toEqual(['stake']);
    // 項目に noneValue があれば、その値（物そのものが無いときの選択肢）を入れる。選択肢になければ「無」
    const c2 = structuredClone(cfg);
    const sec2 = c2.initialSurvey.forms.environment.sections[0];
    sec2.items.find((x) => x.key === 'stake').noneValue = '支柱なし';
    const r2 = fillNone({}, sec2, c2, opts);
    expect(r2.record).toEqual({ weather: '無', stake: '支柱なし' });
    expect(r2.custom).toBe(true);
    expect(fillNone({}, sec2, c2, (it) => it.options || ['無', '有']).record.stake).toBe('無');
    expect(validateConfig(c2)).toEqual({ ok: true, errors: [] });
  });
  it('食い違いの注意：詳細があるのに「無」・未選択、簡易診断で「有」なのに詳しい診断で「有」がない（crossCheck）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.crossCheck = [{ field: 'deadBranch', eq: ['有'], items: ['b4'] }];
    expect(validateConfig(c).errors).toEqual([]);
    const tree = need('AB001', { deadBranch: '有', deadBranchCount: '2' });
    const sec = c.initialSurvey.forms.initial.sections.find((x) => x.items.some((it) => it.key === 'b4'));
    const name = `${sec.title.split('・').pop()}の${sec.items.find((it) => it.key === 'b4').label}`;
    expect(initialWarnings({ b4: '無', b4Detail: '2本' }, tree, c)).toEqual([
      `${name}：詳細が入っていますが「無」です`,
      `簡易診断で${c.checks.find((x) => x.key === 'deadBranch').label}が「有」ですが、${name}が「有」になっていません`,
    ]);
    expect(initialWarnings({ b4Detail: '2本' }, tree, c)[0]).toBe(`${name}：詳細が入っていますが「未選択」です`);
    expect(initialWarnings({ b4: '有（小）', b4Detail: '2本' }, tree, c)).toEqual([]);
    expect(initialWarnings({ b4: '無' }, { ...tree, deadBranch: '無' }, c)).toEqual([]);
    // 形の違う設定は使わない
    c.initialSurvey.crossCheck = [{ field: 'deadBranch', eq: '有', items: ['nokey'] }];
    expect(validateConfig(c).errors.join()).toContain('crossCheck[0].items');
  });
  it('組になる項目（linked）：どれかが決まった値（例「支柱なし」）なのに、ほかが別の値なら注意する（推奨。保存は止めない）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.linked = [{ items: ['stake', 'weather'], value: '支柱なし' }];
    expect(validateConfig(c).errors).toEqual([]);
    const label = (k) => c.initialSurvey.forms.environment.sections.flatMap((x) => x.items).find((it) => it.key === k).label;
    expect(initialWarnings({ stake: '支柱なし', weather: '有' }, null, c)).toEqual([`${label('stake')}が「支柱なし」ですが、${label('weather')}は「有」です`]);
    expect(initialWarnings({ stake: '支柱なし', weather: '支柱なし' }, null, c)).toEqual([]);
    expect(initialWarnings({ stake: '支柱なし' }, null, c)).toEqual([]); // 未選択は「未入力の項目」で知らせる
    expect(initialWarnings({ stake: '有', weather: '有' }, null, c)).toEqual([]);
    c.initialSurvey.linked = [{ items: ['stake', 'nokey'], value: '支柱なし' }];
    expect(validateConfig(c).errors.join()).toContain('linked[0].items');
    c.initialSurvey.linked = [{ items: ['stake'], value: '支柱なし' }];
    expect(validateConfig(c).errors.join()).toContain('linked[0]');
  });
  it('食い違いがあれば、保存の前に確かめる（このまま保存もできる）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.crossCheck = [{ field: 'deadBranch', eq: '有', items: ['b4'] }];
    const tree = need('AB001', { deadBranch: '有' });
    let s = startInitial(S([tree]), tree, c).state;
    const id = s.initials[0].id;
    const r = saveInitial(s, id, c);
    expect(r.saved).toBe(false);
    expect(r.warnings.length).toBe(1);
    expect(saveInitial(s, id, c, { force: true }).saved).toBe(true);
  });
  it('【再現】入力済みの記録を後日直しても、元の調査日・調査者のまま', () => {
    const tree = need('AB001');
    let s = startInitial(S([tree], { session: { date: '2099-05-06', inspector: '試験 二郎' } }), tree, cfg).state;
    const id = s.initials[0].id;
    const st = cfg.initialSurvey.stamp;
    s = saveInitial(s, id, cfg, { force: true }).state;
    const first = s.initials[0];
    expect([first[st.date[0]], first[st.date[1]], first[st.date[2]], first[st.inspector]]).toEqual([2099, 5, 6, '試験 二郎']);
    s = { ...s, session: { date: '2099-06-01', inspector: '試験 三郎' } };
    s = saveInitial(s, id, cfg, { force: true }).state;
    const again = s.initials[0];
    expect([again[st.date[0]], again[st.date[1]], again[st.date[2]], again[st.inspector]]).toEqual([2099, 5, 6, '試験 二郎']);
  });
  it('「すべて無」は、詳細（簡易診断から写した寸法など）が入っている弱点の項目を「無」にしない', () => {
    const sec = cfg.initialSurvey.forms.initial.sections.find((x) => x.items.some((it) => it.key === 'b4'));
    const r = fillNone({ b4Detail: '2本、地上3m' }, sec, cfg, () => ['無', '有（小）', '有（大）']);
    expect(r.record.b4).toBeUndefined();
    expect(r.kept).toEqual([sec.items.find((it) => it.key === 'b4').label]);
    // 有無を選んであれば、これまでどおり触らない
    expect(fillNone({ b4: '有（小）', b4Detail: '2本' }, sec, cfg, () => ['無', '有（小）']).kept).toEqual([]);
  });

  it('未入力は現場の選択肢の項目だけ数え、保存で調査日・調査者を記録する', () => {
    let s = startInitial({ ...S([need('AB001')]), session: { date: '2099-05-06', inspector: '試験 二郎(資格)' } }, need('AB001'), cfg).state;
    const id = s.initials[0].id;
    // 不自然な傾斜は簡易診断から引き継いでいるので未入力ではない。枝長/枝径は「後で」の項目なので数えない
    expect(missingInitial(s.initials[0], cfg)).toEqual(['枯れ枝', '気象の影響', '支柱の損傷']);
    const r1 = saveInitial(s, id, cfg);
    expect(r1.saved).toBe(false);
    s = updateInitial(s, id, (r) => ({ ...r, b4: '無', weather: '無', stake: '支柱なし' }));
    const r2 = saveInitial(s, id, cfg, { now: 'u9' });
    expect(r2.saved).toBe(true);
    expect(r2.state.initials[0]).toMatchObject({ done: true, sent: false, year: 2099, month: 5, day: 6, inspector: '試験 二郎(資格)', updatedAt: 'u9' });
  });
});

describe('ブックに入力済みの木の中身', () => {
  it('ブックの行の中身を、場所のコードと番号で引ける（初期・環境をまとめる。行の番号は印として持つ）', async () => {
    const book = await makeInitialBook({ withAB001: true });
    let s = S([need('AB001'), need('AB002')]);
    s = (await importInitialBook(s, 'b.xlsx', book, cfg, '2099-05-06')).state;
    const e = bookEntry(s, s.trees[0], cfg);
    expect(e.initial).toMatchObject({ treeNo: 'AB001', b4: '有（大）', b4Detail: '2本、地上5m', height: 9.5, _sheet: '公園_詳しい診断', _row: 7 });
    expect(e.environment).toMatchObject({ stake: '有', _row: 5 });
    expect(bookValues(e, cfg)).toMatchObject({ b4: '有（大）', height: 9.5, stake: '有', weather: '無' });
    expect(bookValues(e, cfg)).not.toHaveProperty('_row');
    expect(bookValues(e, cfg)).not.toHaveProperty('serial');
    expect(bookEntry(s, s.trees[1], cfg)).toBeNull();
  });

  it('「アプリで入力し直す」は、ブックの値を下書きにする（簡易からの引き継ぎより優先）', async () => {
    let s = S([need('AB001')]);
    s = (await importInitialBook(s, 'b.xlsx', await makeInitialBook({ withAB001: true }), cfg, '2099-05-06')).state;
    const { record } = startInitial(s, s.trees[0], cfg, { force: true });
    expect(record).toMatchObject({ height: 9.5, b4: '有（大）', b4Detail: '2本、地上5m', stake: '有', girth: 0.64, done: false });
    expect(record.fromBook).toContain('height');
    expect(record.inherited).not.toContain('height'); // ブックの値を使ったので「簡易から」ではない
    expect(record.inherited).toContain('girth');
  });
});

describe('データ入力用ブックに書き込む記録の選び方', () => {
  it('入力済みの記録だけ。元の木が対象でなくなった記録は除いて知らせる。サーバーを使うときは確定した記録だけ', () => {
    let s = S([need('AB001'), need('AB002'), need('AB003')], { server: null });
    for (const t of s.trees) s = startInitial(s, t, cfg).state;
    s = saveInitial(s, 'ini:ledger:AB001', cfg, { force: true }).state;
    s = saveInitial(s, 'ini:ledger:AB002', cfg, { force: true }).state; // AB003 は入力中のまま
    s = { ...s, trees: s.trees.map((t) => (t.treeNo === 'AB002' ? { ...t, initialNeeded: '否' } : t)) }; // 後で「不要」に直した
    const r = initialsForBook(s, cfg);
    expect(r.records.map((x) => x.treeNo)).toEqual(['AB001']);
    expect(r.notTarget.map((x) => x.treeNo)).toEqual(['AB002']);

    const withServer = { ...s, server: { ...server } };
    expect(initialsForBook(withServer, cfg).records).toEqual([]);
    expect(initialsForBook(withServer, cfg).excluded.map((x) => x.treeNo)).toEqual(['AB001']);
    expect(initialsForBook(withServer, cfg).notTarget.map((x) => x.treeNo)).toEqual(['AB002']);
    expect(initialsForBook(withServer, cfg, { includeUnconfirmed: true }).records.map((x) => x.treeNo)).toEqual(['AB001']);
  });
});

describe('詳しい診断の入力の取り消し・下書きを消す', () => {
  it('入力済みは未入力に戻す（値は残る・送り直す・確定は外れる・ブックの対象から外れる）。送っていない下書きは消せる', () => {
    let s = startInitial(S([need('AB001', { sent: true, rev: 1 })], { server: null }), need('AB001'), cfg).state;
    const id = s.initials[0].id;
    expect(() => withdrawInitial(s, id)).toThrow('入力済み');
    s = updateInitial(s, id, (r) => ({ ...r, b4: '有（小）' }));
    s = saveInitial(s, id, cfg, { force: true }).state;
    s = { ...s, initials: s.initials.map((r) => ({ ...r, sent: true, rev: 2 })) };
    expect(initialsForBook(s, cfg).records).toHaveLength(1);
    expect(() => discardInitial(s, id)).toThrow('入力済み');

    s = withdrawInitial(s, id, '2099-05-07T00:00:00.000Z');
    expect(s.initials[0]).toMatchObject({ done: false, sent: false, b4: '有（小）', rev: 2 });
    expect(initialsForBook(s, cfg).records).toHaveLength(0);
    expect(initialStatus(s.trees[0], s, cfg)).toBe('draft');
    expect(() => discardInitial(s, id)).toThrow('サーバーに届いている'); // 版があるものは消さない

    const fresh = startInitial(S([need('AB002')]), need('AB002'), cfg).state;
    const gone = discardInitial(fresh, fresh.initials[0].id);
    expect(gone.initials).toEqual([]);
    expect(initialStatus(gone.trees[0], gone, cfg)).toBe('todo');
  });
});

describe('特記事項の寸法の引き継ぎ', () => {
  it('記録を作るとき、特記事項に足した寸法の数字を弱点の詳細へ写し「簡易から」の印を付ける', () => {
    const v = { count: '2', height: { a: '3' }, branchDia: '6', branchLen: '', max: false };
    const line = '枯れ枝：2本、地上3m、枝直径6cm';
    const t = need('AB001', { notes: `・枝の偏り\n・${line}`, measures: [{ kind: 'deadBranch', place: '', values: v, line }] });
    const r = startInitial(S([t]), t, cfg).record;
    expect(r.b4Detail).toBe('2本、地上3m、枝直径6cm');
    expect(r.b4DetailParts).toEqual({ count: '2', height: { a: '3' }, branchDia: '6' });
    expect(r.inherited).toContain('b4Detail');
    expect(r.b4).toBeUndefined(); // 「有」の程度は写さない（人が選ぶ）
  });

  it('寸法の1行がなくても、簡易診断の枯れ枝の本数（種類の prefill）を写す', () => {
    const t = need('AB001', { deadBranch: '有', deadBranchCount: '3' });
    const r = startInitial(S([t]), t, cfg).record;
    expect(r.b4DetailParts).toEqual({ count: '3' });
    expect(r.b4Detail).toBe('3本');
    expect(r.inherited).toContain('b4Detail');
  });

  it('【再現】詳しい診断で直していない項目は、簡易診断の寸法に自動で合わせる（足した・直した・消した）', () => {
    const v = (count) => ({ count, height: { a: '3' } });
    const rec2 = (count) => ({ kind: 'deadBranch', place: '', values: v(count) });
    let t = need('AB001');
    let s = startInitial(S([t]), t, cfg).state;
    let rec = s.initials[0];
    expect(syncMeasures(rec, t, cfg).changed).toEqual([]);
    // 後から寸法を足した（新しい形：寸法は一覧だけ）
    t = { ...t, measuresV: 2, measures: [rec2('2')] };
    let r = syncMeasures(rec, t, cfg);
    expect(r.changed).toEqual(['枯れ枝']);
    rec = r.record;
    expect(rec.b4Detail).toBe('2本、地上3m');
    // 簡易で直した → ついてくる
    t = { ...t, measures: [rec2('4')] };
    rec = syncMeasures(rec, t, cfg).record;
    expect(rec.b4Detail).toBe('4本、地上3m');
    expect(measureStatus(rec, t, cfg)).toEqual([{ key: 'b4Detail', label: '枯れ枝', follow: true, differs: false, simpleText: '4本、地上3m' }]);
    // 詳しい診断で数値を直した → もうついてこない。違えば知らせる
    const mine = { ...rec, b4DetailParts: { count: '5', height: { a: '3' } }, b4Detail: '5本、地上3m' };
    expect(measureStatus(mine, t, cfg)[0]).toMatchObject({ follow: false, differs: true });
    expect(syncMeasures(mine, t, cfg).changed).toEqual([]);
    // 簡易に合わせる
    expect(applyMeasures(mine, t, cfg, ['b4Detail']).b4Detail).toBe('4本、地上3m');
    // 詳細の文を手で直した → ついてこない
    const manual = { ...rec, b4Detail: '手で直した文', b4DetailManual: true };
    expect(syncMeasures(manual, { ...t, measures: [rec2('6')] }, cfg).changed).toEqual([]);
    // 簡易で寸法を消した → ついてきている項目は詳細も消える（本数は簡易の枯れ枝の本数から入る）
    const gone = syncMeasures(rec, { ...t, measures: [], deadBranchCount: '' }, cfg).record;
    expect(gone.b4Detail).toBe('');
    expect(gone.b4DetailParts).toBeUndefined();
  });

  it('【再現】簡易にない数値を初期で足しただけでは「違う」と出さず、「簡易に合わせる」でも消さない', () => {
    const t0 = need('AB001');
    let s = startInitial(S([t0]), t0, cfg).state;
    let t = { ...t0, measuresV: 2, measures: [{ kind: 'deadBranch', place: '', values: { count: '1' } }] };
    let rec = syncMeasures(s.initials[0], t, cfg).record;
    expect(rec.b4Detail).toBe('1本');
    // 初期で高さを足した
    const mine = { ...rec, b4DetailParts: { count: '1', height: { a: '3' } }, b4Detail: '1本、地上3m' };
    expect(measureStatus(mine, t, cfg)[0]).toMatchObject({ follow: false, differs: false });
    // 簡易で本数を変えた → 違いを知らせる。合わせても高さは残す
    t = { ...t, measures: [{ kind: 'deadBranch', place: '', values: { count: '2' } }] };
    expect(measureStatus(mine, t, cfg)[0]).toMatchObject({ follow: false, differs: true });
    const m = applyMeasures(mine, t, cfg, ['b4Detail'], { merge: true });
    expect(m.b4DetailParts).toEqual({ count: '2', height: { a: '3' } });
    expect(m.b4Detail).toBe('2本、地上3m');
    expect(measureStatus(m, t, cfg)[0]).toMatchObject({ follow: false, differs: false });
    // ついてきている項目は、簡易で欄を消せば初期でも消える
    const follow = syncMeasures(rec, { ...t, measures: [{ kind: 'deadBranch', place: '', values: { count: '1', height: { a: '2' } } }] }, cfg).record;
    expect(follow.b4Detail).toBe('1本、地上2m');
    expect(syncMeasures(follow, { ...t, measures: [{ kind: 'deadBranch', place: '', values: { count: '1' } }] }, cfg).record.b4Detail).toBe('1本');
    // 初期で箇所を足しただけも違いにしない
    const two = { ...rec, b4DetailParts: { count: '1', more: [{ count: '3' }] } };
    expect(measureStatus(two, { ...t, measures: [{ kind: 'deadBranch', place: '', values: { count: '1' } }] }, cfg)[0].differs).toBe(false);
    // 簡易にある値を初期で消したのは違い
    const cut = { ...rec, b4DetailParts: { height: { a: '3' } } };
    expect(measureStatus(cut, t, cfg)[0].differs).toBe(true);
  });

  it('【再現】前の形で寸法の1行を手で直しても、初期の詳細が「写す」で消えない（数値が減るだけの書き換えをしない）', () => {
    // 前の形：寸法の1行が特記事項の文字にある。後ろに言葉を足した行は、備考がない設定ではふつうの文と寸法の両方として残す
    const line = '枯れ枝：2本、地上3m';
    const t = need('AB001', { deadBranch: '有', deadBranchCount: '2', notes: `・${line}`, measures: [{ kind: 'deadBranch', place: '', values: { count: '2', height: { a: '3' } }, line }] });
    const s = startInitial(S([t]), t, cfg).state;
    const rec = s.initials[0];
    expect(rec.b4Detail).toBe('2本、地上3m');
    const edited = { ...t, notes: `・${line}、園路上` };
    expect(syncMeasures(rec, edited, cfg).record.b4Detail).toBe('2本、地上3m');
    const v2 = toMeasuresV2(edited, cfg);
    expect(v2.measures).toHaveLength(1);
    expect(syncMeasures(rec, v2, cfg).record.b4Detail).toBe('2本、地上3m');
  });

  it('前の版で作った記録（写した印がない）は、写した値と同じなら合わせ直さない', () => {
    const line = '枯れ枝：2本';
    const t = need('AB001', { notes: `・${line}`, measures: [{ kind: 'deadBranch', place: '', values: { count: '2' }, line }] });
    const { measureSig, ...old } = startInitial(S([t]), t, cfg).record;
    expect(measureSig).toBeTruthy();
    expect(syncMeasures(old, t, cfg).changed).toEqual([]);
    expect(measureStatus(old, t, cfg)[0]).toMatchObject({ follow: true, differs: false });
  });
});

describe('一覧表の健全度への書き戻し', () => {
  it('入力済み（サーバーを使うなら確定）の総合評価が A〜E の木だけ健全度を付ける。処置の違い・台帳の行・結果待ちを知らせる', () => {
    const trees = [need('AB001'), need('AB002'), need('AB003'), T('AB004', { source: 'ledger', done: true, initialNeeded: '要' }), T('AB005', { source: 'app', done: true, initialNeeded: '否', grade: 'B' })];
    let s = S(trees, { server: null });
    for (const t of s.trees.filter((x) => x.initialNeeded === '要')) s = startInitial(s, t, cfg).state;
    const set = (no, v) => {
      const id = s.initials.find((r) => r.treeNo === no).id;
      s = updateInitial(s, id, (r) => ({ ...r, ...v }));
      s = saveInitial(s, id, cfg, { force: true }).state;
    };
    set('AB001', { overall: 'D', treatment: '枯れ枝剪定・縮小剪定' });
    set('AB002', { overall: '-' }); // 「-」は書かない
    set('AB004', { overall: 'C' }); // 台帳の行（紙から手で入力）には健全度だけ書く
    const treatOf = (t) => (t.treeNo === 'AB001' ? '枯れ枝剪定' : '');
    const r = gradeWriteBack(s, cfg, s.trees, { treatOf });
    expect(r.written.map((x) => [x.tree.treeNo, x.grade])).toEqual([['AB001', 'D']]);
    expect(r.trees.find((t) => t.treeNo === 'AB001').initialGrade).toBe('D');
    expect(r.trees.find((t) => t.treeNo === 'AB005')).toBe(s.trees[4]); // 対象でない木はそのまま
    expect(r.treatDiff).toEqual([{ tree: expect.objectContaining({ treeNo: 'AB001' }), simple: '枯れ枝剪定', initial: '枯れ枝剪定・縮小剪定' }]);
    expect(r.ledger.map((x) => [x.tree.treeNo, x.grade])).toEqual([['AB004', 'C']]);
    expect(r.trees.find((t) => t.treeNo === 'AB004').initialGrade).toBe('C');
    expect(r.pending.map((t) => t.treeNo)).toEqual(['AB002', 'AB003']);

    // サーバーを使うときは確定した記録だけ
    expect(gradeWriteBack({ ...s, server: { ...server } }, cfg, s.trees, { treatOf }).written).toEqual([]);
    // 処置が同じ（書き方の違いだけ）なら知らせない
    expect(gradeWriteBack(s, cfg, s.trees, { treatOf: () => '枯れ枝剪定，縮小剪定' }).treatDiff).toEqual([]);
    // 設定がなければ何もしない
    const c = structuredClone(cfgJson);
    delete c.initialSurvey.gradeWriteBack;
    expect(gradeWriteBack(s, c, s.trees).trees).toBe(s.trees);
  });
});

describe('空欄のときに入れる値（blank）', () => {
  it('保存したとき、空欄の項目に blank の値を入れる（入っていれば変えない）', () => {
    let s = startInitial(S([need('AB001'), need('AB002')]), need('AB001'), cfg).state;
    s = startInitial(s, need('AB002'), cfg).state;
    const [a, b] = s.initials.map((r) => r.id);
    s = updateInitial(s, b, (r) => ({ ...r, clearWalk: 2.5 }));
    s = saveInitial(s, a, cfg, { force: true }).state;
    s = saveInitial(s, b, cfg, { force: true }).state;
    expect(s.initials.map((r) => r.clearWalk)).toEqual(['-', 2.5]);
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[0].items[2].blank = 3;
    expect(validateConfig(c).errors.join()).toContain('blank');
  });
});

describe('開口空洞の有無の選択肢を、簡易診断の寸法から決める（項目の valueFrom）', () => {
  it('記録を作るとき・簡易の寸法に合わせるときに、有無の選択肢も入れる', () => {
    const c = structuredClone(cfgJson);
    c.noteMeasures.kinds.push({ key: 'cavity', label: '開口空洞', parts: ['height', 'circ', 'core'] });
    const dp = c.initialSurvey.detailParts;
    dp.circ = { type: 'pair', label: '周囲長', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3' } };
    dp.coreReach = { type: 'flag', label: '芯達', text: '（芯達）', noText: true };
    c.initialSurvey.forms.initial.sections[1].items.push({
      key: 't1', label: '開口空洞', type: 'weak', parts: ['height', 'circ', 'coreReach'],
      valueFrom: { ratio: 'circ', core: 'coreReach', values: { lt: '有（周囲＜1/3）', ge: '有（周囲≧1/3）', coreLt: '有（芯到達・周囲＜1/3）', coreGe: '有（芯到達・周囲≧1/3）' } },
    });
    c.initialSurvey.fromMeasures.push({ kind: 'cavity', item: 't1', parts: { height: 'height', circ: 'circ', core: 'coreReach' } });
    expect(validateConfig(c).errors).toEqual([]);
    const m = (values) => measureRecord('cavity', '幹', values, measureLine(c, 'cavity', '幹', values));
    const tree = need('AB001', { measuresV: 2, measures: [m({ height: { a: '1' }, circ: { a: '40', b: '150' }, core: true })] });
    const s = startInitial(S([tree]), tree, c).state;
    expect(s.initials[0].t1).toBe('有（芯到達・周囲＜1/3）');
    expect(s.initials[0].t1Detail).toBe('地上1m');
    // 簡易で周囲長を直す → 合わせると選択肢も変わる
    const tree2 = { ...tree, measures: [m({ height: { a: '1' }, circ: { a: '60', b: '150' }, core: false })] };
    expect(syncMeasures(s.initials[0], tree2, c).record.t1).toBe('有（周囲≧1/3）');
  });
});

describe('詳しい診断の芯達／芯未達を選んでいない「有」の項目は、保存の前に注意する', () => {
  it('「有」の項目だけ。箇所が2つ以上なら番号を付ける', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.core.required = true;
    c.initialSurvey.detailParts.core.offLabel = '芯未達';
    const sec = c.initialSurvey.forms.initial.sections[1];
    sec.items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size', 'core'] });
    expect(validateConfig(c).errors).toEqual([]);
    const name = `${sec.title.split('・').pop()}の腐朽`;
    expect(initialWarnings({ t2: '有（小）', t2DetailParts: { height: { a: '1' } } }, null, c)).toEqual([`${name}：芯達か芯未達かを選んでください`]);
    expect(initialWarnings({ t2: '有（小）', t2DetailParts: { height: { a: '1' }, core: false } }, null, c)).toEqual([]);
    expect(initialWarnings({ t2: '有（小）', t2DetailParts: { height: { a: '1' }, core: true, more: [{ height: { a: '2' } }] } }, null, c)).toEqual([`${name}：②の芯達か芯未達かを選んでください`]);
    expect(initialWarnings({ t2: '無' }, null, c)).toEqual([]);
  });
});

describe('簡易診断の特記事項が詳しい診断に反映されているか（noteCheck）。画面の一覧と保存の前の注意', () => {
  const cfgOf = () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 's2', label: '露出根の腐朽', type: 'weak' }, { key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size', 'name'] });
    c.initialSurvey.noteCheck = [
      { notes: ['根元の割れ'], items: ['s2', 'stake'] },
      { field: 'fungusName', items: ['t2'] },
    ];
    return c;
  };
  const tree = (o = {}) => need('AB001', { notes: '・根元の割れ\n・枝の偏り\n・南側にベンチ', ...o });

  it('定型文：対応する項目のどれかが「有」（選択肢の項目は「無」以外）なら反映済み。対応がない定型文・手で書いた行は判断しない', () => {
    const c = cfgOf();
    expect(validateConfig(c).errors).toEqual([]);
    const r = simpleNotesStatus({ s2: '無' }, tree(), c);
    expect(r.map((x) => [x.text, x.state])).toEqual([
      ['根元の割れ', 'missing'],
      ['枝の偏り', 'free'],
      ['南側にベンチ', 'free'],
    ]);
    expect(simpleNotesStatus({ stake: '有' }, tree(), c)[0].state).toBe('ok');
    expect(initialWarnings({ s2: '無' }, tree(), c).some((w) => w.includes('根元の割れ'))).toBe(true);
    expect(initialWarnings({ s2: '有（小）' }, tree(), c).some((w) => w.includes('根元の割れ'))).toBe(false);
  });

  it('⑦の名前（寸法なし）：詳しい診断の項目の詳細の文にあれば反映済み。「有」のときだけ見る', () => {
    const c = cfgOf();
    const t = tree({ fungus: '有', fungusName: 'ツヨイタケ' });
    const miss = simpleNotesStatus({}, t, c).find((x) => x.kind === 'field');
    expect(miss).toMatchObject({ state: 'missing', text: 'キノコの名前：ツヨイタケ（寸法なし）' });
    expect(simpleNotesStatus({ t2Detail: '地上1m、ツヨイタケ' }, t, c).find((x) => x.kind === 'field').state).toBe('ok');
    expect(simpleNotesStatus({}, { ...t, fungus: '無' }, c).find((x) => x.kind === 'field')).toBeUndefined();
  });

  it('寸法の1行：写す規則があれば写る項目、なければ「写す項目がありません」（注意にはしない）', () => {
    const c = cfgOf();
    const v = { height: { a: '1' } };
    const ms = [measureRecord('decay', '幹', v, measureLine(c, 'decay', '幹', v))];
    const r = simpleNotesStatus({}, need('AB001', { notes: '', measuresV: 2, measures: ms }), c);
    expect(r).toEqual([{ text: ms[0].line, kind: 'measure', state: 'none', note: `${c.initialSurvey.label}に写す項目がありません` }]);
    expect(initialWarnings({}, need('AB001', { notes: '', measuresV: 2, measures: ms }), c).join()).not.toContain(ms[0].line);
  });

  it('形の違う設定は使わない', () => {
    const c = cfgOf();
    c.initialSurvey.noteCheck = [{ notes: ['ない定型文'], items: ['s2'] }];
    expect(validateConfig(c).errors.join()).toContain('noteCheck[0].notes');
    c.initialSurvey.noteCheck = [{ notes: ['根元の割れ'], items: ['nokey'] }];
    expect(validateConfig(c).errors.join()).toContain('noteCheck[0].items');
    c.initialSurvey.noteCheck = [{ notes: ['根元の割れ'], field: 'fungusName', items: ['s2'] }];
    expect(validateConfig(c).errors.join()).toContain('noteCheck[0]');
  });
});

describe('noteCheck の alias：表記の違う名前を同じとみなす', () => {
  it('「不明種」は詳細の「不明」でも反映済み', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak' });
    c.initialSurvey.noteCheck = [{ field: 'fungusName', items: ['t2'], alias: { 不明種: ['不明'] } }];
    expect(validateConfig(c).errors).toEqual([]);
    const t = need('AB001', { fungus: '有', fungusName: '不明種' });
    expect(simpleNotesStatus({ t2Detail: '30cm×15cm、不明' }, t, c).find((x) => x.kind === 'field').state).toBe('ok');
  });
});
