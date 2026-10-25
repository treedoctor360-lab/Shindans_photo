// 写真（JPEG）の中にある撮影日時を読む（EXIF：カメラが写真に書き込む情報）
//  アルバムから選んだ写真の「元の撮影日時」を記録するために使う。
//  写真を決まりの大きさに整えると（photoShot.js）この情報は消えるので、整える前の元のファイルから読む。
//  読めないとき（JPEG でない・情報がない・形が崩れている）は '' を返す（エラーにしない）
//
//  返す形：'YYYY-MM-DDTHH:MM:SS'（端末の時刻のまま。時差の情報は付けない）

// EXIF の日時 'YYYY:MM:DD HH:MM:SS' → 'YYYY-MM-DDTHH:MM:SS'
export function exifDateText(s) {
  const m = String(s || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000') return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

// buffer：ArrayBuffer（元の写真ファイルの中身）
export function readShotDate(buffer) {
  try {
    const v = new DataView(buffer);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return ''; // JPEG の始まりの印がない
    let pos = 2;
    while (pos + 4 <= v.byteLength) {
      if (v.getUint8(pos) !== 0xff) return '';
      const marker = v.getUint8(pos + 1);
      if (marker === 0xda || marker === 0xd9) return ''; // 画像の本体に入った（ここより後に EXIF はない）
      const len = v.getUint16(pos + 2);
      // APP1（0xE1）の中の "Exif\0\0" が撮影情報
      if (marker === 0xe1 && pos + 10 <= v.byteLength && v.getUint32(pos + 4) === 0x45786966 && v.getUint16(pos + 8) === 0) {
        return fromTiff(v, pos + 10, len - 8);
      }
      pos += 2 + len;
    }
    return '';
  } catch {
    return '';
  }
}

// EXIF の中身（TIFF の形）から日時を探す。撮影日時（DateTimeOriginal）を優先し、なければ更新日時（DateTime）
function fromTiff(v, start, size) {
  const end = Math.min(v.byteLength, start + size);
  const order = v.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return '';
  const le = order === 0x4949; // 数の並び（II：小さい桁が先 / MM：大きい桁が先）
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const inside = (o, n) => start + o + n <= end;

  // 1つの一覧（IFD）から、項目の番号（tag）ごとの { type, count, value の位置 } を集める
  const readIfd = (off) => {
    const out = {};
    if (!inside(off, 2)) return out;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (!inside(e, 12)) break;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
    }
    return out;
  };
  // 文字（ASCII）の項目を読む
  const text = (ent) => {
    if (!ent || ent.type !== 2) return '';
    const off = ent.count > 4 ? u32(ent.at) : ent.at;
    if (!inside(off, ent.count)) return '';
    let s = '';
    for (let i = 0; i < ent.count; i++) {
      const c = v.getUint8(start + off + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0[0x8769]; // 撮影情報の一覧への道しるべ
  if (exifPtr) {
    const sub = readIfd(u32(exifPtr.at));
    const d = exifDateText(text(sub[0x9003])); // 撮影日時
    if (d) return d;
  }
  return exifDateText(text(ifd0[0x0132])); // 更新日時
}
