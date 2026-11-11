// 画面の操作（一覧・入力）で状態を変える処理のテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { groupKey, groupKeys, groupLabel } from '../src/core/groups.js';
import { blankTree } from '../src/core/tree.js';
import { initialState } from '../src/store/state.js';
import { addGroup, addTree, fillChecksNone, normalizeField, nextTodo, pressAlertAction, pressOption, saveTree, toggleTreat, nextTreeNo } from '../src/store/actions.js';

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

describe('【再現】入力済みの木を後日直しても、元の調査日・調査者のまま（PI0945 の件）', () => {
  it('初めて保存したときだけ今の調査日・調査者を入れ、入力済みの木を直して保存しても変えない', () => {
    const t = P('a', full);
    let s = state([t, P('b')]);
    s = saveTree(s, cfg, { after: 'stay' }).state;
    expect(s.trees[0]).toMatchObject({ date: '2099-05-06', inspector: '試験 二郎' });
    // 別の日・別の人の端末で直す
    s = { ...s, session: { date: '2099-06-01', inspector: '試験 三郎' }, trees: s.trees.map((x) => (x.id === 'a' ? { ...x, height: '9' } : x)) };
    s = saveTree(s, cfg, { after: 'stay' }).state;
    expect(s.trees[0]).toMatchObject({ height: '9', date: '2099-05-06', inspector: '試験 二郎' });
    // 入力の取り消しで未入力に戻した木を保存し直すときは、今の調査日・調査者
    s = { ...s, trees: s.trees.map((x) => (x.id === 'a' ? { ...x, done: false } : x)) };
    s = saveTree(s, cfg, { after: 'stay' }).state;
    expect(s.trees[0]).toMatchObject({ date: '2099-06-01', inspector: '試験 三郎' });
  });
});

describe('まとまりを現地で足す・番号を順に振る（設定 addGroups・numbering。台帳なしで使う）', () => {
  const cfg2 = {
    ...structuredClone(cfgJson),
    numbering: { start: 1, carry: ['species'] },
    addGroups: { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }, { key: 'routeNo', label: '路線番号' }] },
  };
  const empty = () => ({ ...initialState(), session: { date: '2099-05-06', inspector: '試験 二郎' } });

  it('設定の検証：今までの設定はそのまま通り、足した項目の誤りは断る', () => {
    expect(validateConfig(cfg2).errors).toEqual([]);
    expect(validateConfig({ ...cfg2, addGroups: { siteType: 'nowhere', fields: [{ key: 'routeName', label: '路線名' }] } }).ok).toBe(false);
    expect(validateConfig({ ...cfg2, addGroups: { siteType: 'street', fields: [{ key: 'routeNo', label: '路線番号' }] } }).ok).toBe(false); // 名前の項目がない
    expect(validateConfig({ ...cfg2, numbering: { start: -1 } }).ok).toBe(false);
  });

  it('台帳がなくても路線を足せ、1本目の木が番号1で開く', () => {
    const r = addGroup(empty(), cfg2, { routeName: '架空通り', routeNo: '７' }, 1);
    expect([r.error, r.exists]).toEqual(['', false]);
    expect(r.state.trees).toHaveLength(1);
    expect(r.state.trees[0]).toMatchObject({ siteType: 'street', routeName: '架空通り', routeNo: '7', treeNo: '1', done: false });
    expect(r.state.trees[0].uid).toBeTruthy(); // 追加した木の印（番号を後で直しても同じ木）
    expect([r.state.group, r.state.view, r.state.currentId]).toEqual(['street:架空通り', 'form', 'new:1']);
  });

  it('名前がなければ足さず、同じ名前の路線があればその路線を開くだけ', () => {
    expect(addGroup(empty(), cfg2, { routeNo: '7' }, 1)).toMatchObject({ error: '路線名を入れてください' });
    const one = addGroup(empty(), cfg2, { routeName: '架空通り' }, 1).state;
    const again = addGroup({ ...one, view: 'settings' }, cfg2, { routeName: '架空通り' }, 2);
    expect(again.exists).toBe(true);
    expect(again.state.trees).toHaveLength(1);
    expect([again.state.group, again.state.view]).toEqual(['street:架空通り', 'list']);
  });

  it('路線ごとに1から振る。「保存してもう1本追加」で次の番号と前の木の樹種が入る', () => {
    let s = addGroup(empty(), cfg2, { routeName: '架空通り' }, 1).state;
    s = { ...s, trees: s.trees.map((t) => ({ ...t, ...full, species: 'テストノキ' })) };
    s = saveTree(s, cfg2, { after: 'add', now: '2099-05-06T01:00:00.000Z' }).state;
    expect(s.trees.map((t) => [t.treeNo, t.species])).toEqual([['1', 'テストノキ'], ['2', 'テストノキ']]);
    // 別の路線はまた1から
    s = addGroup(s, cfg2, { routeName: '別の通り' }, 5).state;
    expect(s.trees.at(-1)).toMatchObject({ routeName: '別の通り', treeNo: '1', species: '' });
  });

  it('途中に差し込む木は番号を空欄にする（後ろの番号は振り直さない）。枝番・消した木は数えない', () => {
    const R = (id, no, o = {}) => blankTree({ id, uid: id, treeNo: no, species: 'テストノキ', siteType: 'street', routeName: '架空通り', ...o });
    const s = { ...empty(), trees: [R('a', '1'), R('b', '2'), R('c', '2-1'), R('d', '9', { deleted: true })], group: 'street:架空通り' };
    expect(nextTreeNo(s.trees.filter((t) => !t.deleted), cfg2)).toBe('3');
    const mid = addTree(s, cfg2, { now: 7, afterId: 'a' });
    expect(mid.trees.find((t) => t.id === 'new:7')).toMatchObject({ treeNo: '', species: 'テストノキ' });
    expect(mid.trees.filter((t) => t.id !== 'new:7').map((t) => t.treeNo)).toEqual(['1', '2', '2-1', '9']);
    const end = addTree(s, cfg2, { now: 8 });
    expect(end.trees.find((t) => t.id === 'new:8').treeNo).toBe('3');
  });

  it('numbering のない設定では今までどおり（番号は空欄・樹種は写さない）', () => {
    const s = { ...empty(), trees: [P('a')], group: groupKey(P('a'), cfg) };
    expect(addTree(s, cfg, { now: 1 }).trees[1]).toMatchObject({ treeNo: '', species: '' });
  });
});

