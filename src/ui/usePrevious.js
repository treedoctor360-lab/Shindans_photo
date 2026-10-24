// 前回の調査を画面で使うためのフック（React の仕組み：部品から端末内のデータを読む）
// 端末内のデータが変わったら（'prev-updated' の知らせ）、読み直す
import { useEffect, useState } from 'react';
import { loadIndex, loadPhotos } from '../store/previous.js';

function useLoaded(load, deps) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      load()
        .then((v) => alive && setValue(v || null))
        .catch(() => alive && setValue(null));
    read();
    window.addEventListener('prev-updated', read);
    return () => {
      alive = false;
      window.removeEventListener('prev-updated', read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

// 前回の要点（全部の木）
export const usePrevIndex = () => useLoaded(loadIndex, []);

// 前回の写真（場所ごと）。packId がなければ null
export const usePrevPhotos = (packId) => useLoaded(() => (packId ? loadPhotos(packId) : Promise.resolve(null)), [packId]);
