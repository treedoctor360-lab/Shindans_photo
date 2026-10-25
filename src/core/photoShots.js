// 撮った写真の記録（計算だけ。画面・端末内の保存には触らない）
//
// 写真の記録（state.photos の1件。本体は photoDb.js に別に置く）
//  id       … 写真の印（端末の印＋時刻。サーバーでも同じ印で見分ける）
//  key      … 木の鍵（surveys.js の simpleKey。番号を書き換えても同じ木）
//  slot     … どの写真の枠か（photoPlan の slots の key。'full' 全景 / 'w:腐朽' 弱点など）
//  slotName … 枠の名前（撮ったときの名前。「全景・傾斜」など）
//  name     … ファイル名（拡張子なし）
//  want     … 決まりの向き（'縦' / '横'）、orient … 撮った写真の向き
//  w, h, bytes, takenAt, by（撮った人）, deviceId, year, group（公園・路線の名前）, treeNo, species
//  fileId   … サーバー（ドライブ）に届いたときのファイルの印。空なら未送信
//  local    … 端末に残っているもの：'full'（本体と見本）/ 'thumb'（見本だけ。本体はサーバー）/ ''（無し。他の端末で撮った写真）
//  retired  … 撮り直して使わなくなった写真（消さずに残す）
//  source   … どこから入れたか：'camera'（その場で撮った）/ 'album'（アルバムから選んだ）
//  shotAt   … 元の撮影日時（カメラはその時刻、アルバムは写真の中の撮影日時。読めなければ空）
//             takenAt は「アプリに入れた時刻」で、並び順（最新の1枚）・撮り直しの判定に使う
//
// 同じ木・同じ枠に何枚あっても、使うのは撮り直していない最新の1枚。
// 任意の写真（撮る写真の枠にない写真）は、1枚ごとに枠を作る（slot が 'x:' で始まる）。名前は入れた人が決める。

import { toHalf } from './text.js';

// 写真の大きさの決まり（設定 photo.camera で変えられる。省略時はこの値）
export function cameraOf(cfg) {
  const c = cfg.photo?.camera || {};
  return {
    long: c.long || 640, // 長い辺（ピクセル）
    short: c.short || 480, // 短い辺（4:3）
    maxKB: c.maxKB || 100, // 1枚の大きさの目安
    fileName: c.fileName || '{no}{name}{yymmdd}', // ファイル名の形
    localMB: c.localMB || 300, // 端末に本体を残しておく量の上限（超えたら、送信済みの写真の本体を古い順に外す）
  };
}

// ファイル名に使えない文字を除く
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]/g, '');

// 'YYYY-MM-DD' → 'YYMMDD'
const yymmdd = (ymd) => {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1].slice(2) + m[2] + m[3] : '';
};

