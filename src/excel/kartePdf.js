// 前回の診断カルテ（PDF）を読む
//
// Excel のカルテを印刷した PDF（文字が文字として入っているもの）を読む。1ページを1シートとして扱い、
// ページの文字を Excel と同じ「行とセル」の形に並べ直してから、Excel と同じ読み方（karte.js の readKarteRows）で読む。
// 読み方の設定（previous.kartes）は Excel と共通。
//
// PDF ならではの並べ直し：
//  ・同じ高さの文字を1行にする（少しの上下のずれは同じ行とみなす）
//  ・縦書きの見出し（1文字ずつ縦に並んだ字）は1つの言葉にまとめ、その言葉が掛かる一番上の行に置く（Excel の結合セルと同じ）
//  ・部位の見出しは部位の行の真ん中に書かれているので、近い見出しの部位にする
//  ・見出しと値が1つの文字にくっついているもの（例「〇〇公園 樹木番号」）は、設定の見出しで切り分ける
//  ・「□無 ■有」のように分かれたチェック欄は1つのセルにまとめる
//  ・2行に折り返した文や、2行にまたがる見出し（上下の行の真ん中に書かれている）は、Excel と同じ行にまとめる
//  ・写真が上下に分かれて入っているもの（印刷のときに分かれる）は1枚につなぐ
// 文字のない PDF（写真を取り込んだだけのもの）は読めない。

import { karteSpecs, readKarteRows } from './karte.js';

// PDF を読む仕組み（pdf.js）は、PDF を読むときだけ読み込む（普段の画面を重くしないため）
let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise)
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
        // 画面では、PDF の中身を解く処理を別の流れ（ワーカー）で動かす
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjs;
    })();
  return pdfjsPromise;
}

const ROW_GAP = 3; // この高さ（ポイント）以内のずれは同じ行
const NEAR_ROW = 7; // 折り返した文・2行にまたがる見出しとみなす、上下の行との近さ
const VERTICAL_GAP = 18; // 縦書きの字と字の間の高さの上限
const ONE_CHAR = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}・ー]$/u;
const CHECK = /^[■□]/;

// 設定にある見出しの言葉（切り分け・部位に使う）
function wordsOf(specs) {
  const labels = new Set();
  const parts = new Set();
  const add = (x) => (Array.isArray(x) ? x : [x]).forEach((v) => typeof v === 'string' && v && labels.add(v));
  for (const s of specs) {
    for (const f of Object.values(s.fields || {})) add(f.label);
    for (const f of s.info || []) add(f.label);
    for (const f of s.summary || []) add(f.label);
    add(s.photoCaptions || []);
    for (const p of s.parts || []) parts.add(p);
  }
  return { labels, parts };
}

// 1つの文字を、設定の見出しの言葉で切り分ける（見出しの前後は、それぞれ1つにつなぐ）
function splitByLabels(it, labels) {
  const tokens = it.t.split(/[\s　]+/).filter(Boolean);
  if (tokens.length < 2 || !tokens.some((x) => labels.has(x))) return [it];
  const out = [];
  let pos = 0;
  let buf = null;
  const per = it.w > 0 ? it.w / it.t.length : 0; // 1字の幅（位置の見積もり用）
  for (const tok of tokens) {
    const at = it.t.indexOf(tok, pos);
    pos = at + tok.length;
    const x = it.x + at * per;
    if (labels.has(tok)) {
      if (buf) out.push(buf);
      buf = null;
      out.push({ ...it, x, t: tok });
    } else if (buf) buf.t += ` ${tok}`;
    else buf = { ...it, x, t: tok };
  }
  if (buf) out.push(buf);
  return out;
}

