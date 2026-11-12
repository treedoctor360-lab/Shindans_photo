// 追加した木の並び：「どの木の次か」（木の after）に並べる
//  ・現地で追加した木は、一覧表の行がまだないので、そのままでは公園・路線の最後に並ぶ（野帳の並びが元と変わる）。
//    追加したときに「この木の次」を覚えておき（after：その木の鍵 simpleKey）、アプリの一覧・野帳ではその木のすぐ後ろに並べる。
//  ・一覧表に行が入って結び付いた木（ledgerRow があり ledgerGone でない）は、一覧表の並びに従う（after は見ない）
//  ・同じ木の次の木が2本以上あるとき（前の版で作った並び）は、追加した順に並べる。追加した木の次に追加した木は、その木の後ろ
//    （今は差し込むとき、その木の次にあった木を入れた木の次へ付け替える。src/store/actions.js の linkAfter）
//  ・「次の木」が見つからない木（消えた・番号が変わった）は、同じまとまり（公園・路線）の最後に置く
import { afterSameGroup, simpleKey } from './surveys.js';

// 一覧表の行に結び付いている木か（一覧表の並びに従う）
const bound = (t) => !!t.ledgerRow && !t.ledgerGone;

export function placeAdded(trees, cfg) {
  const keyOf = (t) => simpleKey(t, cfg);
  const movable = trees.filter((t) => t.after && !bound(t));
  if (!movable.length) return trees;
  let out = trees.filter((t) => !movable.includes(t));
  let left = movable;
  // 次の木そのものが、まだ並べていない追加の木のこともあるので、並べられるものから何回かに分けて並べる
  while (left.length) {
    const rest = [];
    for (const m of left) {
      const i = out.findIndex((t) => keyOf(t) === m.after);
      if (i < 0) {
        rest.push(m);
        continue;
      }
      // 同じ木の次（とその後ろに続けて追加した木）が先に並んでいれば、その後ろへ
      const chain = new Set([m.after]);
      let j = i + 1;
      while (j < out.length && out[j].after && !bound(out[j]) && chain.has(out[j].after)) {
        chain.add(keyOf(out[j]));
        j++;
      }
      out = [...out.slice(0, j), m, ...out.slice(j)];
    }
    if (rest.length === left.length) break;
    left = rest;
  }
  for (const m of left) {
    const at = afterSameGroup(out, m, cfg);
    out = [...out.slice(0, at), m, ...out.slice(at)];
  }
  return out;
}

// 追加した木の「次の木」の名前（画面・差し込む行の一覧に出す）。見つからなければ ''
export function anchorOf(trees, t, cfg) {
  if (!t.after) return null;
  return trees.find((x) => x !== t && simpleKey(x, cfg) === t.after) || null;
}
