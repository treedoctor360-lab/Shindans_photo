// 一覧の検索：樹木番号・樹種名で木を探す
//
//  - 全角・半角、大文字・小文字は区別しない（「ｐｉ０８３０」でも「PI0830」が見つかる）
//  - 番号の一部だけでよい（「830」で「PI0830」が見つかる）
//  - 樹種名は、ひらがなで探してもカタカナの樹種名が見つかる（「くすのき」で「クスノキ」）
//  - 空白で区切ると、すべての言葉を含む木だけ（「PD くす」）

import { toHalf } from './text.js';

// ひらがな → カタカナ
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// 比べるための形（半角・大文字・カタカナ・空白なし）
export const searchForm = (s) => toKatakana(toHalf(String(s ?? '')).toUpperCase()).replace(/\s/g, '');

// 1つの言葉が、その木に当てはまるか
function matchWord(tree, word) {
  const no = searchForm(tree.treeNo);
  if (no.includes(word)) return true;
  return searchForm(tree.species).includes(word);
}

// 検索の言葉に当てはまるか（言葉が空なら、すべて当てはまる）
export function matchTree(tree, query) {
  const words = toKatakana(toHalf(String(query ?? '')).toUpperCase())
    .split(/\s+/)
    .filter(Boolean);
  return words.every((w) => matchWord(tree, w));
}
