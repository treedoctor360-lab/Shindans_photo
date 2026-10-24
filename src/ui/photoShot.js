// 撮った写真を決まりの大きさに整える（ブラウザの中で）
//  ・縦横比 4:3 に真ん中で切りそろえる（撮った向きのまま。向きは変えない）
//  ・長い辺 long・短い辺 short ピクセルに縮める
//  ・JPEG の画質を少しずつ下げて、maxKB 程度に収める
//  ・一覧に出す小さな見本（長い辺 160）も作る
//  返す形：{ full: Blob, thumb: Blob, w, h }

async function decode(file) {
  // スマホの写真は「向き」の情報を持つので、それに従って起こす（from-image）
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // 古いブラウザは下の方法で読む
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, quality) => new Promise((ok, ng) => canvas.toBlob((b) => (b ? ok(b) : ng(new Error('写真を作れませんでした'))), 'image/jpeg', quality));

function draw(src, sw, sh, sx, sy, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return canvas;
}

export async function shapePhoto(file, { long = 640, short = 480, maxKB = 100 } = {}) {
  const src = await decode(file);
  const iw = src.width;
  const ih = src.height;
  if (!iw || !ih) throw new Error('写真を読めませんでした');
  const tall = ih > iw;
  // 4:3（縦なら 3:4）に、真ん中で切りそろえる
  const ratio = tall ? short / long : long / short; // 幅 ÷ 高さ
  let sw = iw;
  let sh = Math.round(iw / ratio);
  if (sh > ih) {
    sh = ih;
    sw = Math.round(ih * ratio);
  }
  const sx = Math.round((iw - sw) / 2);
  const sy = Math.round((ih - sh) / 2);
  const w = tall ? short : long;
  const h = tall ? long : short;
  const canvas = draw(src, sw, sh, sx, sy, w, h);
  let full = null;
  for (const q of [0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.4]) {
    full = await toBlob(canvas, q);
    if (full.size <= maxKB * 1024) break;
  }
  const tw = tall ? 120 : 160;
  const th = tall ? 160 : 120;
  const thumb = await toBlob(draw(canvas, w, h, 0, 0, tw, th), 0.7);
  src.close?.();
  return { full, thumb, w, h };
}
