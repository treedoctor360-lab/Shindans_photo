// 写真を小さくする（ブラウザの中で）。長い辺を max ピクセルまで縮め、JPEG で保存し直す
//  小さくならなければ元のまま。縮められない形式（ブラウザが読めない画像）も元のまま
export async function compressPhoto(photo, { max = 1200, quality = 0.75 } = {}) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return photo;
  try {
    const bmp = await createImageBitmap(new Blob([photo.buffer], { type: photo.type }));
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
    if (!blob || blob.size >= photo.buffer.byteLength) return photo;
    return { ...photo, type: 'image/jpeg', buffer: await blob.arrayBuffer() };
  } catch {
    return photo;
  }
}
