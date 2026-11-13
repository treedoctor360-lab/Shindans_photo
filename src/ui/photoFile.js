// 写真のファイルを読む（ブラウザの中で）：撮影日時を読み、カルテ用に小さくする
//  元のファイルは保存しない（カルテに貼る大きさの JPEG と、一覧用の小さい絵だけを残す）

// JPEG の中の撮影日時（Exif の DateTimeOriginal。なければ DateTime）を "2099-04-05T10:20:30" の形で返す。読めなければ ''
export function exifDate(buffer) {
  try {
    const v = new DataView(buffer);
    if (v.getUint16(0) !== 0xffd8) return '';
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marker = v.getUint16(p);
      const size = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return readTiff(v, p + 10); // "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      p += 2 + size;
    }
  } catch {
    // 読めない形は撮影日時なしとして扱う
  }
  return '';
}
function readTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(o, le);
  const u32 = (o) => v.getUint32(o, le);
  const ascii = (o, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = v.getUint8(o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  // IFD（項目の表）から、tag の文字の値と、子の表の場所を読む
  const scan = (ifd, wanted) => {
    const out = {};
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      if (!wanted.includes(tag)) continue;
      const count = u32(e + 4);
      out[tag] = u16(e + 2) === 2 ? ascii(count > 4 ? t + u32(e + 8) : e + 8, count) : u32(e + 8);
    }
    return out;
  };
  const ifd0 = scan(t + u32(t + 4), [0x0132, 0x8769]);
  const sub = ifd0[0x8769] ? scan(t + ifd0[0x8769], [0x9003]) : {};
  const m = String(sub[0x9003] || ifd0[0x0132] || '').match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : '';
}

// 絵を、長い辺が max px になるように小さくして JPEG にする（向きの情報は絵に反映する）
async function toJpeg(bmp, max, quality) {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
  if (!blob) throw new Error('写真を小さくできませんでした');
  return { data: await blob.arrayBuffer(), w: canvas.width, h: canvas.height };
}

// 写真のファイル1枚を読む。返す形：{ name, shotAt, w, h, data, thumb }
export async function readPhotoFile(file, { maxPx = 1000, thumbPx = 240 } = {}) {
  const raw = await file.arrayBuffer();
  const last = file.lastModified ? new Date(file.lastModified) : null;
  const pad = (n) => String(n).padStart(2, '0');
  const fallback = last ? `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}T${pad(last.getHours())}:${pad(last.getMinutes())}:${pad(last.getSeconds())}` : '';
  const bmp = await createImageBitmap(new Blob([raw], { type: file.type || 'image/jpeg' }), { imageOrientation: 'from-image' });
  try {
    const big = await toJpeg(bmp, maxPx, 0.8);
    const small = await toJpeg(bmp, thumbPx, 0.7);
    return { name: file.name, shotAt: exifDate(raw) || fallback, w: big.w, h: big.h, data: big.data, thumb: small.data };
  } finally {
    bmp.close?.();
  }
}
