// 入力画面の「写真」：撮る写真の枠ごとに、撮る・撮り直す・見本を見る
//  撮った写真は決まりの大きさに整えて（photoShot.js）端末に保存し（store/photos.js）、裏でサーバーへ送る
//  事務の端末（canShoot が false）は見るだけ。端末にない写真はサーバーから取り出して見る
import { useEffect, useState } from 'react';
import { cameraOf, currentPhotos, shotStatus, sizeText } from '../core/photoShots.js';
import { photoBytes, readPhoto, savePhoto } from '../store/photos.js';
import { simpleKey } from '../store/surveys.js';
import { shapePhoto } from './photoShot.js';

// 写真の見本（小さな画像）。端末になければ「サーバーから見る」
function Thumb({ photo, server, onOpen }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    let alive = true;
    readPhoto(photo.id)
      .then((r) => {
        if (alive && r.thumb) {
          u = URL.createObjectURL(r.thumb);
          setUrl(u);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [photo.id, photo.local]);
  if (url)
    return (
      <button type="button" className="shot-thumb" onClick={() => onOpen(photo)} data-testid="shot-thumb" aria-label={`${photo.name} を大きく見る`}>
        <img src={url} alt={photo.name} />
      </button>
    );
  return (
    <button type="button" className="btn" onClick={() => onOpen(photo)} disabled={!photo.fileId || !server?.url} data-testid="shot-remote">
      {photo.fileId ? 'サーバーから見る' : '撮った端末から未送信'}
    </button>
  );
}

// 送信の状態の文字
const sendText = (p) => (p.fileId ? '送信済み' : '未送信');

export default function PhotoShots({ t, plan, state, update, getState, config: cfg, toast, send, canShoot }) {
  const key = simpleKey(t, cfg);
  const cur = currentPhotos(state.photos, key);
  const st = shotStatus(plan, state.photos, key);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState(null); // 大きく見ている写真 { photo, url }

  const onFile = async (slot, file) => {
    if (!file) return;
    setBusy(slot.key);
    try {
      const shaped = await shapePhoto(file, cameraOf(cfg));
      const r = await savePhoto({ getState, update, cfg, tree: t, slot, shaped });
      toast(`${slot.name}を保存しました（${sizeText(r.rec.bytes)}）${r.warn ? `。${r.warn}` : ''}`);
      send?.();
    } catch (e) {
      toast(e.message || '写真を保存できませんでした');
    } finally {
      setBusy('');
    }
  };

  const open = async (photo) => {
    try {
      const local = await readPhoto(photo.id);
      let blob = local.full;
      if (!blob) blob = new Blob([await photoBytes(state.server, photo)], { type: 'image/jpeg' });
      setView({ photo, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast(e.message || '写真を開けませんでした');
    }
  };
  const close = () => {
    if (view?.url) URL.revokeObjectURL(view.url);
    setView(null);
  };

  if (!plan.slots.length && !st.extra.length) return null;
  return (
    <div className="shots" data-testid="photo-shots">
      {plan.slots.length > 0 && (
        <div className="hint" data-testid="shot-progress">
          撮った写真：{st.taken}／{st.need}
          {st.missing.length > 0 && `（まだ：${st.missing.join('、')}）`}
        </div>
      )}
      {plan.slots.map((slot) => {
        const p = cur[slot.key];
        return (
          <div className={`shot${p ? ' done' : ''}`} key={slot.key} data-slot={slot.key}>
            <div className="shot-head">
              <b>{slot.name}</b> <small>{slot.orient}向き</small>
              {p && (
                <small className={`tag ${p.fileId ? 'ok' : 'warn'}`} data-testid="shot-send">
                  {sendText(p)}
                </small>
              )}
            </div>
            {p && <div className="shot-name">{p.name}.jpg{p.want && p.orient !== p.want ? <span className="warn-text">（{p.orient}向きで撮影）</span> : ''}</div>}
            <div className="shot-row">
              {p && <Thumb photo={p} server={state.server} onOpen={open} />}
              {canShoot && (
                <label className={`btn${p ? '' : ' fill'}`} aria-disabled={!!busy}>
                  {busy === slot.key ? '保存中…' : p ? '撮り直す' : '撮る'}
                  {/* capture：スマホでは背面のカメラがすぐ開く（PC ではファイルを選ぶ） */}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    disabled={!!busy}
                    data-shot={slot.key}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = ''; // 同じ写真をもう一度選んでも動くように
                      onFile(slot, f);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
      {st.extra.length > 0 && (
        <div className="shot extra" data-testid="shot-extra">
          <div className="shot-head">
            <b>今は要らない枠の写真</b> <small>（入力を直して枠が無くなった写真。消さずに残しています）</small>
          </div>
          <div className="shot-row">
            {st.extra.map((p) => (
              <Thumb key={p.id} photo={p} server={state.server} onOpen={open} />
            ))}
          </div>
        </div>
      )}
      {view && (
        <div className="shot-view" role="dialog" onClick={close} data-testid="shot-view">
          <img src={view.url} alt={view.photo.name} />
          <div className="shot-view-cap">
            {view.photo.name}.jpg（{view.photo.w}×{view.photo.h}・{sizeText(view.photo.bytes)}・{view.photo.by}）タップで閉じる
          </div>
        </div>
      )}
    </div>
  );
}