describe('計測に足す欄（設定 extraFields）', () => {
  const extraFields = [
    { key: 'spread', label: '枝張り', unit: 'm', numeric: true },
    { key: 'clearWalk', label: '枝下高（歩道）', unit: 'm', numeric: true },
    { key: 'memoX', label: '覚え' },
  ];
  const cfg3 = { ...structuredClone(cfgJson), extraFields };

  it('設定の検証：ほかの項目と同じ名前・重なった名前・英数字でない名前は断る', () => {
    expect(validateConfig(cfg3).errors).toEqual([]);
    const bad = (list) => validateConfig({ ...cfg3, extraFields: list }).ok;
    expect(bad([{ key: 'height', label: '樹高' }])).toBe(false); // 木の記録がもともと使う名前
    expect(bad([{ key: cfg.checks[0].key, label: '点検項目' }])).toBe(false);
    expect(bad([{ key: 'parkName', label: '場所の情報' }])).toBe(false);
    expect(bad([{ key: 'spread', label: 'a' }, { key: 'spread', label: 'b' }])).toBe(false);
    expect(bad([{ key: '枝張り', label: '枝張り' }])).toBe(false);
    expect(bad([{ key: 'spread' }])).toBe(false);
  });

  it('入力を確定したとき：数の欄は半角に、文字の欄は前後の空白を取る', () => {
    const t = { ...P('a'), spread: ' ３．５ ', memoX: ' 車道側 ' };
    expect(normalizeField(t, 'spread', cfg3).spread).toBe('3.5');
    expect(normalizeField(t, 'memoX', cfg3).memoX).toBe('車道側');
    expect(normalizeField(t, 'spread', cfg).spread).toBe(' ３．５ '); // 設定にない欄は触らない
  });
});

describe('健全度を現場で付けない業務（設定 noGrade）', () => {
  it('健全度が空欄でも未入力にしない。選択肢は空の一覧でよい', async () => {
    const { missingFields } = await import('../src/core/rules.js');
    const t = P('a', { ...full, grade: '' });
    expect(missingFields(t, cfg)).toContain(cfg.gradeLabel);
    const cfg4 = { ...structuredClone(cfgJson), noGrade: true };
    expect(missingFields(t, cfg4)).toEqual([]);
    cfg4.options.grade = [];
    expect(validateConfig(cfg4).errors).toEqual([]);
    expect(validateConfig({ ...cfg4, noGrade: false }).ok).toBe(false);
  });
});

