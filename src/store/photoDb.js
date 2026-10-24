// 写真の本体の置き場所（端末内の IndexedDB）
//
// 入力内容（idb.js の 'shindans_photo'）とは別のデータベースに置く。
//  ・写真は大きいので、入力内容の保存（入力のたびに行う）と混ぜない
//  ・写真の保存に失敗しても、入力内容の保存には響かない
// 1件の形：鍵＝写真の id → { full: 写真（ArrayBuffer）または null, thumb: 小さな見本, type, meta: 写真の記録の写し }
//  meta を一緒に置くのは、入力内容の保存（写真の記録）が万一できなかったときに、ここから記録を戻せるようにするため
//  本体（full）を外すのは、サーバーに届いたことを確かめた写真だけ、しかも端末の空きが足りなくなったときだけ（photos.js の makeRoom）

// 本番の野帳アプリ（'shindans'）とも、入力内容（'shindans_photo'）とも別の名前
export const PHOTO_DB_NAME = 'shindans_photo_images';
const STORE = 'photos';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(PHOTO_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => {
      dbPromise = null; // 次の機会に開き直せるように
      throw e;
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    // 書き込みは「全部書き終わった（complete）」ときに成功とする
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
  });
}

export const photoGet = (id) => run('readonly', (s) => s.get(id));
export const photoPut = (id, value) => run('readwrite', (s) => s.put(value, id));
// 置いてある写真の印の一覧
export const photoKeys = () => run('readonly', (s) => s.getAllKeys());

// 本体（full）だけを外して見本を残す。サーバーに届いたことを確かめた写真だけに使う
export async function photoDropFull(id) {
  const cur = await photoGet(id);
  if (!cur || !cur.full) return;
  await photoPut(id, { ...cur, full: null });
}

// テスト用：開いているデータベースを閉じて、次は開き直す
export async function photoDbReset() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
