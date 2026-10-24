// 一覧の検索のテスト
import { describe, expect, it } from 'vitest';
import { matchTree } from '../src/core/search.js';

const t = (treeNo, species) => ({ treeNo, species });

describe('樹木番号・樹種で探す', () => {
  it('全角・半角、大文字・小文字を区別しない。番号の一部でよい', () => {
    expect(matchTree(t('PI0830', 'クスノキ'), 'ｐｉ０８３０')).toBe(true);
    expect(matchTree(t('ＰＩ０８３０', 'クスノキ'), 'pi0830')).toBe(true);
    expect(matchTree(t('PI0830', 'クスノキ'), '830')).toBe(true);
    expect(matchTree(t('PI0830', 'クスノキ'), '831')).toBe(false);
  });

  it('樹種名は、ひらがなでもカタカナの樹種名が見つかる。空白で区切るとすべての言葉を含む木だけ', () => {
    expect(matchTree(t('PI0830', 'クスノキ'), 'くすのき')).toBe(true);
    expect(matchTree(t('PI0830', 'クスノキ'), 'くす 08')).toBe(true);
    expect(matchTree(t('PI0830', 'クスノキ'), 'くす PD')).toBe(false);
    expect(matchTree(t('', ''), '')).toBe(true); // 言葉が空なら、すべて
    expect(matchTree(t(undefined, undefined), 'a')).toBe(false); // 番号・樹種がなくても止まらない
  });
});