describe('まとまりを名前のほかの項目でも分ける（dbFormat.sheets の identifyAlso）', () => {
  const cfg5 = structuredClone(cfgJson);
  cfg5.dbFormat.sheets = cfg5.dbFormat.sheets.map((x) => (x.type === 'street' ? { ...x, identifyAlso: ['routeNo', 'region'] } : x));
  if (!cfg5.dbFormat.infoKeys.includes('region')) cfg5.dbFormat.infoKeys.push('region');
  cfg5.dbFormat.columns.region = cfg5.dbFormat.columns.region || '^区域$';
  cfg5.numbering = { start: 1 };
  cfg5.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }, { key: 'routeNo', label: '路線番号' }, { key: 'region', label: '区域' }] };
  const empty = () => ({ ...initialState(), session: { date: '2099-05-06', inspector: '試験 二郎' } });

  it('同じ路線名でも、路線番号が違えば別の路線として足せる。同じ番号でも区域が違えば別', () => {
    expect(validateConfig(cfg5).errors).toEqual([]);
    let s = addGroup(empty(), cfg5, { routeName: '架空', routeNo: '223' }, 1).state;
    const r2 = addGroup(s, cfg5, { routeName: '架空', routeNo: '318' }, 2);
    expect([r2.error, r2.exists]).toEqual(['', false]);
    s = r2.state;
    const r3 = addGroup(s, cfg5, { routeName: '架空', routeNo: '223', region: '別の区域' }, 3);
    expect(r3.exists).toBe(false);
    s = r3.state;
    expect(groupKeys(s.trees, cfg5)).toHaveLength(3);
    expect(s.trees.map((t) => t.treeNo)).toEqual(['1', '1', '1']); // どれも 1 から
    // 全く同じ（名前・番号・区域）なら足さずに開く
    expect(addGroup(s, cfg5, { routeName: '架空', routeNo: '318' }, 4).exists).toBe(true);
    // 表示名に番号と区域が出る
    const k = groupKey(s.trees[2], cfg5);
    expect(groupLabel(s.trees, k, cfg5)).toBe(`[${cfg5.dbFormat.sheets.find((x) => x.type === 'street').label}] 223 架空 別の区域`);
  });

  it('identifyAlso のない設定では今までどおり（名前だけで分ける）', () => {
    const s = addGroup(empty(), { ...cfgJson, numbering: { start: 1 }, addGroups: cfg5.addGroups }, { routeName: '架空', routeNo: '223' }, 1).state;
    expect(addGroup(s, { ...cfgJson, addGroups: cfg5.addGroups }, { routeName: '架空', routeNo: '318' }, 2).exists).toBe(true);
  });

  it('設定の検証：名前の項目や場所の情報にない項目は断る', () => {
    const bad = (also) => validateConfig({ ...cfg5, dbFormat: { ...cfg5.dbFormat, sheets: cfg5.dbFormat.sheets.map((x) => (x.type === 'street' ? { ...x, identifyAlso: also } : x)) } }).ok;
    expect(bad(['routeName'])).toBe(false);
    expect(bad(['nowhere'])).toBe(false);
  });
});

describe('一覧から選ぶまとまり（addGroups.presets）', () => {
  const ag = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }, { key: 'routeNo', label: '路線番号' }] };
  const cfg6 = { ...structuredClone(cfgJson), numbering: { start: 1 }, addGroups: { ...ag, presets: [{ label: '0318 架空', values: { routeName: '架空', routeNo: '0318' }, tree: { species: 'テストノキ' }, count: 26 }] } };

  it('設定の検証：fields にない項目・名前のない一覧・樹種以外の tree は断る', () => {
    expect(validateConfig(cfg6).errors).toEqual([]);
    const bad = (p) => validateConfig({ ...cfg6, addGroups: { ...ag, presets: [p] } }).ok;
    expect(bad({ label: 'x', values: { routeName: 'a', nowhere: 'b' } })).toBe(false);
    expect(bad({ label: 'x', values: { routeNo: '1' } })).toBe(false);
    expect(bad({ label: 'x', values: { routeName: 'a' }, tree: { height: '5' } })).toBe(false);
    expect(bad({ label: 'x', values: { routeName: 'a' }, count: -1 })).toBe(false);
  });

  it('選んだまとまりの樹種を、1本目の木に入れる', () => {
    const p = cfg6.addGroups.presets[0];
    const r = addGroup({ ...initialState(), session: { date: '2099-05-06', inspector: '試験' } }, cfg6, p.values, 1, p.tree);
    expect(r.state.trees[0]).toMatchObject({ routeName: '架空', routeNo: '0318', treeNo: '1', species: 'テストノキ' });
  });
});
