// 写真の記録・保存・送受信のテスト
//  端末内の写真の置き場所は fake-indexeddb（Node 用の IndexedDB の代わり）、サーバーは「にせの Google」で gas/Code.js をそのまま動かす
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { blankTree } from '../src/core/tree.js';
import { addShot, currentPhotos, mergeRemote, photoFileName, shotStatus, storageRoom, uniqueName } from '../src/core/photoShots.js';
import { photoGet, photoPut } from '../src/store/photoDb.js';
import { makeRoom, photoBytes, recoverPhotos, savePhoto, syncPhotos } from '../src/store/photos.js';
import { initialState, migrate } from '../src/store/state.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const MB = 1024 * 1024;
const tree = (o = {}) => blankTree({ id: 'a1', treeNo: 'AB001', siteType: 'park', parkName: '架空公園', source: 'app', date: '2099-05-06', ...o });

// 状態の入れ物（画面の useAppState の代わり）
function store(o = {}) {
  let st = { ...migrate(initialState()), trees: [tree()], ...o };
  return {
    getState: () => st,
    update: (fn) => {
      st = fn(st);
      return Promise.resolve();
    },
  };
}
// 決まりの大きさに整えた写真の代わり（中身は印の文字）
const shaped = (mark, w = 640, h = 480) => ({ full: new Blob([`full:${mark}`.padEnd(2000, '.')]), thumb: new Blob([`thumb:${mark}`]), w, h });
const roomy = async () => ({ quota: 2000 * MB, usage: 10 * MB });
const full = { key: 'full', name: '全景', orient: '縦' };
const weak = { key: 'w:腐朽', name: '腐朽', orient: '横' };

describe('写真の記録（計算）', () => {
  it('ファイル名は「樹木番号＋写真の名前＋診断日(YYMMDD)」。同じ名前は -2 を付ける', () => {
    expect(photoFileName(tree({ treeNo: 'ＡＢ００１' }), '全景', '2099-05-06', cfg)).toBe('AB001全景990506');
    expect(uniqueName('AB001全景990506', [{ name: 'AB001全景990506' }])).toBe('AB001全景990506-2');
  });

  it('撮り直すと前の写真に印を付けて残す（消さない）。使うのは最新の1枚', () => {
    let ps = addShot([], { id: 'p1', key: 'k', slot: 'full', takenAt: '1' });
    ps = addShot(ps, { id: 'p2', key: 'k', slot: 'full', takenAt: '2' });
    expect(ps).toHaveLength(2);
    expect(ps[0].retired).toBe(true);
    expect(currentPhotos(ps, 'k').full.id).toBe('p2');
    expect(shotStatus({ slots: [full, weak] }, ps, 'k')).toMatchObject({ need: 2, taken: 1, missing: ['腐朽'] });
  });

  it('サーバーの一覧を合わせても、端末の写真は消えない', () => {
    const mine = [{ id: 'p1', key: 'k', slot: 'full', local: 'full' }];
    const m = mergeRemote(mine, [{ id: 'p1', fileId: 'f1', seq: 1 }, { id: 'p9', key: 'k', slot: 'w:腐朽', fileId: 'f9', seq: 2 }]);
    expect(m.find((p) => p.id === 'p1')).toMatchObject({ local: 'full', fileId: 'f1' });
    expect(m.find((p) => p.id === 'p9')).toMatchObject({ local: '' });
    expect(mergeRemote(m, [])).toHaveLength(2);
  });

  it('空きの確かめ：上限の8割を超える・空きが 200MB を切るなら止める', () => {
    expect(storageRoom({ quota: 1000 * MB, usage: 100 * MB }, MB).ok).toBe(true);
    expect(storageRoom({ quota: 1000 * MB, usage: 799 * MB }, 2 * MB).ok).toBe(false);
    expect(storageRoom({ quota: 10000 * MB, usage: 9850 * MB }, MB).ok).toBe(false);
    expect(storageRoom(null).ok).toBe(true); // 分からないブラウザでは止めない
  });
});