// 縦に1字ずつ並んだ字を言葉にまとめる。返す形：{ words: [{ t, x, yTop, yBottom }], rest: [残りの字] }
function verticalWords(items) {
  const singles = items.filter((x) => ONE_CHAR.test(x.t)).sort((a, b) => a.x - b.x || b.y - a.y);
  const used = new Set();
  const words = [];
  for (const first of singles) {
    if (used.has(first)) continue;
    const chain = [first];
    for (;;) {
      const last = chain[chain.length - 1];
      const next = singles
        .filter((x) => !used.has(x) && !chain.includes(x) && Math.abs(x.x - last.x) <= 4 && last.y - x.y > 0 && last.y - x.y <= VERTICAL_GAP)
        .sort((a, b) => b.y - a.y)[0];
      if (!next) break;
      chain.push(next);
    }
    if (chain.length < 2) continue;
    chain.forEach((x) => used.add(x));
    words.push({ t: chain.map((x) => x.t).join(''), x: Math.min(...chain.map((x) => x.x)), yTop: chain[0].y, yBottom: chain[chain.length - 1].y });
  }
  return { words, rest: items.filter((x) => !used.has(x)) };
}

// セルを行に足す（同じ位置に文字があれば、上下の順につなぐ）
function addCell(line, cell) {
  const same = line.cells.find((x) => Math.abs(x.x - cell.x) < 2);
  if (same) same.t = cell.y > same.y ? cell.t + same.t : same.t + cell.t;
  else line.cells.push({ ...cell });
  line.cells.sort((a, b) => a.x - b.x);
}

// 1ページの文字を「行とセル」に並べ直す
//  items：[{ t, x, y（下から）, w }]。返す形：{ rows: [{ r, y, cells: [{ c, t }] }], partAt }
export function pdfRows(items, specs) {
  const { labels, parts } = wordsOf(specs);
  const pieces = items.filter((x) => x.t.trim()).flatMap((x) => splitByLabels({ ...x, t: x.t.trim() }, labels));
  const { words, rest } = verticalWords(pieces);

  // 部位の見出し（縦書きの言葉か、1字の見出し）。同じ見出しが近くに2つあれば1つにする
  const partLabels = [];
  const addPart = (t, yc) => {
    const near = partLabels.find((p) => p.t === t && Math.abs(p.yc - yc) < 60);
    if (near) near.yc = (near.yc + yc) / 2;
    else partLabels.push({ t, yc });
  };
  for (const w of words) if (parts.has(w.t)) addPart(w.t, (w.yTop + w.yBottom) / 2);
  const cellsRest = rest.filter((x) => {
    if (!parts.has(x.t)) return true;
    addPart(x.t, x.y);
    return false;
  });

  // 同じ高さの文字を1行に
  const lines = [];
  for (const it of [...cellsRest].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= ROW_GAP);
    if (line) addCell(line, it);
    else lines.push({ y: it.y, cells: [{ ...it }] });
  }
  lines.sort((a, b) => b.y - a.y);

  // 折り返した文：同じ位置に始まる1つだけの文字の行が、ある行のすぐ上と下にあれば、その行の1つのセルにまとめる
  //  （2行に折り返した所見が、見出しの行をはさんで上下に書かれているため。はさまれた行が1つだけの文字の行なら、折り返しではない）
  const single = (l) => l && l.cells.length === 1;
  for (let i = 1; i < lines.length - 1; i++) {
    const [up, mid, down] = [lines[i - 1], lines[i], lines[i + 1]];
    if (!single(up) || !single(down) || single(mid) || Math.abs(up.cells[0].x - down.cells[0].x) > 1) continue;
    if (up.y - mid.y > NEAR_ROW + 1 || mid.y - down.y > NEAR_ROW + 1) continue;
    addCell(mid, up.cells[0]);
    addCell(mid, down.cells[0]);
    lines.splice(i + 1, 1);
    lines.splice(i - 1, 1);
  }
  // 2行にまたがる見出し：1つだけの文字の行が、上下の行のちょうど真ん中にあれば、上の行に置く（Excel の結合セルの左上と同じ）
  for (let i = 1; i < lines.length - 1; i++) {
    const [up, mid, down] = [lines[i - 1], lines[i], lines[i + 1]];
    if (!single(mid)) continue;
    const du = up.y - mid.y;
    const dd = mid.y - down.y;
    if (du > NEAR_ROW + 1 || dd > NEAR_ROW + 1 || Math.abs(du - dd) > 2) continue;
    addCell(up, mid.cells[0]);
    lines.splice(i, 1);
    i--;
  }

  // 縦書きの言葉（部位以外）は、その言葉が掛かる一番上の行に置く
  for (const w of words) {
    if (parts.has(w.t) || !lines.length) continue;
    const top = lines.find((l) => l.y <= w.yTop + 6 && l.y >= w.yBottom - 6) || lines.reduce((a, b) => (Math.abs(b.y - w.yTop) < Math.abs(a.y - w.yTop) ? b : a));
    addCell(top, { t: w.t, x: w.x, y: w.yTop });
  }

  // 「□無 ■有」のように並んだチェック欄を1つのセルにまとめる
  for (const l of lines) {
    const merged = [];
    for (const c of l.cells) {
      const prev = merged[merged.length - 1];
      if (prev && CHECK.test(prev.t) && CHECK.test(c.t)) prev.t += ` ${c.t}`;
      else merged.push({ ...c });
    }
    l.cells = merged;
  }

  const rows = lines.map((l, i) => ({ r: i + 1, y: l.y, cells: l.cells.map((c) => ({ c: c.x, t: c.t.replace(/\s+/g, ' ').trim() })) }));

  // 行の部位：その種類の部位の見出しのうち、一番近いもの。一番上（下）の見出しより、隣の見出しとの間の半分以上離れた行は部位なし
  const partAt = (row, spec) => {
    const list = partLabels.filter((p) => (spec.parts || []).includes(p.t)).sort((a, b) => b.yc - a.yc);
    if (!list.length) return '';
    const gap = list.length > 1 ? Math.min(...list.slice(1).map((p, i) => list[i].yc - p.yc)) / 2 : Infinity;
    if (row.y > list[0].yc + gap || row.y < list[list.length - 1].yc - gap) return '';
    return list.reduce((a, b) => (Math.abs(b.yc - row.y) < Math.abs(a.yc - row.y) ? b : a)).t;
  };
  return { rows, partAt };
}

