// 表記の統一（設定 wording）のテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { alertsOf, applyAction } from '../src/core/rules.js';
import { blankTree } from '../src/core/tree.js';
import { fixWording, wordingIssues } from '../src/core/wording.js';
import { fixInitialWording, initialWordingIssues } from '../src/store/initial.js';

const cfg = structuredClone(cfgJson);

describe('表記の統一', () => {
  it('決まりに当てはまる所を見つけ、直す（上から順に。前の置き換えの結果にも次を当てる）', () => {
    expect(wordingIssues('枯枝除去。支柱有り、根元に腐朽有', cfg)).toEqual(['枯枝→枯れ枝', '～有・～有り→～あり', '枯れ枝の切断・除去→剪定']);
    expect(fixWording('枯枝除去。支柱有り、根元に腐朽有', cfg)).toBe('枯れ枝剪定。支柱あり、根元に腐朽あり');
    expect(fixWording('3ヵ所に腐朽。支柱無し。キノコ無', cfg)).toBe('3箇所に腐朽。支柱なし。キノコなし');
    // 選択肢の書き方・「有無」・ほかの語の中の字は直さない
    for (const ok of ['有(危険)', '有（小）', '有無を確認', '所有地', '無理な剪定', '枯れ枝剪定']) expect(wordingIssues(ok, cfg)).toEqual([]);
  });

  it('設定の誤りを知らせる。古いスマホで読めない書き方（後ろ読み）は断る。省略してよい', () => {
    const bad = (w) => validateConfig({ ...structuredClone(cfgJson), wording: w }).errors.join('\n');
    expect(bad([{ from: '(?<!有)無', to: 'なし' }])).toContain('後ろ読み');
    expect(bad([{ from: '(', to: 'x' }])).toContain('正規表現として読めません');
    expect(bad([{ to: 'x' }])).toContain('wording[0]');
    expect(bad({})).toContain('並び');
    const c = structuredClone(cfgJson);
    delete c.wording;
    expect(validateConfig(c).ok).toBe(true);
    expect(validateConfig(cfg).errors).toEqual([]);
  });
});

describe('簡易診断：注意と「表記を直す」', () => {
  const T = (o) => blankTree({ id: 'x', treeNo: 'AB001', source: 'app', done: true, ...o });
  it('定型文のボタンの行以外（寸法などの自由記述・処置の追記・伐採理由）を調べて直す。寸法の記録の1行も合わせる', () => {
    const chip = cfg.noteChips[0].t;
    const line = '枝の腐朽：2ヵ所';
    const t = T({ notes: `・${chip}\n・${line}`, treatFree: '枯枝除去', fellingReason: '', measures: [{ kind: 'decay', place: '枝', values: {}, line }] });
    const a = alertsOf(t, cfg).find((x) => x.id === 'wording');
    expect(a.msg).toBe('表記の統一：～か所→～箇所・枯枝→枯れ枝・枯れ枝の切断・除去→剪定');
    const f = applyAction(t, a.acts[0], a.id, cfg);
    expect(f.notes).toBe(`・${chip}\n・枝の腐朽：2箇所`);
    expect(f.treatFree).toBe('枯れ枝剪定');
    expect(f.measures[0].line).toBe('枝の腐朽：2箇所');
    expect(alertsOf(f, cfg).some((x) => x.id === 'wording')).toBe(false);
  });

  it('定型文のボタンの文は、決まりに当てはまっても注意しない（ボタンの文は設定で決まっているため）', () => {
    const c = structuredClone(cfgJson);
    c.noteChips.push({ t: '枯枝あり', kind: 'n' });
    expect(alertsOf(T({ notes: '・枯枝あり' }), c).some((x) => x.id === 'wording')).toBe(false);
  });
});

describe('詳しい診断：表記を直す', () => {
  it('文字の項目と弱点の詳細を調べる。数値から組み立てた詳細は、文字の数値を直して組み立て直す', () => {
    const rec = {
      treatment: '枯枝除去',
      b4: '有（小）',
      b4DetailParts: { count: '2', height: { a: '3' } },
      b4Detail: '2本、地上3m、腐朽有',
    };
    expect(initialWordingIssues(rec, cfg)).toEqual(['～有・～有り→～あり', '枯枝→枯れ枝', '枯れ枝の切断・除去→剪定']); // 入力画面の並び順
    // 数値から作った詳細を手で直していない（文が数値と合っている）なら、数値から組み立て直す
    const fromParts = { ...rec, b4Detail: '2本、地上3m' };
    expect(fixInitialWording(fromParts, cfg)).toMatchObject({ treatment: '枯れ枝剪定', b4Detail: '2本、地上3m' });
    // 文を手で書き足していて数値から作れないときは、文を直して「手で直した」印を付ける
    const f = fixInitialWording(rec, cfg);
    expect(f).toMatchObject({ treatment: '枯れ枝剪定', b4Detail: '2本、地上3m、腐朽あり', b4DetailManual: true });
    expect(initialWordingIssues(f, cfg)).toEqual([]);
  });

  it('文字の数値（種名など）に当てはまれば、その数値を直して組み立て直す（手で直した印は付けない）', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[1].items[0].parts.push('name');
    const rec = { b4: '有（小）', b4DetailParts: { count: '1', name: '支柱有' }, b4Detail: '1本、支柱有' };
    const f = fixInitialWording(rec, c);
    expect(f).toMatchObject({ b4DetailParts: { count: '1', name: '支柱あり' }, b4Detail: '1本、支柱あり' });
    expect(f.b4DetailManual).toBeUndefined();
  });
});
