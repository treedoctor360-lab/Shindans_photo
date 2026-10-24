// 公開前チェックの部品が正しく動くかのテスト（語は架空のもの）
import { describe, it, expect } from 'vitest';
import { parseWords, findWords } from '../scripts/check-forbidden-words.mjs';

describe('禁止語チェック', () => {
  it('空行と # の行を無視して語を読む', () => {
    expect(parseWords('# メモ\nテスト市\n\n  架空緑地  \n')).toEqual(['テスト市', '架空緑地']);
  });
  it('含まれている語だけを返す', () => {
    expect(findWords('ここは架空緑地です', ['テスト市', '架空緑地'])).toEqual(['架空緑地']);
  });
  it('何も含まれていなければ空', () => {
    expect(findWords('一般的な文章', ['テスト市'])).toEqual([]);
  });
});
