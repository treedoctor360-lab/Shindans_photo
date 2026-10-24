// 寸法から求める値（幹周・樹高/幹径・枝長/枝径）
// 係数・上限などの数値はすべて設定ファイル（cfg.calc）から受け取る。

import { num } from './text.js';
import { isDead } from './tree.js';

// 小数第2位までに丸める（浮動小数の誤差 0.1+0.2 などを消す）
const round2 = (x) => Math.round(x * 100) / 100;

// 幹周（記録値）：単幹は入力値そのまま、株立は (各幹周の和)×係数
export function girthOf(tree, cfg) {
  const v = (tree.girths || []).map(num).filter(Boolean);
  if (!v.length) return null;
  const g = v.length === 1 ? v[0] : v.reduce((a, b) => a + b, 0) * cfg.calc.multiStemFactor;
  return round2(g);
}

// 樹高/幹径：樹高 ÷ (幹周 ÷ 円周率) を整数に丸める。
// 円周率は設定で指定（一覧表の式と同じ値を使うため。例：3.14）
export function heightRatioOf(tree, cfg) {
  const h = num(tree.height);
  const g = girthOf(tree, cfg);
  return h && g ? Math.round(h / (g / cfg.calc.pi)) : null;
}

// 枝長/枝径（丸めない生の値）。入力が足りなければ null
export function branchRatioRaw(tree) {
  const l = num(tree.branchLen);
  const d = num(tree.branchDia);
  return l && d ? l / d : null;
}

// 枝長/枝径を表に書く形にする
//  枯死 → cfg.calc.deadLabel（例 "-"）
//  上限以上 → cfg.calc.branchCapLabel（例 "40≦倍"）
//  それ以外 → 数値（丸めない）。入力なし → ''
export function branchRatioCell(tree, cfg) {
  if (isDead(tree, cfg)) return cfg.calc.deadLabel;
  const r = branchRatioRaw(tree);
  if (r == null) return '';
  return r >= cfg.calc.branchCap ? cfg.calc.branchCapLabel : r;
}

// 画面に出す枝長/枝径（小数第2位まで）
export function branchRatioText(tree, cfg) {
  const c = branchRatioCell(tree, cfg);
  return typeof c === 'number' ? String(round2(c)) : c;
}