// ファイル名（拡張子なし）
export function photoFileName(tree, slotName, date, cfg) {
  const vars = { no: safe(toHalf(tree.treeNo)) || '番号なし', name: safe(slotName), yymmdd: yymmdd(date), date: safe(date) };
  return cameraOf(cfg).fileName.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// 同じ名前の写真があれば、後ろに -2, -3 … を付ける（撮り直した写真・同じ名前の別の枠と区別する）
export function uniqueName(name, photos) {
  const used = new Set(photos.filter((p) => !p.retired).map((p) => p.name));
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}

// その木の写真（撮り直していない最新を、枠ごとに）
export function currentPhotos(photos, key) {
  const out = {};
  for (const p of photos || []) {
    if (p.key !== key || p.retired) continue;
    if (!out[p.slot] || String(p.takenAt) > String(out[p.slot].takenAt)) out[p.slot] = p;
  }
  return out;
}

// 任意の写真の枠
export const EXTRA_PREFIX = 'x:';
export const isExtraSlot = (slot) => String(slot || '').startsWith(EXTRA_PREFIX);

// 任意の写真の名前を整える（前後の空白を除く。ファイル名に使えない文字は photoFileName で除く）
export const extraName = (s) => String(s || '').trim();

// その木の任意の写真（使っているもの。入れた順）
export function extraPhotos(photos, key) {
  return Object.values(currentPhotos(photos, key))
    .filter((p) => isExtraSlot(p.slot))
    .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
}

// 撮る写真の進み具合：{ need: 枠の数, taken: 撮った枠の数, missing: [撮っていない枠の名前], extra: [今は要らない枠の写真] }
//  任意の写真は数に入れない（extra にも入れない）
export function shotStatus(plan, photos, key) {
  const cur = currentPhotos(photos, key);
  const slots = plan.slots || [];
  const missing = slots.filter((s) => !cur[s.key]).map((s) => s.name);
  const extra = Object.values(cur).filter((p) => !isExtraSlot(p.slot) && !slots.some((s) => s.key === p.slot));
  return { need: slots.length, taken: slots.length - missing.length, missing, extra };
}

// 写真を「使わない」にする（消さずに、撮り直しと同じ印を付ける。サーバーにも知らせる）
export function retireShot(photos, id, at) {
  return (photos || []).map((p) => (p.id === id && !p.retired ? { ...p, retired: true, retiredAt: at, sentRetire: false } : p));
}

// アルバムの写真の撮影日が、診断日と違うか（違えば知らせる。別の日・別の木の写真の取り違えを防ぐ）
export function shotDateDiffers(shotAt, date) {
  const d = String(shotAt || '').slice(0, 10);
  return !!d && !!date && d !== String(date).slice(0, 10);
}

// 写真の向き（幅と高さから）
export const orientOf = (w, h) => (h > w ? '縦' : '横');

// 新しい写真を記録に足す。同じ木・同じ枠の前の写真は「撮り直し」の印を付けて残す
export function addShot(photos, rec) {
  const list = (photos || []).map((p) => (p.key === rec.key && p.slot === rec.slot && !p.retired ? { ...p, retired: true, retiredAt: rec.takenAt, sentRetire: false } : p));
  return [...list, rec];
}

// 送る写真（本体が端末にあり、まだサーバーに届いていない）
export const unsentPhotos = (photos) => (photos || []).filter((p) => !p.fileId && p.local === 'full');
// サーバーに知らせる「撮り直し」の印
export const unsentRetires = (photos) => (photos || []).filter((p) => p.fileId && p.retired && !p.sentRetire);

// サーバーから受け取った写真の一覧を、端末の記録に合わせる
//  端末にある写真は、サーバーの印（fileId・撮り直し）だけを足す。端末にない写真は「本体なし」で足す
//  端末の写真を消すことはない
export function mergeRemote(photos, remote) {
  const byId = new Map((photos || []).map((p) => [p.id, p]));
  for (const r of remote || []) {
    const cur = byId.get(r.id);
    if (cur) byId.set(r.id, { ...cur, fileId: cur.fileId || r.fileId, seq: r.seq, retired: cur.retired || !!r.retired, sentRetire: cur.sentRetire || !!r.retired });
    else byId.set(r.id, { ...r, local: '', retired: !!r.retired, sentRetire: true });
  }
  return [...byId.values()];
}

// 空き容量の確かめ（navigator.storage.estimate の結果から）
//  写真で容量がいっぱいになると、入力内容（と同じドメインの本番の野帳アプリ）が保存できなくなる。
//  そうならないよう、余裕を残して止める：使った量が上限の8割を超える、または空きが 200MB（上限が小さければ上限の2割）を切るとき
export function storageRoom(estimate, bytes = 0) {
  const quota = Number(estimate?.quota) || 0;
  const usage = Number(estimate?.usage) || 0;
  if (!quota) return { ok: true, unknown: true, quota, usage };
  const reserve = Math.min(200 * 1024 * 1024, quota * 0.2);
  const ok = usage + bytes <= quota * 0.8 && quota - usage - bytes >= reserve;
  return { ok, quota, usage, free: quota - usage };
}

// 端末に本体が残っている写真の大きさの合計
export const localBytes = (photos) => (photos || []).filter((p) => p.local === 'full').reduce((n, p) => n + (Number(p.bytes) || 0), 0);

// 容量を人が読める形に
export const sizeText = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)}GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)}MB` : `${Math.round(b / 1024)}KB`);