describe('写真の保存（端末）', () => {
  it('端末に書いて読み直してから記録に足す。置き場所にも記録の写しを置く', async () => {
    const s = store();
    const r = await savePhoto({ ...s, cfg, tree: tree(), slot: full, shaped: shaped('A', 480, 640), estimate: roomy });
    expect(r.warn).toBe('');
    expect(s.getState().photos).toHaveLength(1);
    const back = await photoGet(r.rec.id);
    expect(back.full.byteLength).toBe(r.rec.bytes);
    expect(back.meta).toMatchObject({ id: r.rec.id, slot: 'full', name: 'AB001全景990506' });
  });

  it('向きが決まりと違えば知らせる（保存はする）', async () => {
    const s = store();
    const r = await savePhoto({ ...s, cfg, tree: tree(), slot: full, shaped: shaped('B', 640, 480), estimate: roomy });
    expect(r.warn).toContain('縦向きの決まり');
    expect(s.getState().photos).toHaveLength(1);
  });

  it('記録の保存ができなかった写真は、起動時に置き場所の写しから戻す', async () => {
    const s = store();
    const r = await savePhoto({ ...s, cfg, tree: tree(), slot: weak, shaped: shaped('C'), estimate: roomy });
    // 記録が消えた（保存できなかった）ことにする
    const lost = store({ photos: [] });
    const n = await recoverPhotos(lost);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(lost.getState().photos.find((p) => p.id === r.rec.id)).toMatchObject({ slot: 'w:腐朽', fileId: '', local: 'full' });
    // もう一度起動しても増えない
    expect(await recoverPhotos(lost)).toBe(0);
  });

  it('空きが足りないとき：送信済みの写真の本体だけを古い順に外す。未送信の写真には触らない', async () => {
    const s = store();
    const a = await savePhoto({ ...s, cfg, tree: tree(), slot: full, shaped: shaped('D1'), estimate: roomy, now: new Date('2099-05-06T01:00:00Z') });
    const b = await savePhoto({ ...s, cfg, tree: tree(), slot: weak, shaped: shaped('D2'), estimate: roomy, now: new Date('2099-05-06T02:00:00Z') });
    // a だけ送信済みにする
    await s.update((cur) => ({ ...cur, photos: cur.photos.map((p) => (p.id === a.rec.id ? { ...p, fileId: 'f1' } : p)) }));
    // 端末に本体が残っている写真の数だけ使っている、という空き具合
    const est = async () => ({ quota: 1000 * MB, usage: 600 * MB + s.getState().photos.filter((p) => p.local === 'full').length * 100 * MB });
    const r = await makeRoom({ ...s, need: MB, estimate: est });
    expect(r).toEqual({ ok: true, dropped: 1 });
    expect((await photoGet(a.rec.id)).full).toBeNull();
    expect((await photoGet(a.rec.id)).thumb).toBeTruthy(); // 見本は残る
    expect((await photoGet(b.rec.id)).full).toBeTruthy(); // 未送信は残る
    // それでも足りなければ保存しない（未送信の写真は外さない）
    const full2 = async () => ({ quota: 1000 * MB, usage: 990 * MB });
    await expect(savePhoto({ ...s, cfg, tree: tree(), slot: full, shaped: shaped('D3'), estimate: full2 })).rejects.toThrow('空きが少ない');
    expect((await photoGet(b.rec.id)).full).toBeTruthy();
    expect(s.getState().photos).toHaveLength(2);
  });
});

