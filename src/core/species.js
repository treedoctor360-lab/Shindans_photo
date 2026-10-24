// 樹種名の置き換え（設定 cfg.species.replace の「旧名 → 記録する名前」）

import { toHalf } from './text.js';

export function normalizeSpecies(name, cfg) {
  const n = toHalf(name).trim();
  return cfg.species.replace[n] || n;
}
