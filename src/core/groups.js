// 公園・路線などの「まとまり」
// まとまりは、台帳のシートの種類（cfg.dbFormat.sheets）ごとに、名前の列（identify）で分ける。
// 同じ名前でコード（code）が分かれているもの（例：同じ公園で区域ごとに番号が違う）は、1つにまとめる。

const sheetSpec = (t, cfg) => cfg.dbFormat.sheets.find((s) => s.type === t.siteType);

// 木が属するまとまりの鍵
export function groupKey(t, cfg) {
  const s = sheetSpec(t, cfg);
  return `${t.siteType || ''}:${s ? t[s.identify] || '' : ''}`;
}

// まとまりの表示名（例：「K01・K02 架空公園」。コードが3つ以上なら「K01他」）
export function groupLabel(trees, key, cfg) {
  const ts = trees.filter((t) => groupKey(t, cfg) === key);
  if (!ts.length) return key.split(':').slice(1).join(':');
  const s = sheetSpec(ts[0], cfg);
  const name = s ? ts[0][s.identify] || '（名前なし）' : '（種類不明）';
  const codes = s?.code ? [...new Set(ts.map((t) => t[s.code]).filter(Boolean))] : [];
  const code = codes.length > 2 ? `${codes[0]}他` : codes.join('・');
  return `${s ? `[${s.label}] ` : ''}${code} ${name}`.replace(/\s+/g, ' ').trim();
}

// まとまりの一覧（木の並び順で、最初に出てきた順）
export function groupKeys(trees, cfg) {
  return [...new Set(trees.map((t) => groupKey(t, cfg)))];
}

// まとまりの木（並び順のまま）
export const treesOfGroup = (trees, key, cfg) => trees.filter((t) => groupKey(t, cfg) === key);