// 写真の位置を行に合わせる。boxes：[{ x0, x1, yTop, yBottom, ... }]
//  top：写真に掛かる一番上の行（なければ写真より下の最初の行）。bottom：写真に掛かる一番下の行（なければ top の1つ上）
//  belowRows：写真の下端のすぐ下（BELOW_GAP 以内）の行。写真の下の文字（写真の名前）を探す所
const BELOW_GAP = 20;
export function placeImages(boxes, rows) {
  return boxes.map((b) => {
    const inside = rows.filter((r) => r.y <= b.yTop && r.y >= b.yBottom);
    const firstBelowTop = rows.find((r) => r.y <= b.yTop);
    const top = inside[0]?.r ?? firstBelowTop?.r ?? rows.length + 1;
    const bottom = inside.length ? inside[inside.length - 1].r : top - 1;
    const belowRows = rows.filter((r) => r.y < b.yBottom && r.y >= b.yBottom - BELOW_GAP).map((r) => r.r);
    return { ...b, top, bottom, left: b.x0, right: b.x1, belowRows };
  });
}

// 上下に分かれて入っている写真（左右の端と幅が同じで、上下がくっついているもの）を1枚にする
export function joinStrips(boxes) {
  const list = [...boxes].sort((a, b) => b.yTop - a.yTop || a.x0 - b.x0);
  const out = [];
  for (const b of list) {
    const prev = out.find((p) => Math.abs(p.x0 - b.x0) < 2 && Math.abs(p.x1 - b.x1) < 2 && Math.abs(p.yBottom - b.yTop) < 2 && p.parts[0].width === b.parts[0].width);
    if (prev) {
      prev.parts.push(...b.parts);
      prev.yBottom = b.yBottom;
    } else out.push({ ...b, parts: [...b.parts] });
  }
  return out;
}

// pdf.js の画像を、1画素4つ（赤緑青と不透明度）の並びにする
function toRgba(img, ImageKind) {
  const { width, height, data } = img;
  if (img.kind === ImageKind.RGBA_32BPP) return data;
  const out = new Uint8ClampedArray(width * height * 4);
  if (img.kind === ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j];
      out[i * 4 + 1] = data[j + 1];
      out[i * 4 + 2] = data[j + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  // 白黒（1画素1ビット。行の終わりは区切りの良い所まで詰める）
  const rowBytes = (width + 7) >> 3;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      const k = (y * width + x) * 4;
      out[k] = out[k + 1] = out[k + 2] = v;
      out[k + 3] = 255;
    }
  return out;
}

