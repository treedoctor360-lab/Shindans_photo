// 写真の保存と送受信（端末内の写真の置き場所 photoDb.js と、サーバー GAS の間）
//
// 約束（入力内容と同じ考え方。写真が消えないことを一番に）
//  ・撮った写真は、まず端末に保存し、書けたことを読み直して確かめてから記録に足す
//  ・写真の本体と一緒に記録の写し（meta）も置く。記録が保存できなかったときは、起動時にそこから戻す（recoverPhotos）
//  ・サーバーに送ったら、届いた大きさが端末と同じことを確かめる。同じ写真を送り直しても、サーバーで2枚にならない
//  ・端末の本体は、サーバーに届いたことを確かめた写真でも残しておく。外すのは端末の空きが足りなくなったときだけ、
//    届いたことを確かめた写真の古い順に（makeRoom）。小さな見本はいつも残す
//  ・端末の写真の記録は消さない（撮り直した写真も「撮り直し」の印を付けて残す）
//  ・写真の保存・送信に失敗しても、入力内容の保存・送信には響かない

import { addShot, cameraOf, localBytes, mergeRemote, orientOf, photoFileName, storageRoom, uniqueName, unsentPhotos, unsentRetires } from '../core/photoShots.js';
import { groupKey, groupLabel } from '../core/groups.js';
import { photoDropFull, photoGet, photoKeys, photoPut } from './photoDb.js';
import { simpleKey } from './surveys.js';
import { callServer, fromBase64, toBase64 } from './sync.js';

// この端末のデータを、ブラウザが勝手に消さないよう申し出る（容量が足りないときなど）
//  同じドメイン（本番の野帳アプリも）のデータ全体に効く
//  返す形：true（守られている）/ false（守られていない）/ null（このブラウザでは分からない）
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

// 端末の容量（分からなければ null）
export async function storageEstimate() {
  try {
    return navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  } catch {
    return null;
  }
}

const byteLen = (x) => (x ? (x.byteLength ?? x.size ?? 0) : 0);

// 送る・戻すときに使う、写真の記録の項目
const META_KEYS = ['id', 'key', 'slot', 'slotName', 'name', 'want', 'orient', 'w', 'h', 'bytes', 'takenAt', 'by', 'deviceId', 'year', 'group', 'treeNo', 'species'];
export const metaOf = (p) => Object.fromEntries(META_KEYS.map((k) => [k, p[k] ?? '']));

// 端末の空きを作る：サーバーに届いたことを確かめた写真の本体を、古い順に外す（見本と記録は残す）
//  外すのは次のどちらかのときだけ
//   ・端末の空きが少ない（storageRoom）
//   ・端末に残している写真の本体が上限（設定 photo.camera.localMB、既定 300MB）を超える
//     （ブラウザは空きが足りないとき、同じドメインのデータをまとめて消すことがある。本番の野帳アプリも同じドメインなので、写真で場所を取りすぎない）
//  need：これから書く大きさ。返す形：{ ok, dropped: 外した枚数 }
export async function makeRoom({ getState, update, need, estimate = storageEstimate, cfg }) {
  const limit = cameraOf(cfg || {}).localMB * 1024 * 1024;
  const over = () => localBytes(getState().photos) + need > limit;
  let room = storageRoom(await estimate(), need);
  let dropped = 0;
  if (room.ok && !over()) return { ok: true, dropped };
  const sent = (getState().photos || []).filter((p) => p.fileId && p.local === 'full').sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
  for (const p of sent) {
    await photoDropFull(p.id);
    await update((cur) => ({ ...cur, photos: (cur.photos || []).map((x) => (x.id === p.id ? { ...x, local: 'thumb' } : x)) }), { now: true });
    dropped++;
    room = storageRoom(await estimate(), need);
    if (room.ok && !over()) break;
  }
  // 上限を超えても、未送信の写真しか残っていなければ撮れるようにする（未送信の本体は外せないので、送るまで残す）。止めるのは端末の空きが少ないときだけ
  return { ok: room.ok, dropped };
}

