// カルテに写真を貼る・写真を木ごとに区切るテスト（架空の様式・架空の木。写真の中身は適当なバイト列）
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { blankTree } from '../src/core/tree.js';
import { photoCaptionKey, simpleKarteRecord } from '../src/core/simpleKarte.js';
import { exportKarte } from '../src/excel/karteExport.js';
import { addKartePhotos, placeInRange, sheetGrid } from '../src/excel/kartePhotos.js';
import { segmentsOf, setFull, slotPhotos, togglePick } from '../src/core/kartePhotoPlan.js';
import { exifDate } from '../src/ui/photoFile.js';
import { makeSimpleKarteTemplate as makeTemplate, simpleKarteConfig } from './helpers/makeSimpleKarte.js';

const base = simpleKarteConfig(cfgJson);
const slots = [
  { key: 'full', label: '全景', range: 'G2:H8', full: true },
  { key: 'p1', label: '写真1', range: 'A12:B14', caption: 1 },
  { key: 'p2', label: '写真2', range: 'C12:D14', caption: 2 },
];
const cfg = { ...base, karte: { ...base.karte, unconfirmedOk: true, photos: { slots, pad: 2, charPx: 8 } } };
const tree = (no, o = {}) => blankTree({ id: `t${no}`, treeNo: String(no), siteType: 'park', species: 'テストノキ', done: true, measuresV: 2, measures: [], ...o });
const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251);

describe('カルテに貼る写真', () => {
  it('設定の確かめ：今の形は通り、範囲のない枠・全景の枠が2つは断る', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (photos) => validateConfig({ ...cfg, karte: { ...cfg.karte, photos } }).ok;
    expect(bad({ slots: [{ key: 'a', label: 'A' }] })).toBe(false);
    expect(bad({ slots: [{ key: 'a', label: 'A', range: 'A1:B2', full: true }, { key: 'b', label: 'B', range: 'C1:D2', full: true }] })).toBe(false);
    expect(bad({ slots: [{ key: 'a', label: 'A', range: 'A1:B2' }, { key: 'a', label: 'B', range: 'C1:D2' }] })).toBe(false);
  });

  it('置き場所：縦横の比を変えずに枠に収め、中央に置く', () => {
    const xml = '<worksheet><sheetFormatPr defaultColWidth="9" defaultRowHeight="15"/><cols><col min="1" max="2" width="10" customWidth="1"/><col min="3" max="3" width="5" hidden="1"/></cols><sheetData><row r="1" ht="30"/></sheetData></worksheet>';
    const g = sheetGrid(xml, 8);
    expect([g.colPx(1), g.colPx(3), g.colPx(4)]).toEqual([80, 0, 72]); // 隠した列は 0、書かれていない列は既定の幅
    expect([g.rowPx(1), g.rowPx(2)]).toEqual([40, 20]);
    // 枠 A1:B2 は 160×60px。横長 400×200 の写真は高さに合わせて 120×60、左右の中央（左から 20px）
    const at = placeInRange(g, 'A1:B2', 400, 200, 0);
    expect(at).toEqual({ col: 0, colOff: 20 * 9525, row: 0, rowOff: 0, cx: 120 * 9525, cy: 60 * 9525 });
    // 縦長 100×300 は 20×60、中央は左から 70px（1列目の中）
    expect(placeInRange(g, 'A1:B2', 100, 300, 0)).toMatchObject({ col: 0, colOff: 70 * 9525, cx: 20 * 9525, cy: 60 * 9525 });
    // 中央が2列目に入るとき：枠 A1:B1（160×40）に 10×40 の写真 → 左から 75px
    expect(placeInRange(g, 'A1:B1', 10, 40, 0)).toMatchObject({ col: 0, colOff: 75 * 9525 });
    expect(placeInRange(g, 'A1:B1', 4, 40, 0)).toMatchObject({ col: 0, colOff: 78 * 9525 });
  });

  it('書き出したカルテに貼る：選んだ木のシートだけに入り、ほかの中身は変わらず、Excel として読める', async () => {
    const recs = [tree(1), tree(2)].map((t) => simpleKarteRecord(t, cfg));
    recs[1][photoCaptionKey(1)] = '枯れ枝';
    const r = await exportKarte(await makeTemplate(), recs, cfg, cfg.karte, { submit: true });
    expect(r.errors).toEqual([]);
    const a = bytes(900, 1);
    const b = bytes(700, 2);
    const p = await addKartePhotos(r.buffer, [{ sheet: '2', pics: [{ slot: 'full', data: a, w: 300, h: 400 }, { slot: 'p1', data: b, w: 400, h: 300 }] }], cfg.karte.photos);
    expect(p.errors).toEqual([]);
    expect(p.stats).toEqual({ photos: 2, sheets: 1 });
    const before = await JSZip.loadAsync(r.buffer);
    const after = await JSZip.loadAsync(p.buffer);
    // 写真を貼っていないシート・書式は1文字も変わらない
    for (const f of ['xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/workbook.xml']) expect(await after.file(f).async('string')).toBe(await before.file(f).async('string'));
    // 貼ったシートは <drawing> が1つ増えただけ
    const s2 = await after.file('xl/worksheets/sheet2.xml').async('string');
    expect(s2.replace(/<drawing r:id="rId1"\/>/, '').replace(/ xmlns:r="[^"]+"/, '')).toBe((await before.file('xl/worksheets/sheet2.xml').async('string')).replace(/ xmlns:r="[^"]+"/, ''));
    const d = await after.file('xl/drawings/drawing1.xml').async('string');
    expect(d.match(/<xdr:pic>/g)).toHaveLength(2);
    expect(d).not.toMatch(/duotone|grayscl/); // 色を変える効果は付けない
    expect([...(await after.file('xl/media/photo1.jpeg').async('uint8array'))]).toEqual([...a]);
    // ExcelJS でも読める（シートごとの写真の数）
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(p.buffer);
    expect(wb.getWorksheet('2').getImages()).toHaveLength(2);
    expect(wb.getWorksheet('1').getImages()).toHaveLength(0);
  });

  it('貼れないとき：シートがない・枠がない・大きさが分からないは、誤りとして返す（黙って飛ばさない）', async () => {
    const r = await exportKarte(await makeTemplate(), [simpleKarteRecord(tree(1), cfg)], cfg, cfg.karte, { submit: true });
    const pic = { slot: 'full', data: bytes(10, 1), w: 3, h: 4 };
    expect((await addKartePhotos(r.buffer, [{ sheet: '9', pics: [pic] }], cfg.karte.photos)).errors[0]).toMatch(/シート「9」が見つかりません/);
    expect((await addKartePhotos(r.buffer, [{ sheet: '1', pics: [{ ...pic, slot: 'zz' }] }], cfg.karte.photos)).errors[0]).toMatch(/枠「zz」/);
    expect((await addKartePhotos(r.buffer, [{ sheet: '1', pics: [{ ...pic, w: 0 }] }], cfg.karte.photos)).errors[0]).toMatch(/大きさ/);
    // 写真のない木だけなら、何も変えずに返す
    expect((await addKartePhotos(r.buffer, [{ sheet: '1', pics: [] }], cfg.karte.photos)).buffer).toBe(r.buffer);
  });
});

