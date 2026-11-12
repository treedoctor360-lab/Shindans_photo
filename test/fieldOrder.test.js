// 野帳の並びに合わせる設定（点検項目の place・always、initial.afterCheck）と、出力の見出し
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree, isCheckKey } from '../src/core/tree.js';
import { missingFields } from '../src/core/rules.js';
import { columns } from '../src/excel/listColumns.js';
import { dbValues } from '../src/excel/dbExport.js';

const base = structuredClone(cfgJson);
const [first, second, ...rest] = base.checks.map((c) => c.key);
const cfg = {
  ...structuredClone(cfgJson),
  checks: base.checks.map((c, i) => (i === 0 ? { ...c, place: 'measure' } : i === base.checks.length - 1 ? { ...c, always: true } : c)),
  initial: { ...base.initial, afterCheck: second },
  extraFields: [{ key: 'spread', label: '枝張り', unit: 'm', numeric: true }],
};
const lastKey = base.checks.at(-1).key;

describe('野帳の並びに合わせる設定', () => {
  it('設定の検証：今の設定はそのまま通り、誤った指定は断る', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const withCheck = (o) => validateConfig({ ...cfg, checks: cfg.checks.map((c, i) => (i === 1 ? { ...c, ...o } : c)) }).ok;
    expect(withCheck({ place: 'top' })).toBe(false);
    expect(withCheck({ always: 'yes' })).toBe(false);
    // measure：noteMeasures の種類と、入れられる値
    expect(withCheck({ measure: { kinds: ['decay'], eq: '有' } })).toBe(true);
    expect(withCheck({ measure: { kinds: ['decay', 'rod'], eq: ['小', '有'] } })).toBe(true);
    expect(withCheck({ measure: { kinds: ['nowhere'], eq: '有' } })).toBe(false);
    expect(withCheck({ measure: { kinds: [], eq: '有' } })).toBe(false);
    expect(withCheck({ measure: { kinds: ['decay'] } })).toBe(false);
    expect(validateConfig({ ...cfg, noteMeasures: undefined, checks: cfg.checks.map((c, i) => (i === 1 ? { ...c, measure: { kinds: ['decay'], eq: '有' } } : c)) }).ok).toBe(false);
    expect(validateConfig({ ...cfg, initial: { ...cfg.initial, afterCheck: 'nowhere' } }).ok).toBe(false);
    expect(validateConfig({ ...cfg, initial: { ...cfg.initial, afterCheck: first } }).ok).toBe(false); // 計測の区切りに出す項目の次には置けない
  });

  it('always の点検項目は、枯死の木でも空欄にせず、未入力なら知らせる', () => {
    expect(isCheckKey(first, cfg)).toBe(true);
    expect(isCheckKey(lastKey, cfg)).toBe(false);
    const dead = blankTree({ treeNo: 'X1', species: 'テストノキ', height: '5', girths: ['0.5'], vigor: cfg.deadVigor, initialNeeded: cfg.initial.no, grade: 'E' });
    const miss = missingFields(dead, cfg);
    expect(miss).toContain(cfg.checks.at(-1).label);
    expect(miss).not.toContain(cfg.checks[1].label);
    // 一覧表に書く値：always の項目は枯死でも書き、ほかの点検項目は空欄
    const v = cfg.options[lastKey][0];
    const other = rest[0];
    const fmt = { ...cfg.dbFormat, columns: { ...cfg.dbFormat.columns, [lastKey]: '^A$', [other]: '^B$' }, writeKeys: [lastKey, other] };
    const vals = dbValues({ ...dead, [lastKey]: v, [other]: cfg.options[other][0] }, { ...cfg, dbFormat: fmt });
    expect(vals[lastKey]).toBe(v);
    expect(vals[other]).toBe(null);
  });
});

