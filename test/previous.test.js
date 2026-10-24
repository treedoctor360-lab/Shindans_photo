// 前回の調査（カルテ）の読み込み・まとめ・木との結び付け・サーバーへの受け渡し
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { checked, readKarteBook } from '../src/excel/karte.js';
import { blankTree } from '../src/core/tree.js';
import { validateConfig } from '../src/core/config.js';
import { idbReset } from '../src/store/idb.js';
import {
  buildPrevious,
  clearPrevious,
  fieldSheetMarks,
  getPreviousIndex,
  getPreviousPhotos,
  loadAllPrevious,
  loadIndex,
  loadPhotos,
  photosOf,
  prevCount,
  prevKey,
  prevOf,
  putPrevious,
  savePrevious,
} from '../src/store/previous.js';
import { makeKarte, TINY_JPEG } from './helpers/makeKarte.js';
import { makeFakeGas } from './helpers/fakeGas.js';

const cfg = structuredClone(cfgJson);
const order = cfg.previous.kartes.map((k) => k.id);
const server = { url: 'https://example.invalid/exec', pass: 'ひみつ', deviceId: 'pc' };
const read = async (trees) => (await readKarteBook(await makeKarte(trees), cfg, '架空.xlsx')).trees;

beforeEach(async () => {
  await idbReset();
  indexedDB.deleteDatabase('shindans_photo');
});

describe('カルテを読む', () => {
  it('1本1シートから、番号・場所・樹種・日付・「有」の弱点・評価・写真を読む。カルテでないシートは飛ばす', async () => {
    const r = await readKarteBook(await makeKarte(), cfg, '架空.xlsx');
    expect(r.skipped).toEqual(['架空.xlsx 一覧']);
    expect(r.trees.map((t) => t.treeNo)).toEqual(['AB001', 'AB002']);
    const t = r.trees[0];
    expect(t).toMatchObject({ kind: 'detail', title: '前回の詳しい診断', code: 'K01', placeName: '架空公園', species: 'テストノキ', date: '2090-09-01' });
    expect(t.inspector).toBe('試験 一郎(資格)・試験 二郎(資格)');
    // 基本情報：設定の info の順に「見出し 値」。見出しの末尾の「：」は外す・title があればその名前
    expect(t.info).toEqual([
      { label: '調べた日', value: '2090-09-01' },
      { label: '木の種類', value: 'テストノキ' },
      { label: '植えた年', value: '1990' },
      { label: '手入れ', value: '年に1回' },
      { label: '高さ', value: '12.3 m' }, // 数は Excel の小数の誤差を除き、unit を付ける
    ]);
    expect(t.items).toEqual([
      { part: '枝', item: '②折れた枝', result: '有', grade: 'C', detail: '1本、地上約5m' },
      { part: '幹', item: '①うろ', result: '有（大）', grade: 'E', detail: '地上0～1m、30×20cm' },
      { part: '根', item: '①根の傷み', result: '有（小）', grade: 'D', detail: '根元' },
    ]);
    expect(t.summary).toEqual([
      { label: '見た目の評価', lines: ['生育 B', '危険度 E うろ・根の傷み'] }, // 「飾り」は除く
      { label: 'まとめ', lines: ['D 幹のうろが大きい。'] },
    ]);
    expect(t.photos.map((p) => [p.caption, p.type])).toEqual([
      ['全体の写真', 'image/jpeg'],
      ['弱点の図', 'image/jpeg'],
    ]);
    expect(Buffer.from(t.photos[0].buffer)).toEqual(TINY_JPEG);
    expect(r.trees[1].photos).toEqual([]);
  });

  it('種類の違うカルテは表題で見分ける。日付の通し番号・チェック欄・左右に並んだ写真・写真の下の名前', async () => {
    const [t] = await read([{ no: 'AB001', kind: 'place' }]);
    expect(t).toMatchObject({ kind: 'place', title: '周りの様子', treeNo: 'AB001', code: 'K01', date: '2021-10-13', species: '' });
    expect(t.items).toEqual([{ part: 'まわり', item: '人の通行', result: '有', grade: '', detail: '歩く人' }]);
    expect(t.summary).toEqual([{ label: '土地の使われ方', lines: ['住宅地'] }]);
    expect(t.photos.map((p) => p.caption)).toEqual(['配置の図', '周りの写真', '根元の様子']);
  });

  it('チェック欄は■の言葉だけ', () => {
    expect(checked('□Ａ　■Ｂ　□Ｃ')).toBe('Ｂ');
    expect(checked('■必要　□不要')).toBe('必要');
    expect(checked('□無　□有')).toBe('');
    expect(checked('ふつうの文')).toBe('ふつうの文');
  });

  it('設定に読み方がなければ知らせる。読み方の設定が不正なら設定ごと使わない。以前の形（1種類）も使える', async () => {
    const { previous, ...noPrev } = cfg;
    await expect(readKarteBook(await makeKarte(), noPrev)).rejects.toThrow('previous.kartes');
    expect(validateConfig(noPrev).ok).toBe(true); // 省略してよい
    expect(validateConfig(cfg).ok).toBe(true);
    const bad = { ...cfg, previous: { kartes: [{ id: 'a', fields: {}, yesMark: '■有' }] } };
    expect(validateConfig(bad).errors.join()).toMatch('treeNo');
    const dup = { ...cfg, previous: { kartes: [cfg.previous.kartes[0], cfg.previous.kartes[0]] } };
    expect(validateConfig(dup).errors.join()).toMatch('重複');
    const { id, match, ...one } = cfg.previous.kartes[0];
    const legacy = { ...cfg, previous: { karte: one } };
    expect(validateConfig(legacy).ok).toBe(true);
    expect((await readKarteBook(await makeKarte(), legacy)).trees).toHaveLength(2);
  });
});

