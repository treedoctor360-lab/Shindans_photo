// 入力画面を開いている間、端末の現在地（GPS）を見続ける
//  active が false の間は何もしない（位置の設定がない・見るだけの木・自動で入れない端末）
//  fix：{ lat, lng, acc（精度 m）, at }。error：取れなかった理由（許可されていないなど）
import { useEffect, useRef, useState } from 'react';

export function useGeoFix(active) {
  const [fix, setFix] = useState(null);
  const [error, setError] = useState('');
  const ref = useRef(null); // 保存の処理から最新の位置を読むため（描き直しを待たない）
  useEffect(() => {
    if (!active) return undefined;
    if (!navigator.geolocation) {
      setError('この端末では現在地を使えません');
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: new Date(p.timestamp || Date.now()).toISOString() };
        ref.current = f;
        setFix(f);
        setError('');
      },
      (e) => setError(e.code === 1 ? '現在地の使用が許可されていません（ブラウザの設定で許可してください）' : '現在地を取れませんでした'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return { fix, ref, error };
}

// 1回だけ現在地を取る（「現在地を入れる」ボタン）
export function getFixOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('この端末では現在地を使えません'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: new Date(p.timestamp || Date.now()).toISOString() }),
      (e) => reject(new Error(e.code === 1 ? '現在地の使用が許可されていません（ブラウザの設定で許可してください）' : '現在地を取れませんでした')),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  });
}

// この端末で、保存のときに現在地を入れるか（端末ごとに覚える。既定は入れる）
const AUTO_KEY = 'shindansphoto-auto-location';
export const autoLocOn = () => {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
};
export const setAutoLocOn = (on) => {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    /* 覚えられなくても動く */
  }
};
