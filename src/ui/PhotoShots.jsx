// 入力画面の「写真」：撮る写真の枠ごとに、撮る・アルバムから選ぶ・撮り直す・見本を見る。枠にない写真も名前を付けて足せる（任意の写真）
//  撮った写真は決まりの大きさに整えて（photoShot.js）端末に保存し（store/photos.js）、裏でサーバーへ送る
//  事務の端末（canShoot が false）は見るだけ。端末にない写真はサーバーから取り出して見る
import { useEffect, useState } from 'react';
import { readShotDate } from '../core/exif.js';
import { EXTRA_PREFIX, cameraOf, currentPhotos, extraName, extraPhotos, shotStatus, sizeText } from '../core/photoShots.js';
import { photoBytes, readPhoto, retirePhoto, savePhoto } from '../store/photos.js';
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

// 「撮る」「アルバムから」のボタン（写真を選んだら onPick(file, source)）
//  testKey：テストで探す印（カメラは data-shot、アルバムは data-album）
//  capture：スマホでは背面のカメラがすぐ開く（PC ではファイルを選ぶ）。アルバムには付けない
function PickButtons({ label, testKey, busy, disabled, fill, onPick }) {
  const input = (source) => (
    <input
      type="file"
      accept="image/*"
      {...(source === 'camera' ? { capture: 'environment', 'data-shot': testKey } : { 'data-album': testKey })}
      hidden
      disabled={disabled}
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = ''; // 同じ写真をもう一度選んでも動くように
        if (f) onPick(f, source);
      }}
    />
  );
  return (
    <>
      <label className={`btn${fill ? ' fill' : ''}`} aria-disabled={disabled}>
        {busy ? '保存中…' : label}
        {input('camera')}
      </label>
      <label className="btn" aria-disabled={disabled}>
        アルバムから
        {input('album')}
      </label>
    </>
  );
}

export default function PhotoShots({ t, plan, state, update, getState, config: cfg, toast, send, canShoot }) {
  const key = simpleKey(t, cfg);
  const cur = currentPhotos(state.photos, key);
  const st = shotStatus(plan, state.photos, key);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState(null); // 大きく見ている写真 { photo, url }
  const [newName, setNewName] = useState(''); // 足す任意の写真の名前
  const [askRetire, setAskRetire] = useState(''); // 「使わない」を確かめている写真の印
  const extras = extraPhotos(state.photos, key);

  // source：'camera' / 'album'。アルバムの写真は、整える前の元のファイルから撮影日時を読む
  const onFile = async (slot, file, source) => {
    if (!file) return false;
    setBusy(slot.key);
    try {
      const shotAt = source === 'album' ? readShotDate(await file.arrayBuffer()) : '';
      const shaped = await shapePhoto(file, cameraOf(cfg));
      const r = await savePhoto({ getState, update, cfg, tree: t, slot, shaped, source, shotAt });
      toast(`${slot.name}を保存しました（${sizeText(r.rec.bytes)}）${r.warn ? `。${r.warn}` : ''}`);
      send?.();
      return true;
    } catch (e) {
      toast(e.message || '写真を保存できませんでした');
      return false;
    } finally {
      setBusy('');
    }
  };

  // 任意の写真を足す（1枚ごとに枠を作る）
  const onExtra = async (file, source) => {
    const name = extraName(newName);
    if (!name) return toast('写真の名前を入れてください');
    const slot = { key: `${EXTRA_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, orient: '' };
    if (await onFile(slot, file, source)) setNewName('');
  };

  const onRetire = async (p) => {
    await retirePhoto({ update, id: p.id });
    setAskRetire('');
    toast(`${p.slotName}を使わない写真にしました（消さずに残しています）`);
    send?.();
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

  if (!plan.slots.length && !st.extra.length && !extras.length && !canShoot) return null;
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
              {canShoot && <PickButtons label={p ? '撮り直す' : '撮る'} testKey={slot.key} busy={busy === slot.key} disabled={!!busy} fill={!p} onPick={(f, src) => onFile(slot, f, src)} />}
            </div>
          </div>
        );
      })}
      {/* 任意の写真：撮る写真の枠にない写真を、名前を付けて足す（数には入れない） */}
      {(canShoot || extras.length > 0) && (
        <div className="shot-free" data-testid="shot-free">
          <div className="shot-head">
            <b>任意の写真</b> <small>（撮る写真の枠にない写真。名前を入れて足します）</small>
          </div>
          {extras.map((p) => (
            <div className="shot-free-item" key={p.id} data-free={p.slotName}>
              <div className="shot-name">
                {p.name}.jpg{' '}
                <small className={`tag ${p.fileId ? 'ok' : 'warn'}`} data-testid="shot-send">
                  {sendText(p)}
                </small>
              </div>
              <div className="shot-row">
                <Thumb photo={p} server={state.server} onOpen={open} />
                {canShoot &&
                  (askRetire === p.id ? (
                    <>
                      <button type="button" className="btn" onClick={() => onRetire(p)} data-testid="free-retire-ok">
                        使わない（消さずに残す）
                      </button>
                      <button type="button" className="btn" onClick={() => setAskRetire('')}>
                        やめる
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn" onClick={() => setAskRetire(p.id)} data-testid="free-retire">
                      使わない
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {canShoot && (
            <>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="写真の名前（例：根元の様子）"
                data-testid="free-name"
                aria-label="任意の写真の名前"
              />
              <div className="shot-row">
                {extraName(newName) ? (
                  <PickButtons label="撮る" testKey="free" busy={!!busy && busy.startsWith(EXTRA_PREFIX)} disabled={!!busy} fill onPick={onExtra} />
                ) : (
                  <small className="hint">名前を入れると、撮る・アルバムから選べます</small>
                )}
              </div>
            </>
          )}
        </div>
      )}
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
            {view.photo.name}.jpg（{view.photo.w}×{view.photo.h}・{sizeText(view.photo.bytes)}・{view.photo.by}
            {view.photo.source === 'album' ? `・アルバムから（撮影 ${view.photo.shotAt ? view.photo.shotAt.replace('T', ' ').slice(0, 16) : '日時不明'}）` : ''}）タップで閉じる
          </div>
        </div>
      )}
    </div>
  );
}
