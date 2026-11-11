// 地図で位置を直す（1本の木）。ピンを動かすか、地図を押した所にピンを移し、「この位置にする」で決める
//  同じ路線・公園のほかの木の位置も番号で出す（並びの見当を付けやすいように）
import { useEffect, useRef, useState } from 'react';
import { L, makeMap, numberIcon } from './leafletMap.js';

export default function MapPicker({ cfg, start, label, others, onPick, onClose }) {
  const el = useRef(null);
  const [pos, setPos] = useState(start); // 今のピンの位置 { lat, lng }（なければ地図の真ん中に置く）
  useEffect(() => {
    const map = makeMap(el.current, cfg, { center: start ? [start.lat, start.lng] : null });
    for (const o of others) L.marker([o.lat, o.lng], { icon: numberIcon(o.label), interactive: false, keyboard: false }).addTo(map);
    const c = start || map.getCenter();
    const pin = L.marker([c.lat, c.lng], { icon: numberIcon(label || '●', { current: true, big: true }), draggable: true, autoPan: true }).addTo(map);
    const set = (ll) => setPos({ lat: ll.lat, lng: ll.lng });
    set(pin.getLatLng());
    pin.on('dragend', () => set(pin.getLatLng()));
    map.on('click', (e) => {
      pin.setLatLng(e.latlng);
      set(e.latlng);
    });
    window.__shindansMap = map; // 画面のテストから地図を動かすため
    return () => {
      map.remove();
      if (window.__shindansMap === map) delete window.__shindansMap;
    };
  }, []); // 開いたときに1回だけ作る
  return (
    <div className="map-modal" role="dialog" aria-label="地図で位置を直す" data-testid="map-picker">
      <div className="map-head">
        <b>{label ? `${label} の位置` : '位置'}</b>
        <span className="hint">ピンを動かすか、地図を押した所に移します</span>
      </div>
      <div className="map-box" ref={el} data-testid="map-box" />
      <div className="map-foot">
        <span className="hint" data-testid="map-pos">
          {pos ? `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}` : ''}
        </span>
        <button type="button" className="btn" onClick={onClose} data-testid="map-cancel">
          やめる
        </button>
        <button type="button" className="btn fill" disabled={!pos} onClick={() => onPick(pos)} data-testid="map-ok">
          この位置にする
        </button>
      </div>
    </div>
  );
}
