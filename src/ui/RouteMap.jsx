// 位置図：今の公園・路線の木を、樹木番号の印で地図に出す（社内用）。「印刷」で A3 横に印刷する（PDF に保存もできる）
//  地図の背景の画像はそのまま印刷する（画像に書き出さないので、背景の配信元の CORS の設定によらない）
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasLoc } from '../core/location.js';
import { toHalf } from '../core/text.js';
import { L, makeMap, numberIcon } from './leafletMap.js';

// 印刷のときの地図の大きさ（px。A3 横の印刷できる範囲に近い形）
const PRINT_W = 1500;
const PRINT_H = 980;

export default function RouteMap({ cfg, title, trees, onClose }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const [printing, setPrinting] = useState(false);
  const placed = trees.filter(hasLoc);
  const missing = trees.filter((t) => !hasLoc(t));
  const fit = (map) => {
    if (!placed.length) return;
    map.fitBounds(L.latLngBounds(placed.map((t) => [Number(t.lat), Number(t.lng)])).pad(0.12), { maxZoom: 19 });
  };
  useEffect(() => {
    const map = makeMap(el.current, cfg, {});
    for (const t of placed) L.marker([Number(t.lat), Number(t.lng)], { icon: numberIcon(toHalf(t.treeNo) || '?'), keyboard: false }).addTo(map);
    fit(map);
    mapRef.current = map;
    window.__shindansMap = map; // 画面のテストから地図を見るため
    document.body.classList.add('printing-map');
    return () => {
      map.remove();
      if (window.__shindansMap === map) delete window.__shindansMap;
      document.body.classList.remove('printing-map');
    };
  }, []); // 開いたときに1回だけ作る

  // 印刷：地図を印刷の大きさにして、背景を読み込み終えてから印刷の画面を出す。終わったら元の大きさに戻す
  const onPrint = () => {
    setPrinting(true);
    setTimeout(() => {
      const map = mapRef.current;
      map.invalidateSize();
      fit(map);
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        const back = () => {
          window.removeEventListener('afterprint', back);
          setPrinting(false);
          setTimeout(() => {
            map.invalidateSize();
            fit(map);
          }, 50);
        };
        window.addEventListener('afterprint', back);
        window.print();
      };
      map.eachLayer((l) => l.once?.('load', go));
      setTimeout(go, 4000); // 背景が読み込めなくても（電波がないなど）印刷はできるように
    }, 50);
  };

  return createPortal(
    <div className={`route-map${printing ? ' printing' : ''}`} data-testid="route-map">
      <div className="route-map-head">
        <b>位置図：{title}</b>
        <span className="hint">
          位置のある木 {placed.length}本／{trees.length}本
          {missing.length ? `（位置なし：${missing.map((t) => toHalf(t.treeNo) || '番号なし').join('・')}）` : ''}
        </span>
        <span className="no-print acts">
          <button type="button" className="btn fill" onClick={onPrint} disabled={!placed.length || printing} data-testid="route-map-print">
            印刷（A3 横）
          </button>
          <button type="button" className="btn" onClick={onClose} data-testid="route-map-close">
            閉じる
          </button>
        </span>
      </div>
      <div className="route-map-box" ref={el} style={printing ? { width: PRINT_W, height: PRINT_H } : undefined} data-testid="route-map-box" />
      <div className="route-map-foot hint">社内用（位置はおおよそ）。© 2026– Koh Kitsukawa. All rights reserved.</div>
    </div>,
    document.body,
  );
}
