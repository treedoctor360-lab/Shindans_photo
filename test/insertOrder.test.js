// 差し込み（この木の次・この木の前）・番号の振り直し・別の路線へ移す（架空の路線）
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { addTree, moveTrees, renumberGroup, setAddedPlace, currentGroupTrees } from '../src/store/actions.js';
import { groupKey } from '../src/core/groups.js';
import { placeAdded } from '../src/store/order.js';
import { simpleKey } from '../src/store/surveys.js';

const cfg = { ...structuredClone(cfgJson), numbering: { start: 1, carry: ['species'] } };
const nameKey = cfg.dbFormat.sheets.find((x) => x.type === 'park').identify;
const site = (name) => ({ siteType: 'park', [nameKey]: name });

// 路線 A に「保存してもう1本追加」で n 本（1本目の次、その次…と after がつながる。この業務と同じ形）
function route(n, name = 'A', start = 1000) {
  let s = { trees: [{ id: `${name}1`, uid: `d-${name}1`, treeNo: '1', ...site(name), done: true, rev: 1 }], server: {}, group: '', currentId: `${name}1` };
  s.group = groupKey(s.trees[0], cfg);
  for (let i = 1; i < n; i++) s = addTree(s, cfg, { afterId: s.currentId, now: start + i });
  return s;
}
const nos = (s) => currentGroupTrees(s, cfg).map((t) => t.treeNo || '空').join(',');

describe('差し込み', () => {
  it('この木の次に：途中に入れても、すぐ次に並ぶ（後ろの木はその次へ付け替える）', () => {
    let s = route(4);
    const one = currentGroupTrees(s, cfg)[0];
    s = addTree(s, cfg, { afterId: one.id, now: 2000 });
    expect(nos(s)).toBe('1,空,2,3,4');
    // 並び直しても（受け取り・読み込みのあと）同じ並び
    expect(placeAdded(s.trees, cfg).map((t) => t.treeNo || '空').join(',')).toBe('1,空,2,3,4');
    // 付け替えた入力済みの木は送り直す
    const two = currentGroupTrees(s, cfg)[2];
    expect(two.after).toBe(simpleKey(currentGroupTrees(s, cfg)[1], cfg));
  });

  it('この木の前に：先頭の前に5本入れる（番号は空欄。保存してもう1本追加で続ける）', () => {
    let s = route(3);
    const first = currentGroupTrees(s, cfg)[0];
    s = addTree(s, cfg, { beforeId: first.id, now: 2000 });
    for (let i = 1; i < 5; i++) s = addTree(s, cfg, { afterId: s.currentId, now: 2000 + i });
    expect(nos(s)).toBe('空,空,空,空,空,1,2,3');
    expect(placeAdded(s.trees, cfg).map((t) => t.treeNo || '空').join(',')).toBe('空,空,空,空,空,1,2,3');
    expect(s.trees.find((t) => t.id === first.id).sent).toBe(false); // 元の1番は並びが変わったので送り直す
  });

  it('この木の前に：途中の木の前', () => {
    let s = route(3);
    const three = currentGroupTrees(s, cfg)[2];
    s = addTree(s, cfg, { beforeId: three.id, now: 2000 });
    expect(nos(s)).toBe('1,2,空,3');
  });

  it('並びの選び直しでも、選んだ木のすぐ次に並ぶ（元の位置は詰める）', () => {
    let s = route(4);
    const [one, , , four] = currentGroupTrees(s, cfg);
    s = setAddedPlace(s, cfg, four.id, one.id);
    expect(nos(s)).toBe('1,4,2,3');
    expect(placeAdded(s.trees, cfg).map((t) => t.treeNo).join(',')).toBe('1,4,2,3');
  });
});

describe('番号を並び順に振り直す', () => {
  it('先頭に5本足したあと：入れた木が1〜5、元の1が6', () => {
    let s = route(3);
    s = addTree(s, cfg, { beforeId: currentGroupTrees(s, cfg)[0].id, now: 2000 });
    for (let i = 1; i < 5; i++) s = addTree(s, cfg, { afterId: s.currentId, now: 2000 + i });
    const r = renumberGroup(s, cfg, 'now');
    expect(r.error).toBe('');
    expect(nos(r.state)).toBe('1,2,3,4,5,6,7,8');
    expect(r.changes.filter((c) => c.from).map((c) => `${c.from}→${c.to}`)).toEqual(['1→6', '2→7', '3→8']);
    expect(r.state.trees.find((t) => t.treeNo === '6').sent).toBe(false);
    expect(renumberGroup(r.state, cfg).changes).toEqual([]); // もう振り直すものはない
  });

  it('削除した木は数えない。一覧表の行に結び付いた木があればしない', () => {
    let s = route(3);
    const two = currentGroupTrees(s, cfg)[1];
    s = { ...s, trees: s.trees.map((t) => (t.id === two.id ? { ...t, deleted: true } : t)) };
    expect(nos(renumberGroup(s, cfg).state)).toBe('1,2,2'); // 削除した2はそのまま、3→2
    const bound = { ...s, trees: s.trees.map((t, i) => (i === 0 ? { ...t, ledgerRow: 5 } : t)) };
    expect(renumberGroup(bound, cfg).error).toMatch(/一覧表/);
  });
});

describe('別の路線へ移す', () => {
  it('この木から後ろすべてを、移す先の最後に続き番号で。元の路線は詰まる', () => {
    let a = route(5, 'A');
    let b = route(2, 'B', 5000);
    let s = { ...a, trees: [...a.trees, ...b.trees] };
    const three = currentGroupTrees(s, cfg)[2];
    const r = moveTrees(s, cfg, { id: three.id, rest: true, values: site('B'), now: 'now' });
    expect(r.error).toBe('');
    expect(r.moved).toHaveLength(3);
    expect(nos(r.state)).toBe('1,2,3,4,5'); // 移す先（B）の 1,2 の後ろに 3,4,5
    expect(nos({ ...r.state, group: groupKey(site('A'), cfg) })).toBe('1,2');
    expect(placeAdded(r.state.trees, cfg).filter((t) => t[nameKey] === 'B').map((t) => t.treeNo).join(',')).toBe('1,2,3,4,5');
    expect(r.state.group).toBe(groupKey(site('B'), cfg));
  });

  it('この木だけ：元の路線の後ろの木はつなぎ直す', () => {
    let a = route(4, 'A');
    const two = currentGroupTrees(a, cfg)[1];
    const r = moveTrees(a, cfg, { id: two.id, values: site('C'), now: 'now' });
    expect(nos({ ...r.state, group: groupKey(site('A'), cfg) })).toBe('1,3,4');
    expect(placeAdded(r.state.trees, cfg).filter((t) => t[nameKey] === 'A').map((t) => t.treeNo).join(',')).toBe('1,3,4');
    expect(nos(r.state)).toBe('1'); // 新しい路線 C の1本目
    expect(moveTrees(a, cfg, { id: two.id, values: site('A') }).error).toMatch(/同じ/);
  });
});
