// 端末内の保存（IndexedDB：ブラウザの中にあるデータベース）
// 「キー → 値」の形で保存する小さな道具。値は文字・数・オブジェクト・ファイルの中身（ArrayBuffer）を入れられる。

// 本番の野帳アプリ（同じ github.io のドメイン）と別の名前にする。同じ名前だと、同じスマホで両方を開いたときに入力内容が混ざる・上書きされる
const DB_NAME = 'shindans_photo';
const STORE = 'kv';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// 読み書きを1回行う（mode：'readonly' か 'readwrite'）
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    // 書き込みは「全部書き終わった（complete）」ときに成功とする
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const idbGet = (key) => run('readonly', (s) => s.get(key));
export const idbPut = (key, value) => run('readwrite', (s) => s.put(value, key));
export const idbDelete = (key) => run('readwrite', (s) => s.delete(key));

// テスト用：開いているデータベースを閉じて、次は開き直す
export async function idbReset() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
