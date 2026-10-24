// 前回のカルテ（PDF）の読み込みのテスト（架空の PDF：test/fixtures/karte-sample.pdf。作り方は test/helpers/makeKartePdf.mjs）
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { readKarteBook } from '../src/excel/karte.js';
import { joinStrips, pdfRows, readKartePdf } from '../src/excel/kartePdf.js';
import { buildPrevious } from '../src/store/previous.js';
import { makeKarte, TINY_JPEG } from './helpers/makeKarte.js';

const cfg = structuredClone(cfgJson);
const specs = cfg.previous.kartes;
const pdf = () => fs.readFileSync(new URL('./fixtures/karte-sample.pdf', import.meta.url));
// 写真の画素を JPEG にする代わりに、画素の数の長さのデータにする（画面の外では画像を作れないため）
const encode = async ({ width, height }) => ({ type: 'image/test', buffer: new ArrayBuffer(width * height) });
const read = async () => readKartePdf(pdf(), cfg, '架空.pdf', { encode });

describe('カルテ（PDF）を読む', () => {
  it('1ページを1シートとして、番号・場所・樹種・日付・「有」の弱点・評価・写真を読む。カルテでないページは飛ばす', async () => {
    const r = await read();
    expect(r.skipped).toEqual(['架空.pdf 3ページ']);
    expect(r.trees.map((t) => [t.kind, t.sheet])).toEqual([
      ['detail', '1ページ'],
      ['place', '2ページ'],
    ]);
    const [d] = r.trees;
    expect(d).toMatchObject({
      treeNo: 'AB001',
      code: 'K01',
      placeName: '架空公園', // 「架空公園 木の番号」と1つになっていた文字を、見出しで切り分ける
      species: 'テストノキ',
      date: '2099-04-05', // 「2099年4月5日」も日付にする
      inspector: '試験 一郎',
      file: '架空.pdf',
    });
    expect(d.info).toEqual([
      { label: '調べた日', value: '2099-04-05' },
      { label: '木の種類', value: 'テストノキ' },
      { label: '植えた年', value: '1990' },
      { label: '手入れ', value: '毎年' },
    ]);
    // 部位の見出しは部位の行の真ん中にある。「□無」「■有」が別々の文字でも1つのチェック欄として読む
    expect(d.items).toEqual([
      { part: '枝', item: '②腐朽', result: '有（小）', grade: 'C', detail: '地上2m、10×5cm' },
      { part: '幹', item: '②腐朽', result: '有(大)', grade: 'D', detail: '芯達' },
      { part: '根', item: '②鋼棒', result: '有', grade: '', detail: '18/28cm' },
    ]);
    // 2行にまたがる見出し（上下の行の真ん中）は上の行から。折り返した所見は1つにつなぐ。飾りの言葉は除く
    expect(d.summary).toEqual([
      { label: '見た目の評価', lines: ['生育 B', '危険度 D (理由)'] },
      { label: 'まとめ', lines: ['C 前回より悪化している。'] },
    ]);
    // 上下2つに分かれていた写真は1枚につなぐ（8×8 の写真2つ → 8×16）。名前は写真の上の見出し
    expect(d.photos.map((p) => [p.caption, p.buffer.byteLength])).toEqual([
      ['全体の写真', 8 * 16],
      ['弱点の図', 8 * 8],
    ]);
  });

  it('縦書きの部位、写真の下の文字（captionBelow）、真ん中の上にある写真の見出し', async () => {
    const [, p] = (await read()).trees;
    expect(p).toMatchObject({ treeNo: 'AB001', code: 'K01', placeName: '架空公園' });
    expect(p.items).toEqual([{ part: 'まわり', item: '人の通り', result: '有', grade: '', detail: '歩行者' }]);
    expect(p.summary).toEqual([{ label: '土地の使われ方', lines: ['住宅地'] }]);
    expect(p.photos.map((x) => x.caption)).toEqual(['配置の図', '北側から']);
  });

  it('Excel のカルテと同じ形で読むので、まとめて扱える（同じ木・同じ種類は後から読んだ方）', async () => {
    const fromXlsx = (await readKarteBook(await makeKarte([{ no: 'AB001' }]), cfg, '架空.xlsx')).trees;
    const fromPdf = (await read()).trees;
    const p = buildPrevious([...fromXlsx, ...fromPdf], '2099-06-01T00:00:00.000Z', specs.map((k) => k.id));
    const kartes = Object.values(p.index.trees).flat();
    expect(kartes.filter((k) => k.kind === 'detail').map((k) => k.file)).toEqual(['架空.pdf']);
    expect(p.duplicates.length).toBeGreaterThan(0);
  });

  it('文字の入っていない PDF（写真を取り込んだだけ）は、その旨を知らせる', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawImage(await doc.embedJpg(new Uint8Array(TINY_JPEG)), { x: 0, y: 0, width: 595, height: 842 });
    await expect(readKartePdf(await doc.save(), cfg, 's.pdf', { encode })).rejects.toThrow('文字の入っていない PDF');
  });

  it('設定に読み方がなければ知らせる', async () => {
    const c = structuredClone(cfgJson);
    delete c.previous;
    await expect(readKartePdf(pdf(), c, 'a.pdf', { encode })).rejects.toThrow('previous.kartes');
  });
});

describe('PDF の文字を行に並べ直す', () => {
  const it8 = (t, x, y) => ({ t, x, y, w: t.length * 8 });
  it('空の欄が並んだ所（1つだけの文字の行が3つ続く）は、折り返した文とみなさない', () => {
    // 「見た目の評価」の下の3行：上下の行が同じ位置に始まっても、はさまれた行が1つだけの文字なら別の行のまま
    const { rows } = pdfRows([it8('腐朽割合', 103, 105), it8('地上部', 62, 98), it8('健全材厚の割合', 103, 91), it8('地下部', 62, 81), it8('根系の腐朽割合', 103, 81)], specs);
    expect(rows.map((r) => r.cells.map((c) => c.t).join(' '))).toEqual(['地上部 腐朽割合', '健全材厚の割合', '地下部 根系の腐朽割合']);
  });

  it('部位の見出しから、隣の見出しとの間の半分より離れた行は部位なし', () => {
    const { rows, partAt } = pdfRows([it8('上の行', 86, 700), it8('枝', 54, 600), it8('枝の行', 86, 600), it8('幹', 54, 500), it8('幹の行', 86, 500), it8('下の行', 86, 300)], specs);
    expect(rows.map((r) => partAt(r, specs[0]))).toEqual(['', '枝', '幹', '']);
  });

  it('上下に分かれた写真は、左右の端と画素の幅が同じで、上下がくっついているときだけつなぐ', () => {
    const img = (w, h) => ({ width: w, height: h });
    const box = (x0, yTop, yBottom, w = 8) => ({ x0, x1: x0 + 100, yTop, yBottom, parts: [img(w, 8)] });
    expect(joinStrips([box(0, 100, 50), box(0, 50, 40)]).map((b) => b.parts.length)).toEqual([2]);
    expect(joinStrips([box(0, 100, 50), box(0, 45, 40)]).map((b) => b.parts.length)).toEqual([1, 1]); // 離れている
    expect(joinStrips([box(0, 100, 50), box(0, 50, 40, 9)]).map((b) => b.parts.length)).toEqual([1, 1]); // 画素の幅が違う
  });
});