describe('出力の見出し（一覧表形式・入力内容の一覧）', () => {
  const fmt = {
    ...cfg.dbFormat,
    columns: { ...cfg.dbFormat.columns, spread: '^W$', branchLen: '^枝長$', branchDia: '^枝径$', [cfg.details[0].field]: '^詳細$' },
  };
  fmt.writeKeys = [...fmt.writeKeys, 'spread', 'branchLen', 'branchDia', cfg.details[0].field];
  const c2 = { ...cfg, dbFormat: fmt };
  const site = c2.dbFormat.sheets[0].type;

  it('計測に足した欄・「有」のとき入れる項目・枝長・枝径も日本語の見出しになる（英字の名前を出さない）', () => {
    const cols = columns(c2, site, null, [blankTree({ treeNo: '1', ledgerRow: 5 })]);
    const head = Object.fromEntries(cols);
    expect(head.spread).toBe('枝張り(m)');
    expect(head.branchLen).toBe('枝長(cm)');
    expect(head.branchDia).toBe('枝径(cm)');
    expect(head[cfg.details[0].field]).toBe(cfg.details[0].label);
    for (const [k, l] of cols) expect(l, k).not.toMatch(/^[A-Za-z]+$/);
  });

  it('台帳の行の木が1本もなければ、通し番号の列を出さない', () => {
    const serial = c2.dbFormat.serialKey;
    expect(columns(c2, site, null, [blankTree({ treeNo: '1', ledgerRow: 5 })]).map(([k]) => k)).toContain(serial);
    expect(columns(c2, site, null, [blankTree({ treeNo: '1', uid: 'u1' })]).map(([k]) => k)).not.toContain(serial);
  });
});

describe('「すべて無にする」で要否の項目なども選ぶ（checks の none・initial.fillNone）', () => {
  it('none の値と詳しい診断の要否を入れ、選んである項目は変えない', async () => {
    const { fillChecksNone, checksNoneLabel } = await import('../src/store/actions.js');
    const base = structuredClone(cfg);
    const k2 = base.checks[1].key;
    const opts = base.options[k2];
    const c2 = { ...base, checks: base.checks.map((c, i) => (i === 1 ? { ...c, none: opts.at(-1) } : c)), initial: { ...base.initial, fillNone: true } };
    expect(validateConfig(c2).errors).toEqual([]);
    expect(validateConfig({ ...c2, checks: c2.checks.map((c, i) => (i === 1 ? { ...c, none: 'ない値' } : c)) }).ok).toBe(false);
    expect(validateConfig({ ...c2, initial: { ...c2.initial, fillNone: 'yes' } }).ok).toBe(false);
    const k0 = base.checks[0].key;
    const r = fillChecksNone({ [k0]: base.options[k0].at(-1) }, c2);
    expect(r.tree[k0]).toBe(base.options[k0].at(-1)); // 選んであった項目はそのまま
    expect(r.tree[k2]).toBe(opts.at(-1));
    expect(r.tree.initialNeeded).toBe(base.initial.no);
    expect(r.keys).toContain('initialNeeded');
    expect(fillChecksNone({ initialNeeded: base.initial.yes }, c2).tree.initialNeeded).toBe(base.initial.yes);
    expect(checksNoneLabel(c2)).toMatch(/要否などは/);
    expect(checksNoneLabel(base)).not.toMatch(/要否などは/);
  });
});

describe('足した計測の欄の並び（extraFields の newRow）', () => {
  it('newRow の欄の前で行が半端なら空きを入れる', async () => {
    const { extraCells } = await import('../src/ui/FormView.jsx');
    const a = { key: 'a' };
    const b = { key: 'b', newRow: true };
    const c = { key: 'c' };
    expect(extraCells([a, b, c])).toEqual([a, null, b, c]);
    expect(extraCells([a, c, b])).toEqual([a, c, b]); // 行の頭なら空けない
    expect(validateConfig({ ...cfg, extraFields: [{ key: 'xa', label: 'A', newRow: 'yes' }] }).ok).toBe(false);
  });
});
