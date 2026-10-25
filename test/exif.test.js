// 写真の中の撮影日時（EXIF）を読むテスト
//  本物の写真の代わりに、撮影情報だけを持つ JPEG の形を組み立てて使う（画像の本体は無い）
import { describe, expect, it } from 'vitest';
import { exifDateText, readShotDate } from '../src/core/exif.js';

// 撮影情報だけの JPEG を作る
//  le：数の並び（true：II 小さい桁が先 / false：MM 大きい桁が先）
//  original：撮影日時（DateTimeOriginal）、modified：更新日時（DateTime）。null なら入れない
function exifJpeg({ le = true, original = '2099:05:06 10:20:30', modified = '2099:05:07 08:00:00' } = {}) {
  const tiff = [];
  const u16 = (n) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const entry = (tag, type, count, value) => [...u16(tag), ...u16(type), ...u32(count), ...value];

  // 並び：TIFF の頭（8）→ IFD0 → 撮影情報の IFD → 文字の置き場
  const ifd0Entries = [modified != null && 'dt', original != null && 'ptr'].filter(Boolean);
  const ifd0Size = 2 + ifd0Entries.length * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = original != null ? 2 + 12 + 4 : 0;
  let dataOff = exifOff + exifSize;
  const data = [];
  const put = (s) => {
    const off = dataOff + data.length;
    data.push(...ascii(s));
    return off;
  };

  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  const ifd0 = [...u16(ifd0Entries.length)];
  if (modified != null) ifd0.push(...entry(0x0132, 2, modified.length + 1, u32(put(modified))));
  if (original != null) ifd0.push(...entry(0x8769, 4, 1, u32(exifOff)));
  ifd0.push(...u32(0));
  tiff.push(...ifd0);
  if (original != null) tiff.push(...u16(1), ...entry(0x9003, 2, original.length + 1, u32(put(original))), ...u32(0));
  tiff.push(...data);

  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0" ＋ TIFF
  const len = app1.length + 2;
  // 始まり（FFD8）→ APP0（中身は空）→ APP1（撮影情報）→ 画像の始まり（FFDA）
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]).buffer;
}

describe('写真の中の撮影日時（EXIF）', () => {
  it('撮影日時（DateTimeOriginal）を読む（数の並びが II でも MM でも）', () => {
    expect(readShotDate(exifJpeg({ le: true }))).toBe('2099-05-06T10:20:30');
    expect(readShotDate(exifJpeg({ le: false }))).toBe('2099-05-06T10:20:30');
  });

  it('撮影日時がなければ更新日時（DateTime）を使う', () => {
    expect(readShotDate(exifJpeg({ original: null }))).toBe('2099-05-07T08:00:00');
  });

  it('読めないときは空（JPEG でない・撮影情報がない・形が崩れている）。エラーにしない', () => {
    expect(readShotDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe(''); // PNG
    expect(readShotDate(exifJpeg({ original: null, modified: null }))).toBe('');
    expect(readShotDate(exifJpeg().slice(0, 30))).toBe(''); // 途中で切れている
    expect(readShotDate(new ArrayBuffer(0))).toBe('');
  });

  it('日時の形をそろえる。0000 の日付（未設定）は空', () => {
    expect(exifDateText('2099:12:31 23:59:58')).toBe('2099-12-31T23:59:58');
    expect(exifDateText('0000:00:00 00:00:00')).toBe('');
    expect(exifDateText('')).toBe('');
  });
});