describe('写真の送受信（サーバー）', () => {
  const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'dev1' };

  it('送ると公園・路線のフォルダに置かれ、届いた印が付く。端末の本体は残す。他の端末は一覧を受け取り、本体はサーバーから取り出す', async () => {
    const g = makeFakeGas();
    const fetchFn = g.fetchFn;
    const s = store({ server: { ...server } });
    const r = await savePhoto({ ...s, cfg, tree: tree(), slot: full, shaped: shaped('E'), estimate: roomy });
    const res = await syncPhotos({ ...s, cfg, fetchFn });
    expect(res.sent).toBe(1);
    const mine = s.getState().photos[0];
    expect(mine.fileId).toBeTruthy();
    expect(mine.local).toBe('full');
    expect((await photoGet(r.rec.id)).full).toBeTruthy();
    const file = g.files.get(mine.fileId);
    expect(file.name).toBe('AB001全景990506.jpg');
    expect(file.folder).toMatch(/データ\/写真\/.+/);

    // 送り直しても（返事が切れた想定）、サーバーで2枚にならない
    await s.update((cur) => ({ ...cur, photos: cur.photos.map((p) => ({ ...p, fileId: '' })) }));
    await syncPhotos({ ...s, cfg, fetchFn });
    expect(g.sheets.get('photos').cells.length - 1).toBe(1);

    // 別の端末
    const other = store({ server: { ...server, deviceId: 'dev2' }, photos: [] });
    const got = await syncPhotos({ ...other, cfg, fetchFn });
    expect(got.got).toBe(1);
    const p = other.getState().photos[0];
    expect(p).toMatchObject({ id: r.rec.id, local: '', fileId: mine.fileId });
    // 他の端末で使う本体は、この端末の置き場所にないのでサーバーから
    const fake = { ...p, id: 'not-on-this-device' };
    await expect(photoBytes(other.getState().server, fake, fetchFn)).rejects.toThrow();
    const bytes = await photoBytes(other.getState().server, { ...p }, fetchFn);
    expect(bytes.byteLength).toBe(r.rec.bytes);
  });

  it('撮り直しの印もサーバーに届き、他の端末に伝わる（どちらの写真も消えない）', async () => {
    const g = makeFakeGas();
    const fetchFn = g.fetchFn;
    const s = store({ server: { ...server } });
    await savePhoto({ ...s, cfg, tree: tree(), slot: weak, shaped: shaped('F1'), estimate: roomy, now: new Date('2099-05-06T01:00:00Z') });
    await syncPhotos({ ...s, cfg, fetchFn });
    await savePhoto({ ...s, cfg, tree: tree(), slot: weak, shaped: shaped('F2'), estimate: roomy, now: new Date('2099-05-06T02:00:00Z') });
    await syncPhotos({ ...s, cfg, fetchFn });
    const rows = g.sheets.get('photos').cells.slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r[5] === '1')).toHaveLength(1);
    const other = store({ server: { ...server, deviceId: 'dev2' }, photos: [] });
    await syncPhotos({ ...other, cfg, fetchFn });
    const ps = other.getState().photos;
    expect(ps).toHaveLength(2);
    expect(ps.filter((p) => p.retired)).toHaveLength(1);
    // 撮り直した写真は同じ名前（納品に使うのは新しい方だけ）
    expect(s.getState().photos.find((p) => p.retired).name).toBe(s.getState().photos.find((p) => !p.retired).name);
  });

  it('サーバーに届いた大きさが違えば、届いた印を付けない（送り直す）', async () => {
    const g = makeFakeGas();
    const s = store({ server: { ...server } });
    await savePhoto({ ...s, cfg, tree: tree(), slot: full, shaped: shaped('G'), estimate: roomy });
    const broken = async (url, init) => {
      const r = await g.fetchFn(url, init);
      const body = JSON.parse(init.body);
      if (body.action !== 'photoPut') return r;
      const j = await r.json();
      return { ok: true, status: 200, json: async () => ({ ...j, bytes: 1 }) };
    };
    await expect(syncPhotos({ ...s, cfg, fetchFn: broken })).rejects.toThrow('正しく届きませんでした');
    expect(s.getState().photos[0].fileId).toBe('');
  });

  it('端末の置き場所の書き込みは、入力内容のデータベースと別の名前', async () => {
    await photoPut('x', { full: null });
    const dbs = await indexedDB.databases();
    expect(dbs.map((d) => d.name)).toContain('shindans_photo_images');
    expect(dbs.map((d) => d.name)).not.toContain('shindans');
  });
});

describe('端末に残す写真の量の上限', () => {
  it('上限（photo.camera.localMB）を超えたら、送信済みの写真の本体を古い順に外す。未送信は残して撮れる', async () => {
    const c = { ...cfg, photo: { ...cfg.photo, camera: { localMB: 0.003 } } }; // 約3KB（写真1枚は約2KB）
    const s = store();
    const a = await savePhoto({ ...s, cfg: c, tree: tree(), slot: full, shaped: shaped('H1'), estimate: roomy, now: new Date('2099-05-06T01:00:00Z') });
    await s.update((cur) => ({ ...cur, photos: cur.photos.map((p) => ({ ...p, fileId: 'f1' })) }));
    const b = await savePhoto({ ...s, cfg: c, tree: tree(), slot: weak, shaped: shaped('H2'), estimate: roomy, now: new Date('2099-05-06T02:00:00Z') });
    expect(b.dropped).toBe(1);
    expect((await photoGet(a.rec.id)).full).toBeNull();
    // 未送信（b）しかないときは外さずに撮れる
    const d = await savePhoto({ ...s, cfg: c, tree: tree(), slot: full, shaped: shaped('H3'), estimate: roomy, now: new Date('2099-05-06T03:00:00Z') });
    expect(d.dropped).toBe(0);
    expect((await photoGet(b.rec.id)).full).toBeTruthy();
  });
});
