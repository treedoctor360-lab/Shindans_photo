// デスクトップ表示の一覧表（1本1行）の中身
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { initialState, migrate } from '../src/store/state.js';
import { startInitial } from '../src/store/initial.js';
import { checksOf, flagsOf } from '../src/ui/overview.js';

const cfg = structuredClone(cfgJson);
const T = (o = {}) => blankTree({ id: 'a', treeNo: 'AB001', siteType: 'park', parkCode: 'K01', parkName: '架空公園', ledgerRow: { sheet: 's', row: 3 }, ...o });
const S = (trees, o = {}) => ({ ...migrate(initialState()), trees, ...o });

describe('有の項目', () => {
  it('「有」のものだけを程度・本数・種名と並べ、選んでいない項目は番号で返す', () => {
    const t = T({ lean: '無', deadBranch: '有', deadBranchCount: '3', decay: '小', fungus: '' });
    const { yes, blank } = checksOf(t, cfg);
    const label = (k) => cfg.checks.find((c) => c.key === k).label;
    expect(yes).toEqual([`${label('deadBranch')}(3)`, `${label('decay')}(小)`]);
    expect(blank).toEqual([label('fungus')]); // 丸数字のない見出しは見出しのまま
  });
  it('すべて「無」なら空', () => {
    const t = T(Object.fromEntries(cfg.checks.map((c) => [c.key, '無'])));
    expect(checksOf(t, cfg)).toEqual({ yes: [], blank: [] });
  });
});

describe('注意の印', () => {
  it('印なし：未入力の木', () => {
    expect(flagsOf(T(), S([T()]), cfg)).toEqual([]);
  });
  it('入力済みで入れていない項目があれば「未記入」', () => {
    const t = T({ source: 'app', done: true, species: '' });
    expect(flagsOf(t, S([t]), cfg)[0][0]).toBe('未記入');
  });
  it('詳しい診断の下書き・簡易の特記事項が未反映', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.noteCheck = [{ notes: ['根元の割れ'], items: ['b4'] }];
    const t = T({ source: 'app', done: true, initialNeeded: '要', species: 'テストノキ', height: '10', girths: ['0.5'], notes: '・根元の割れ' });
    const s = startInitial(S([t]), t, c).state;
    const f = flagsOf(t, s, c).map((x) => x[0]);
    expect(f).toContain('未反映1');
    expect(f).toContain('初期未完了');
  });
  it('【再現】詳しい診断を「否」に変えた木は、残っている記録の注意を出さない', () => {
    const t = T({ source: 'app', done: true, initialNeeded: '要', species: 'テストノキ', height: '10', girths: ['0.5'] });
    const s = startInitial(S([t]), t, cfg).state;
    const no = { ...t, initialNeeded: '否' };
    expect(flagsOf(no, { ...s, trees: [no] }, cfg).map((x) => x[0])).not.toContain('初期未完了');
  });
  it('食い違い・付箋', () => {
    const t = T({ source: 'app', done: true, conflict: { rev: 3, data: {} } });
    expect(flagsOf(t, S([t]), cfg).map((x) => x[0])).toContain('食い違い');
  });
});