describe('まとめて、木と結び付ける', () => {
  const park = (o) => blankTree({ siteType: 'park', parkCode: 'K01', ...o });

  it('1本に種類の違うカルテをまとめる。要点は全部を1つに、写真は場所ごとに分ける', async () => {
    const a = await read([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }, { no: 'AB002', species: 'ミホンカエデ', withPhoto: false }]);
    const b = await read([{ no: 'AB001', code: 'K09', species: '別の樹種' }]);
    const p = buildPrevious([...a, ...b], 'now', order);
    expect(Object.keys(p.index.trees)).toEqual(['K01|AB001', 'K01|AB002', 'K09|AB001']);
    expect(p.index.trees['K01|AB001'].map((k) => k.kind)).toEqual(['detail', 'place']);
    expect(p.index.trees['K01|AB001'][1]).toMatchObject({ photoCount: 3, packId: 'p1' });
    expect(p.index.trees['K01|AB001'][0].photos).toBeUndefined(); // 要点に写真は入れない
    expect(p.index.packs).toEqual({ p1: { code: 'K01', count: 5 }, p2: { code: 'K09', count: 2 } });
    expect(photosOf(p.packs.p1, 'K01|AB001', 'place').map((x) => x.caption)).toEqual(['配置の図', '周りの写真', '根元の様子']);
    expect(p.duplicates).toEqual([]);
    expect(buildPrevious([...a, ...a], 'now', order).duplicates).toHaveLength(3);
  });

  it('何回かに分けて読み込める（同じ木・同じ種類は新しい方に入れ替え、場所の束の番号は変えない）', async () => {
    const first = buildPrevious(await read([{ no: 'AB001' }]), 'now', order);
    const second = buildPrevious(await read([{ no: 'AB001', kind: 'place' }, { no: 'AB009', code: 'K09' }]), 'later', order, first);
    expect(second.index.trees['K01|AB001'].map((k) => k.kind)).toEqual(['detail', 'place']);
    expect(Object.keys(second.packs.p1['K01|AB001'])).toEqual(['detail', 'place']);
    expect(second.index.packs).toEqual({ p1: { code: 'K01', count: 5 }, p2: { code: 'K09', count: 2 } });
    expect(second.duplicates).toEqual([]); // 前の回の分を入れ替えるのは、重複ではない
    expect(first.index.trees['K01|AB001']).toHaveLength(1); // 土台は書き換えない
  });

  it('場所のコード＋番号で結び付ける（全角でも）。番号が同じでも場所が違えば別の木。樹種が違えば知らせる', async () => {
    const { index } = buildPrevious(await read(), 'now', order);
    expect(prevOf(park({ treeNo: 'ＡＢ００１', species: 'テストノキ' }), index, cfg)).toMatchObject({ speciesMismatch: false });
    expect(prevOf(park({ treeNo: 'AB001' }), index, cfg).kartes[0].treeNo).toBe('AB001');
    expect(prevOf(park({ treeNo: 'AB001', parkCode: 'K09' }), index, cfg)).toBeNull();
    expect(prevOf(park({ treeNo: 'AB003' }), index, cfg)).toBeNull();
    expect(prevOf(park({ treeNo: 'AB001', species: 'ちがう木' }), index, cfg).speciesMismatch).toBe(true);
    expect(prevOf(park({ treeNo: 'AB001', species: '' }), index, cfg).speciesMismatch).toBe(false); // 樹種未入力は比べない
    expect(prevOf(park({ treeNo: 'AB002', parkCode: '' }), index, cfg)).not.toBeNull(); // 番号だけで1つに決まる
    expect(prevKey(' K01 ', 'ab001')).toBe('K01|AB001');
  });

  it('野帳に書く前回の印：印の設定がある種類のカルテだけ、年を付けて。樹種が違う木には付けない', async () => {
    const { index } = buildPrevious(await read([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }]), 'now', order);
    const specs = cfg.previous.kartes;
    expect(fieldSheetMarks(park({ treeNo: 'AB001', species: 'テストノキ' }), index, cfg, specs)).toEqual(['前回詳(2090)']);
    expect(fieldSheetMarks(park({ treeNo: 'AB001', species: 'ちがう木' }), index, cfg, specs)).toEqual([]);
    expect(fieldSheetMarks(park({ treeNo: 'AB009' }), index, cfg, specs)).toEqual([]);
    expect(fieldSheetMarks(park({ treeNo: 'AB001' }), null, cfg, specs)).toEqual([]);
  });

  it('以前の形（1種類だけの「カルテ」）で読んだ分と、同じ調査を今の形で読み直した分が、二重に出ない', async () => {
    const now = (await read([{ no: 'AB001' }]))[0];
    const legacy = { treeNo: 'AB001', code: 'K01', species: 'テストノキ', date: now.date, items: [], packId: 'p1' };
    const base = { index: { version: 1, karte: { 'K01|AB001': legacy }, packs: { p1: { code: 'K01', count: 1 } } }, packs: { p1: { 'K01|AB001': [{ caption: '古い写真' }] } } };
    // 端末やサーバーに古い分が残ったままでも、画面には二重に出さない
    const mixed = { ...base.index, version: 2, trees: { 'K01|AB001': [{ kind: 'karte', title: '', ...legacy }, { ...now, packId: 'p1' }] } };
    expect(prevOf(park({ treeNo: 'AB001' }), mixed, cfg).kartes.map((k) => k.kind)).toEqual(['detail']);
    // 読み直すと、古い分（と写真）は入れ替わって消える
    const p = buildPrevious([now], 'later', order, base);
    expect(p.index.trees['K01|AB001'].map((k) => k.kind)).toEqual(['detail']);
    expect(Object.keys(p.packs.p1['K01|AB001'])).toEqual(['detail']);
    // 日付が違う（別の回の調査）なら残す
    const other = { ...base, index: { ...base.index, karte: { 'K01|AB001': { ...legacy, date: '2000-01-01' } } } };
    expect(buildPrevious([now], 'later', order, other).index.trees['K01|AB001'].map((k) => k.kind)).toEqual(['detail', 'karte']);
  });

  it('以前の形（版1）の要点・写真も読める', () => {
    const v1 = { version: 1, karte: { 'K01|AB001': { treeNo: 'AB001', code: 'K01', species: 'テストノキ', items: [], packId: 'p1' } }, packs: {} };
    expect(prevCount(v1)).toBe(1);
    expect(prevOf(park({ treeNo: 'AB001' }), v1, cfg).kartes[0].kind).toBe('karte');
    expect(photosOf({ 'K01|AB001': [{ caption: 'x' }] }, 'K01|AB001', 'karte')).toEqual([{ caption: 'x' }]);
  });
});

