// 入力画面の「位置」：木の位置（緯度・経度）を見る・現在地を入れる・地図で直す・消す
//  保存のときに自動で入れる（この端末で「保存のときに現在地を入れる」が入っていて、まだ位置がなく、GPS の精度が良いとき）のは FormView の保存の処理
import { lazy, Suspense, useState } from 'react';
import { clearLoc, hasLoc, locText, withLoc, autoMaxAcc } from '../core/location.js';
import { toHalf } from '../core/text.js';
import { getFixOnce } from './useGeoFix.js';

// 読み込めなかったとき（電波がない所で初めて開いたなど）は、画面を止めずに知らせる
const MapPicker = lazy(() =>
  import('./MapPicker.jsx').catch(() => ({
    default: ({ onClose }) => (
      <div className="alert warn" role="alert">
        <span>地図を読み込めませんでした。電波のある所で開き直してください。</span>
        <button type="button" className="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    ),
  })),
); // 地図の部品は開いたときだけ読み込む

export default function LocationBox({ cfg, tree, geo, change, readOnly, others, autoOn, setAutoOn, toast }) {
  const [map, setMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const fix = geo.fix;
  const here = async () => {
    setBusy(true);
    try {
      const f = await getFixOnce();
      change((x) => withLoc(x, f, 'gps'));
      toast(`現在地を入れました（精度 ±${Math.round(f.acc)}m）`);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  // 地図を最初に開く場所：この木の位置 → いまの現在地 → 同じ路線の最後の木 → 設定の start
  const start = hasLoc(tree) ? { lat: Number(tree.lat), lng: Number(tree.lng) } : fix ? { lat: fix.lat, lng: fix.lng } : others.at(-1) || null;
  return (
    <div className="loc" data-testid="location">
      <div className="lbl">位置</div>
      <div data-testid="loc-text">{hasLoc(tree) ? locText(tree) : <span className="hint">まだ記録していません</span>}</div>
      {!readOnly && (
        <div className="acts">
          <button type="button" className="btn" disabled={busy} onClick={here} data-testid="loc-here">
            {busy ? '現在地を取得中…' : '現在地を入れる'}
          </button>
          <button type="button" className="btn" onClick={() => setMap(true)} data-testid="loc-map">
            地図で直す
          </button>
          {hasLoc(tree) && (
            <button type="button" className="btn" onClick={() => change(clearLoc)} data-testid="loc-clear">
              消す
            </button>
          )}
        </div>
      )}
      {!readOnly && cfg.location.auto !== false && (
        <label className="hint loc-auto">
          <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} data-testid="loc-auto" />
          保存のときに現在地を入れる（この端末。初めて保存する位置のない木だけ、精度 ±{autoMaxAcc(cfg)}m 以内のとき）
          {autoOn && (fix ? `。いまの精度 ±${Math.round(fix.acc)}m` : geo.error ? `。${geo.error}` : '。現在地を取得中…')}
        </label>
      )}
      {map && (
        <Suspense fallback={<div className="map-modal">地図を読み込み中…</div>}>
          <MapPicker
            cfg={cfg}
            start={start}
            label={toHalf(tree.treeNo) || ''}
            others={others}
            onClose={() => setMap(false)}
            onPick={(p) => {
              change((x) => withLoc(x, p, 'map'));
              setMap(false);
              toast('地図で置いた位置を入れました');
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