// 撮った写真を保存する
//  shaped：photoShot.js の shapePhoto の結果 { full: Blob, thumb: Blob, w, h }
//  返す形：{ rec, warn（向きが決まりと違うときの知らせ）, dropped（空きを作るため本体を外した枚数） }
export async function savePhoto({ getState, update, cfg, tree, slot, shaped, now = new Date(), estimate = storageEstimate }) {
  const full = await shaped.full.arrayBuffer();
  const thumb = await shaped.thumb.arrayBuffer();
  const room = await makeRoom({ getState, update, need: full.byteLength + thumb.byteLength, estimate, cfg });
  if (!room.ok)
    throw new Error('端末の空きが少ないため、写真を保存しませんでした（入力内容を守るため）。電波のある所で写真を送ってから撮るか、端末の空きを増やしてください');

  const state = getState();
  const deviceId = state.server?.deviceId || 'dev';
  const id = `${deviceId}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const key = simpleKey(tree, cfg);
  const photos = state.photos || [];
  const date = tree.date || state.session?.date || '';
  const rec = {
    id,
    key,
    slot: slot.key,
    slotName: slot.name,
    name: uniqueName(photoFileName(tree, slot.name, date, cfg), photos.filter((p) => p.key !== key || p.slot !== slot.key)),
    want: slot.orient || '',
    orient: orientOf(shaped.w, shaped.h),
    w: shaped.w,
    h: shaped.h,
    bytes: full.byteLength,
    takenAt: now.toISOString(),
    by: state.session?.inspector || '',
    deviceId,
    year: cfg.job.year,
    group: groupLabel(state.trees, groupKey(tree, cfg), cfg),
    treeNo: tree.treeNo || '',
    species: tree.species || '',
    fileId: '',
    local: 'full',
  };
  // 端末に書いて、読み直して確かめる（記録の写しも一緒に）
  await photoPut(id, { full, thumb, type: 'image/jpeg', meta: metaOf(rec) });
  const back = await photoGet(id);
  if (!back || byteLen(back.full) !== full.byteLength) throw new Error('写真を端末に保存できませんでした（読み直すと違っていました）');

  await update((cur) => ({ ...cur, photos: addShot(cur.photos || [], rec) }), { now: true });
  const warn = slot.orient && slot.orient !== rec.orient ? `${slot.name}は${slot.orient}向きの決まりです（${rec.orient}向きで撮りました）` : '';
  return { rec, warn, dropped: room.dropped };
}

// 起動時：写真の置き場所にあるのに記録にない写真を、置き場所の写しから記録に戻す
//  （写真を書いた直後に記録の保存ができなかった場合の救い。戻した写真は未送信として送り直す）
//  返す形：戻した枚数
export async function recoverPhotos({ getState, update }) {
  let ids;
  try {
    ids = await photoKeys();
  } catch {
    return 0;
  }
  const known = new Set((getState().photos || []).map((p) => p.id));
  const lost = [];
  for (const id of ids || []) {
    if (known.has(id)) continue;
    const r = await photoGet(id);
    if (r?.meta?.id === id) lost.push({ ...r.meta, fileId: '', local: r.full ? 'full' : 'thumb' });
  }
  if (!lost.length) return 0;
  // 古い順に足す（同じ枠の写真は、新しい方が使われ、前の方に撮り直しの印が付く）
  lost.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
  await update((cur) => {
    let photos = cur.photos || [];
    for (const p of lost) if (!photos.some((x) => x.id === p.id)) photos = addShot(photos, p);
    return { ...cur, photos };
  }, { now: true });
  return lost.length;
}

// 写真の見本・本体を読む（端末になければ null）。返す形：{ thumb: Blob|null, full: Blob|null }
export async function readPhoto(id) {
  const r = await photoGet(id);
  if (!r) return { thumb: null, full: null };
  const blob = (b) => (b ? new Blob([b], { type: r.type || 'image/jpeg' }) : null);
  return { thumb: blob(r.thumb), full: blob(r.full) };
}

// 写真の本体を取り出す：端末にあればそれ、なければサーバーから。返す形：ArrayBuffer
export async function photoBytes(server, photo, fetchFn = fetch) {
  const r = await photoGet(photo.id).catch(() => null);
  if (r?.full) return r.full;
  if (!photo.fileId) throw new Error(`${photo.name} はこの端末にもサーバーにもありません（撮った端末から送ってください）`);
  const g = await callServer(server, { action: 'photoGet', id: photo.id }, fetchFn);
  return fromBase64(g.base64);
}

// 写真の送受信。返す形：{ sent, got }
//  1. まだ届いていない写真を1枚ずつ送る（届いた大きさを確かめる）
//  2. 撮り直しの印を送る
//  3. 他の端末で撮った写真の一覧を受け取る（本体は受け取らない。見るとき・出すときに取り出す）
export async function syncPhotos({ getState, update, cfg, fetchFn = fetch }) {
  const server = getState().server;
  if (!server?.url) return { sent: 0, got: 0 };
  let sent = 0;
  for (const p of unsentPhotos(getState().photos)) {
    const local = await photoGet(p.id);
    if (!local?.full) continue;
    const r = await callServer(server, { action: 'photoPut', year: cfg.job.year, photo: { ...metaOf(p), retired: !!p.retired }, base64: toBase64(local.full) }, fetchFn);
    if (!r.fileId || Number(r.bytes) !== byteLen(local.full)) throw new Error(`${p.name} がサーバーに正しく届きませんでした（送り直します）`);
    // 届いた印を付ける（端末の本体はそのまま残す）
    await update((cur) => ({ ...cur, photos: (cur.photos || []).map((x) => (x.id === p.id ? { ...x, fileId: r.fileId, seq: r.seq, sentRetire: x.sentRetire || !!p.retired } : x)) }), { now: true });
    sent++;
  }
  const retires = unsentRetires(getState().photos);
  if (retires.length) {
    await callServer(server, { action: 'photoRetire', year: cfg.job.year, ids: retires.map((p) => p.id) }, fetchFn);
    const ids = new Set(retires.map((p) => p.id));
    await update((cur) => ({ ...cur, photos: (cur.photos || []).map((x) => (ids.has(x.id) ? { ...x, sentRetire: true } : x)) }), { now: true });
  }
  const since = getState().server?.photoSeq || 0;
  const l = await callServer(server, { action: 'photoList', year: cfg.job.year, since }, fetchFn);
  const got = (l.photos || []).length;
  if (got || (l.lastSeq || 0) !== since)
    await update((cur) => ({ ...cur, photos: mergeRemote(cur.photos, l.photos), server: { ...cur.server, photoSeq: Math.max(cur.server?.photoSeq || 0, l.lastSeq || 0) } }), { now: true });
  return { sent, got };
}

export { cameraOf };