describe('端末とサーバー（にせの Google）', () => {
  it('PC で置いた要点と写真を、スマホが受け取れる（写真は場所ごと）', async () => {
    const g = makeFakeGas();
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }, { no: 'AB002' }]), 'now', order));
    const steps = [];
    expect(await putPrevious(server, (d, n) => steps.push(`${d}/${n}`), g.fetchFn)).toBe(2);
    expect(steps).toEqual(['1/2', '2/2']);

    // スマホ（端末の中身を消してから受け取る）
    await idbReset();
    indexedDB.deleteDatabase('shindans_photo');
    expect(await loadIndex()).toBeUndefined();
    expect(await getPreviousIndex(server, g.fetchFn)).toBe(2);
    expect(await loadPhotos('p1')).toBeUndefined(); // 写真はまだ
    await getPreviousPhotos(server, 'p1', g.fetchFn);
    const photos = await loadPhotos('p1');
    expect(Buffer.from(photosOf(photos, 'K01|AB001', 'place')[0].data, 'base64')).toEqual(TINY_JPEG);
    await expect(getPreviousPhotos(server, 'p9', g.fetchFn)).rejects.toThrow('写真がありません');
  });

  it('サーバーが途中で一時的に断っても、待って置き直す。2回目からは、変わっていない写真は置かない', async () => {
    const g = makeFakeGas();
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }, { no: 'AB009', code: 'K02', place: '別の架空公園' }]), 'now', order));
    const calls = [];
    let failOnce = true;
    const flaky = async (url, init) => {
      const b = JSON.parse(init.body);
      calls.push(b.kind);
      if (b.kind === 'prevPhotos:p2' && failOnce) {
        failOnce = false;
        return { ok: false, status: 503, json: async () => ({}) }; // 一時的に断られる
      }
      return g.fetchFn(url, init);
    };
    const wait = async () => {};
    expect(await putPrevious(server, () => {}, flaky, { wait })).toBe(2);
    expect(calls).toEqual(['prevPhotos:p1', 'prevPhotos:p2', 'prevPhotos:p2', 'prevIndex']);

    // 何も変わっていなければ、要点だけ置く
    calls.length = 0;
    await putPrevious(server, () => {}, flaky, { wait });
    expect(calls).toEqual(['prevIndex']);
    // 別のサーバー（URL が違う）には全部置く
    calls.length = 0;
    await putPrevious({ ...server, url: 'https://example.invalid/other' }, () => {}, flaky, { wait });
    expect(calls).toEqual(['prevPhotos:p1', 'prevPhotos:p2', 'prevIndex']);
  });

  it('何度待っても断られたら、どこで止まったかを知らせる。もう一度置くと続きから', async () => {
    const g = makeFakeGas();
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }, { no: 'AB009', code: 'K02', place: '別の架空公園' }]), 'now', order));
    const calls = [];
    let down = true;
    const fetchFn = async (url, init) => {
      const b = JSON.parse(init.body);
      calls.push(b.kind);
      if (b.kind === 'prevPhotos:p2' && down) return { ok: false, status: 503, json: async () => ({}) };
      return g.fetchFn(url, init);
    };
    const wait = async () => {};
    await expect(putPrevious(server, () => {}, fetchFn, { wait })).rejects.toThrow(/K02.*503.*続きから/);
    expect(calls.filter((k) => k === 'prevPhotos:p2')).toHaveLength(3); // 3回まで試す
    expect(calls).not.toContain('prevIndex'); // 写真がそろうまで要点は置かない

    calls.length = 0;
    down = false;
    await putPrevious(server, () => {}, fetchFn, { wait });
    expect(calls).toEqual(['prevPhotos:p2', 'prevIndex']); // 置けた p1 は置き直さない
  });

  it('設定の誤りなど、待っても変わらない断りは、置き直さない', async () => {
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }]), 'now', order));
    let n = 0;
    const fetchFn = async () => {
      n++;
      return { ok: true, status: 200, json: async () => ({ ok: false, error: '合言葉が違います' }) };
    };
    await expect(putPrevious(server, () => {}, fetchFn, { wait: async () => {} })).rejects.toThrow('合言葉が違います');
    expect(n).toBe(1);
  });

  it('前回の調査を消すと、置いた記録も消える（次は全部置く）', async () => {
    const g = makeFakeGas();
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }]), 'now', order));
    await putPrevious(server, () => {}, g.fetchFn);
    await clearPrevious();
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }]), 'now', order));
    const calls = [];
    await putPrevious(server, () => {}, async (url, init) => (calls.push(JSON.parse(init.body).kind), g.fetchFn(url, init)));
    expect(calls).toEqual(['prevPhotos:p1', 'prevIndex']);
  });

  it('端末の分を全部読み出して足せる。消せる', async () => {
    await savePrevious(buildPrevious(await read([{ no: 'AB001' }]), 'now', order));
    const base = await loadAllPrevious();
    expect(Object.keys(base.packs.p1)).toEqual(['K01|AB001']);
    await savePrevious(buildPrevious(await read([{ no: 'AB002' }]), 'later', order, base));
    expect(prevCount(await loadIndex())).toBe(2);
    await clearPrevious();
    expect(await loadIndex()).toBeUndefined();
    expect(await loadPhotos('p1')).toBeUndefined();
  });

  it('サーバーは決まった種類のファイルしか受け取らない', () => {
    const { lib } = makeFakeGas();
    expect(['config', 'prevIndex', 'prevPhotos:p1', 'prevPhotos:p1234'].every(lib.isFileKind)).toBe(true);
    expect(['other', 'prevPhotos:', 'prevPhotos:../x', 'prevPhotos:p12345', 'prevPhotosp1'].some(lib.isFileKind)).toBe(false);
  });
});
