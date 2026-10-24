// オフラインでもアプリを開けるようにする仕組み（サービスワーカー：ブラウザの裏で動く小さなプログラム）
//
//  画面（index.html）… まず通信して最新を取りに行き、つながらなければ保存しておいたものを使う
//  部品（js・css・画像・フォント）… 保存しておいたものを使い、なければ通信して保存する
//    部品のファイル名には中身ごとに変わる印（ハッシュ）が付くので、古い部品を使ってしまうことはない
//  サーバー（GAS）への通信は扱わない（そのままブラウザに任せる）

// 本番の野帳アプリの古い控えの片付け（'shindans-' で始まるものを消す）に巻き込まれないよう、'shindans-' で始めない
const PREFIX = 'shindansphoto-';
const CACHE = `${PREFIX}v1`;

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 新しい版をすぐ使い始める
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon-192.png'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // 消すのはこのアプリの古い保存だけ。同じドメインの別のアプリの保存は残す（保存の場所はドメインごとに共有されるため）
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const sameOrigin = (url) => url.origin === self.location.origin;
const isFont = (url) => /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!sameOrigin(url) && !isFont(url)) return;

  if (req.mode === 'navigate') {
    // 画面：通信優先
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const c = await caches.open(CACHE);
          c.put('./', res.clone());
          return res;
        } catch {
          return (await caches.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  // 部品：保存したもの優先
  e.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});
