// 必要な写真の判定
// どの入力でどの写真が要るかは、設定（cfg.photo と noteChips の photo / fullOnly、noteMeasures.kinds の photo / fullOnly）で決める。
//
// 判定の順：
//  1. 弱点写真が要る項目がある → 全景＋弱点写真
//  2. 全景で分かる弱点だけ    → 全景と共用（写真名「全景・〇〇」）
//  3. 写真で分からない弱点だけ → 全景のみ
//  4. どれもない              → 写真不要
// ほかに、特記事項に書いたもの（定型文・寸法の1行・手で書いた行）はすべて撮る（extra。現場で撮る写真。
// 一覧表の「写真の有無」・弱点写真の枚数の上限には数えない）。shoot が現場で撮る写真の全部（全景を含む）

import { measureNoteNames, measurePhotos } from './noteMeasures.js';
import { chipsIn, freeNoteLines } from './notes.js';
import { isLocked, matches } from './tree.js';

export function photoPlan(tree, cfg) {
  const p = cfg.photo;
  if (!tree.vigor) return { slots: [], mode: 'pending', weakPhoto: false, extra: [], shoot: [] };

  const locked = isLocked(tree, cfg);
  const chips = locked ? [] : chipsIn(tree.notes, cfg);

  const weak = [];
  const add = (name) => {
    if (name && !weak.includes(name)) weak.push(name);
  };
  p.weak.filter((c) => matches(tree, c, cfg)).forEach((c) => add(c.name));
  chips.forEach((c) => add(c.photo));
  // 特記事項の寸法の1行（腐朽・亀裂・鋼棒貫入など）
  const mp = locked ? { weak: [], fullOnly: false } : measurePhotos(tree, cfg);
  mp.weak.forEach(add);

  const shared = p.shared.filter((c) => matches(tree, c, cfg)).map((c) => c.name);
  const fullOnly = p.fullOnly.some((c) => matches(tree, c, cfg)) || chips.some((c) => c.fullOnly) || mp.fullOnly;

  const full = { key: 'full', name: shared.length ? [p.fullName, ...shared].join('・') : p.fullName, orient: p.fullOrient };
  const weakSlots = weak.map((n) => ({ key: 'w:' + n, name: n, orient: p.weakOrient }));

  let plan;
  if (weakSlots.length) plan = { slots: [full, ...weakSlots], mode: 'full+weak', weakPhoto: true, over: weakSlots.length > p.maxWeak };
  else if (shared.length) plan = { slots: [full], mode: 'shared', weakPhoto: true };
  else if (fullOnly) plan = { slots: [full], mode: 'fullOnly', weakPhoto: false };
  else plan = { slots: [], mode: 'none', weakPhoto: false };

  // 特記事項に書いたものの写真（上の弱点写真と同じ名前のものは除く）
  const taken = new Set(plan.slots.map((x) => x.name).concat(weak));
  const extra = [];
  const addExtra = (name) => {
    const n = String(name || '').replace(/。$/, '').trim();
    if (!n || taken.has(n)) return;
    taken.add(n);
    extra.push({ key: 'n:' + n, name: n, orient: p.weakOrient, note: true });
  };
  // 定型文：弱点写真の名前があればその名前（枯死などで弱点写真にしていないとき）、なければ定型文の文
  chipsIn(tree.notes, cfg).forEach((c) => addExtra(c.photo || c.t));
  // 寸法の1行：弱点写真の名前、なければ「部位の種類」
  const mLines = measureNoteNames(tree, cfg);
  mLines.forEach((m) => addExtra(m.name));
  // 手で書いた行（寸法の1行を除く）：その文
  const isMeasure = (l) => mLines.some((m) => m.line === l);
  freeNoteLines(tree.notes, cfg)
    .filter((l) => !isMeasure(l))
    .forEach(addExtra);

  // 現場で撮る写真：弱点写真などの枠（なければ全景）＋特記事項の写真
  const shoot = extra.length ? [...(plan.slots.length ? plan.slots : [full]), ...extra] : plan.slots;
  return { ...plan, extra, shoot };
}

// 写真の有無（手で変えていればその値）
export const photoFlag = (tree, cfg) =>
  tree.photoOverride || (photoPlan(tree, cfg).weakPhoto ? cfg.photo.flagYes : cfg.photo.flagNo);