// 上下につないだ写真の材料：{ width, height, parts: [{ width, height, rgba か bitmap }] }
//  pdf.js は、画面では写真を画像（bitmap）のまま、そうでなければ画素の並び（data）で渡す
function stack(parts, ImageKind) {
  const width = parts[0].width;
  const height = parts.reduce((n, p) => n + p.height, 0);
  return { width, height, parts: parts.map((p) => (p.bitmap ? { width: p.width, height: p.height, bitmap: p.bitmap } : { width: p.width, height: p.height, rgba: toRgba(p, ImageKind) })) };
}

// 画面で使う写真の作り方（上から順に描いて JPEG にする）
async function encodeJpeg({ width, height, parts }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  let y = 0;
  for (const p of parts) {
    if (p.bitmap) ctx.drawImage(p.bitmap, 0, y, p.width, p.height);
    else ctx.putImageData(new ImageData(p.rgba, p.width, p.height), 0, y);
    y += p.height;
  }
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  if (!blob) throw new Error('写真を作れませんでした');
  return { type: 'image/jpeg', buffer: await blob.arrayBuffer() };
}

// 行列の掛け算（PDF の位置の計算用）
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

// 1ページの写真と、その位置
async function pageImages(page, pdfjs) {
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS;
  const get = (id) => new Promise((ok) => (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, ok));
  let ctm = [1, 0, 0, 1, 0, 0];
  const saved = [];
  const boxes = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (f === O.save) saved.push(ctm);
    else if (f === O.restore) ctm = saved.pop() || [1, 0, 0, 1, 0, 0];
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.paintImageXObject || f === O.paintJpegXObject) {
      const img = await get(a[0]);
      if (!(img?.data || img?.bitmap) || !img.width || !img.height) continue;
      const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]];
      const ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
      const box = { x0: Math.min(...xs), x1: Math.max(...xs), yBottom: Math.min(...ys), yTop: Math.max(...ys), parts: [img] };
      // 同じ写真が同じ所に2回描かれていれば1枚に
      if (!boxes.some((b) => b.parts[0] === img && Math.abs(b.x0 - box.x0) < 1 && Math.abs(b.yTop - box.yTop) < 1)) boxes.push(box);
    }
  }
  return boxes;
}

// PDF のファイル1つを読む。返す形：{ trees: [...], skipped: [カルテでなかったページ] }（readKarteBook と同じ）
//  encode：写真の画素から { type, buffer } を作る（試験では差し替える）
export async function readKartePdf(buffer, cfg, fileName = '', { encode = encodeJpeg } = {}) {
  const specs = karteSpecs(cfg);
  if (!specs.length) throw new Error('設定ファイルに前回のカルテの読み方（previous.kartes）がありません');
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)), isOffscreenCanvasSupported: false, isEvalSupported: false }).promise;
  const trees = [];
  const skipped = [];
  let anyText = false;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const items = tc.items.filter((x) => x.str?.trim()).map((x) => ({ t: x.str, x: x.transform[4], y: x.transform[5], w: x.width }));
      if (items.length) anyText = true;
      const { rows, partAt } = pdfRows(items, specs);
      const boxes = placeImages(joinStrips(await pageImages(page, pdfjs)), rows);
      const images = [];
      for (const b of boxes) images.push({ ...b, ...(await encode(stack(b.parts, pdfjs.ImageKind))) });
      const t = readKarteRows(rows, images, specs, { partAt, captionInside: true });
      if (t) trees.push({ ...t, file: fileName, sheet: `${n}ページ` });
      else skipped.push(`${fileName} ${n}ページ`.trim());
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  if (!anyText) throw new Error('文字の入っていない PDF です（写真を取り込んだだけの PDF は読めません）');
  return { trees, skipped };
}
