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

// 業務ごとの置き場所（src/store/workspace.js）
//  同じデータベースの中で、鍵の頭に業務の印を付けて分ける。最初の業務（印が空）は今までどおりの鍵のまま
//  （前から入っている入力内容は、そのまま最初の業務として読める）。
//  印は起動したときに1回だけ決める（途中で変えると、保存の待ち時間に古い業務の内容が新しい業務に書かれるため）
let wsId = '';
export const wsKey = (id, key) => (id ? `ws:${id}:${key}` : key);
export function setWorkspaceId(id) {
  wsId = id || '';
}

export const idbGet = (key) => run('readonly', (s) => s.get(wsKey(wsId, key)));
export const idbPut = (key, value) => run('readwrite', (s) => s.put(value, wsKey(wsId, key)));
export const idbDelete = (key) => run('readwrite', (s) => s.delete(wsKey(wsId, key)));

// 業務を選ばずに読み書きする（業務の一覧そのもの・別の業務へ書くとき）
export const idbGetRaw = (key) => run('readonly', (s) => s.get(key));
export const idbPutRaw = (key, value) => run('readwrite', (s) => s.put(value, key));

// テスト用：開いているデータベースを閉じて、次は開き直す
export async function idbReset() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  wsId = '';
}
