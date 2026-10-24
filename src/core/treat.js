// 処置の文を組み立てる
// 例：剪定の種類 ["枯れ枝","縮小"] ＋ その他 ["支柱撤去"] → 「枯れ枝・縮小剪定・支柱撤去」
// 並び順は選んだ順ではなく、設定（cfg.treat）の並び順にそろえる。

import { toHalf } from './text.js';

export function composeTreat(tree, cfg) {
  const t = cfg.treat;
  const sel = tree.treatSel || [];
  const prune = t.prune.filter((x) => sel.includes(x));
  const parts = [
    prune.length ? prune.join(t.join) + t.pruneSuffix : '',
    ...t.other.filter((x) => sel.includes(x)),
    toHalf(tree.treatFree).trim(),
  ];
  return parts.filter(Boolean).join(t.join);
}