describe('写真を木ごとに区切る', () => {
  const trees = [{ key: 'a', treeNo: '1' }, { key: 'b', treeNo: '2' }, { key: 'c', treeNo: '3' }];
  const ph = (id, min, o = {}) => ({ id, name: `${id}.jpg`, shotAt: `2099-04-05T10:${String(min).padStart(2, '0')}:00`, w: 400, h: 300, ...o });
  const photos = [
    ph('x0', 0),
    ph('n1', 1, { number: true }),
    ph('p1', 2),
    ph('p2', 3, { w: 300, h: 400 }),
    ph('p3', 4, { w: 300, h: 400 }),
    ph('n2', 5, { number: true }),
    ph('q1', 6),
    ph('gone', 7, { removed: true }),
  ];

  it('番号の写真から次の番号の写真の手前までが1本分。木は並び順に当て、選んだ木があればそこから', () => {
    const r = segmentsOf([...photos].reverse(), trees); // 入れた順に関係なく、撮った順に並べる
    expect(r.before.map((p) => p.id)).toEqual(['x0']);
    expect(r.segments.map((s) => [s.treeKey, s.photos.map((p) => p.id)])).toEqual([['a', ['p1', 'p2', 'p3']], ['b', ['q1']]]);
    const moved = segmentsOf(photos.map((p) => (p.id === 'n1' ? { ...p, treeKey: 'b' } : p)), trees);
    expect(moved.segments.map((s) => s.treeKey)).toEqual(['b', 'c']);
    // 番号の写真が木より多ければ、当てる木がない
    expect(segmentsOf(photos.map((p) => ({ ...p, number: true })), trees).segments.map((s) => s.treeKey)).toEqual(['a', 'b', 'c', '', '', '', '']);
  });

  it('全景は最初の縦の写真。押して選ぶ・外す・全景を選び直す', () => {
    const seg = segmentsOf(photos, trees).segments[0].photos;
    const ids = (pick) => slotPhotos(seg, slots, pick).map((x) => x.photo?.id || '');
    expect(ids({})).toEqual(['p2', '', '']);
    let pick = togglePick({}, slots, seg, 'p1');
    expect(ids(pick)).toEqual(['p2', 'p1', '']);
    pick = togglePick(pick, slots, seg, 'p3');
    expect(ids(pick)).toEqual(['p2', 'p1', 'p3']);
    expect(togglePick(pick, slots, seg, 'p1')).toMatchObject({ p1: { caption: '' } }); // もう一度押すと外れる
    // 全景に選び直すと、ほかの枠からは外れる
    pick = setFull(pick, slots, 'p3');
    expect(ids(pick)).toEqual(['p3', 'p1', '']);
    // 全景を押して外すと「入れない」（自動で入れ直さない）
    pick = togglePick(pick, slots, seg, 'p3');
    expect(ids(pick)).toEqual(['', 'p1', '']);
    // 外した写真は、もう一度押すと空いている枠（全景でない枠）に入る
    expect(ids(togglePick(pick, slots, seg, 'p3'))).toEqual(['', 'p1', 'p3']);
  });

  it('撮影日時を JPEG から読む（読めなければ空）', () => {
    // Exif の最小の形：IFD0 に ExifIFD への場所、その中に DateTimeOriginal
    const date = '2099:04:05 10:20:30\0';
    const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + 20);
    const v = new DataView(tiff.buffer);
    tiff.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]);
    v.setUint16(8, 1); v.setUint16(10, 0x8769); v.setUint16(12, 4); v.setUint32(14, 1); v.setUint32(18, 26);
    v.setUint16(26, 1); v.setUint16(28, 0x9003); v.setUint16(30, 2); v.setUint32(32, 20); v.setUint32(36, 44);
    tiff.set([...date].map((c) => c.charCodeAt(0)), 44);
    const jpg = new Uint8Array(4 + 2 + 6 + tiff.length);
    jpg.set([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    new DataView(jpg.buffer).setUint16(4, 2 + 6 + tiff.length);
    jpg.set(tiff, 12);
    expect(exifDate(jpg.buffer)).toBe('2099-04-05T10:20:30');
    expect(exifDate(new Uint8Array([1, 2, 3, 4]).buffer)).toBe('');
  });
});
