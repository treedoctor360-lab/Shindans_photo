// 公園・路線などの「まとまり」
// まとまりは、台帳のシートの種類（cfg.dbFormat.sheets）ごとに、名前の列（identify）で分ける。
// 同じ名前でコード（code）が分かれているもの（例：同じ公園で区域ごとに番号が違う）は、1つにまとめる。
// シートの identifyAlso（例 ["routeNo", "region"]）があれば、名前に加えてその項目でも分ける
//  （例：同じ路線名で路線番号ごとに別の路線。同じ番号でも区域が違えば別の路線）

const sheetSpec = (t, cfg) => cfg.dbFormat.sheets.find((s) => s.type === t.siteType);

// 木が属するまとまりの鍵
//  「種類:名前」。identifyAlso があれば「#値」をその数だけ後ろに足す
export function groupKey(t, cfg) {
  const s = sheetSpec(t, cfg);
  const also = (s?.identifyAlso || []).map((k) => `#${String(t[k] ?? '').trim()}`).join('');
  return `${t.siteType || ''}:${s ? t[s.identify] || '' : ''}${also}`;
}

// まとまりの表示名（例：「K01・K02 架空公園」。コードが3つ以上なら「K01他」）
export function groupLabel(trees, key, cfg) {
  const ts = trees.filter((t) => groupKey(t, cfg) === key);
  if (!ts.length) return key.split(':').slice(1).join(':').split('#')[0];
  const s = sheetSpec(ts[0], cfg);
  const name = s ? ts[0][s.identify] || '（名前なし）' : '（種類不明）';
  const codes = s?.code ? [...new Set(ts.map((t) => t[s.code]).filter(Boolean))] : [];
  const code = codes.length > 2 ? `${codes[0]}他` : codes.join('・');
  // identifyAlso の項目（コードの列を除く）は名前の後ろに足す（例 区域）
  const also = (s?.identifyAlso || []).filter((k) => k !== s.code).map((k) => String(ts[0][k] ?? '').trim()).filter(Boolean);
  return `${s ? `[${s.label}] ` : ''}${code} ${name} ${also.join(' ')}`.replace(/\s+/g, ' ').trim();
}

// まとまりの一覧（木の並び順で、最初に出てきた順）
export function groupKeys(trees, cfg) {
  return [...new Set(trees.map((t) => groupKey(t, cfg)))];
}

// まとまりの木（並び順のまま）
export const treesOfGroup = (trees, key, cfg) => trees.filter((t) => groupKey(t, cfg) === key);
