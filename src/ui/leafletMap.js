// 地図（Leaflet）の共通の部品。地図を開いたときだけ読み込む（MapPicker.jsx・RouteMap.jsx から）
//  背景（tiles）と出典の表示は設定 location.tiles。出典は地図を出している間いつも表示する
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 背景の層（設定の並び順）。出典は attributionUrl があればリンクにする
export function tileLayers(cfg) {
  return (cfg.location?.tiles || []).map((x) =>
    L.tileLayer(x.url, {
      attribution: x.attributionUrl ? `<a href="${esc(x.attributionUrl)}" target="_blank" rel="noopener">${esc(x.attribution)}</a>` : esc(x.attribution),
      maxZoom: x.maxZoom ?? 20,
      maxNativeZoom: x.maxNativeZoom ?? 18,
      crossOrigin: true,
    }),
  );
}

// 地図を作る。最初の背景を出し、背景が2つ以上なら切り替えを右上に出す
export function makeMap(el, cfg, { center, zoom } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  map.attributionControl.setPrefix(false); // 出典の欄には背景の出典だけを出す
  const layers = tileLayers(cfg);
  if (layers[0]) layers[0].addTo(map);
  if (layers.length > 1) L.control.layers(Object.fromEntries(layers.map((l, i) => [cfg.location.tiles[i].label, l])), {}, { collapsed: false }).addTo(map);
  const s = cfg.location?.start;
  map.setView(center || (s ? [s.lat, s.lng] : [35, 135]), zoom ?? (center ? 18 : (s?.zoom ?? 13)));
  return map;
}

// 番号の印（丸に樹木番号）。current は今の木（色を変える）
export function numberIcon(label, { current = false, big = false } = {}) {
  const cls = `map-no${current ? ' cur' : ''}${big ? ' big' : ''}`;
  return L.divIcon({ className: '', html: `<div class="${cls}">${esc(label)}</div>`, iconSize: null, iconAnchor: [0, 0] });
}

export { L };
