// 木の位置（緯度・経度）。設定 location があるときだけ使う
//  木の記録に持つ項目：lat・lng（度。小数6桁）、locAcc（GPS の精度 m。地図で直したときは空）、
//    locSrc（'gps'：現在地／'map'：地図で置いた）、locAt（記録した日時）
//  地図の背景（tiles）・最初に開く場所（start）は設定に書く（コードに地名・URL を書かない）

export const LOC_KEYS = ['lat', 'lng', 'locAcc', 'locSrc', 'locAt'];

const isNum = (v) => v !== '' && v != null && Number.isFinite(Number(v));
export const hasLoc = (t) => isNum(t?.lat) && isNum(t?.lng);
const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;

// 位置を入れる。fix：{ lat, lng, acc?, at? }、src：'gps'／'map'
export function withLoc(tree, fix, src, now = new Date().toISOString()) {
  return {
    ...tree,
    lat: round6(fix.lat),
    lng: round6(fix.lng),
    locAcc: src === 'gps' && isNum(fix.acc) ? Math.round(Number(fix.acc)) : '',
    locSrc: src,
    locAt: fix.at || now,
  };
}

export const clearLoc = (tree) => ({ ...tree, lat: '', lng: '', locAcc: '', locSrc: '', locAt: '' });

// 画面に出す1行（例「34.123456, 135.123456（GPS ±8m）」）
export function locText(t) {
  if (!hasLoc(t)) return '';
  const how = t.locSrc === 'map' ? '地図で置いた位置' : `GPS${isNum(t.locAcc) ? ` ±${t.locAcc}m` : ''}`;
  return `${Number(t.lat).toFixed(6)}, ${Number(t.lng).toFixed(6)}（${how}）`;
}

// 保存のときに自動で入れてよい GPS か（精度が設定の上限より良いとき）
export const autoMaxAcc = (cfg) => cfg.location?.autoMaxAcc ?? 30;
export const goodFix = (fix, cfg) => !!fix && isNum(fix.lat) && isNum(fix.lng) && isNum(fix.acc) && Number(fix.acc) <= autoMaxAcc(cfg);

// 設定 location の確かめ
//  { auto?: true（保存のときに現在地を入れる）, autoMaxAcc?: m, start?: { lat, lng, zoom? },
//    tiles: [{ label, url（{z}{x}{y} を含む）, attribution（出典の表示）, attributionUrl?, maxZoom?, maxNativeZoom? }] }
export function validateLocation(loc, need) {
  if (!need(loc && typeof loc === 'object' && !Array.isArray(loc), 'location の形が違います')) return;
  need(loc.auto == null || typeof loc.auto === 'boolean', 'location.auto は true か false にしてください');
  need(loc.autoMaxAcc == null || (isNum(loc.autoMaxAcc) && loc.autoMaxAcc > 0), 'location.autoMaxAcc（自動で入れる GPS の精度の上限 m）は正の数にしてください');
  if (loc.start != null) {
    need(isNum(loc.start.lat) && isNum(loc.start.lng) && Math.abs(loc.start.lat) <= 90 && Math.abs(loc.start.lng) <= 180, 'location.start は { lat, lng, zoom? } にしてください');
    need(loc.start.zoom == null || (Number.isInteger(loc.start.zoom) && loc.start.zoom >= 1 && loc.start.zoom <= 20), 'location.start.zoom は 1〜20 の整数にしてください');
  }
  if (!need(Array.isArray(loc.tiles) && loc.tiles.length > 0, 'location.tiles（地図の背景の一覧）がありません')) return;
  loc.tiles.forEach((x, i) => {
    const at = `location.tiles[${i}]`;
    need(typeof x?.label === 'string' && x.label !== '', `${at}.label（名前）がありません`);
    need(typeof x?.url === 'string' && /^https:\/\//.test(x.url) && ['{z}', '{x}', '{y}'].every((s) => x.url.includes(s)), `${at}.url は https:// で始まり {z}{x}{y} を含む文字にしてください`);
    need(typeof x?.attribution === 'string' && x.attribution !== '', `${at}.attribution（出典の表示）がありません`);
    need(x?.attributionUrl == null || (typeof x.attributionUrl === 'string' && /^https:\/\//.test(x.attributionUrl)), `${at}.attributionUrl は https:// で始まる文字にしてください`);
    for (const z of ['maxZoom', 'maxNativeZoom']) need(x?.[z] == null || (Number.isInteger(x[z]) && x[z] >= 1 && x[z] <= 22), `${at}.${z} は 1〜22 の整数にしてください`);
  });
}
