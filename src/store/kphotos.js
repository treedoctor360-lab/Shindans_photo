// カルテに貼る写真の置き場所（端末内。業務ごと・まとまりごと）
//  一覧（写真の名前・撮影日時・大きさ・番号の写真の印・木ごとの選んだ内容）は鍵 `kphotos:<まとまりの鍵>`、
//  写真の中身（小さくした JPEG と、一覧用のさらに小さい絵）は写真ごとに鍵 `kphoto:<写真の id>` に置く。
//  （一覧を書き換えるたびに写真の中身まで書き直さないように分ける）
//  サーバーには送らない（この端末の中だけ）。入力内容の記録（木）とは別なので、送受信・確定には影響しない。
import { idbDelete, idbGet, idbPut } from './idb.js';

const listKey = (group) => `kphotos:${group}`;
const dataKey = (id) => `kphoto:${id}`;

export const emptyKPhotos = () => ({ photos: [], picks: {} });

export async function loadKPhotos(group) {
  const v = await idbGet(listKey(group));
  return v && Array.isArray(v.photos) ? { photos: v.photos, picks: v.picks || {} } : emptyKPhotos();
}
export const saveKPhotos = (group, value) => idbPut(listKey(group), value);

// 写真の中身：{ data: ArrayBuffer（カルテに貼る JPEG）, thumb: ArrayBuffer（一覧用） }
export const putKPhotoData = (id, value) => idbPut(dataKey(id), value);
export const getKPhotoData = (id) => idbGet(dataKey(id));
// 外した写真の中身を端末から消す（人が「外す」を押して確かめたときだけ呼ぶ）
export const deleteKPhotoData = (id) => idbDelete(dataKey(id));
