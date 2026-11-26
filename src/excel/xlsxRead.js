// Excel（xlsx）を軽く読む：セルの値と、貼ってある画像の位置だけ
//  ExcelJS はブック全体（画像の中身も）を一度に読み込むので、写真の大きいブック（数十 MB）では重い。
//  ここでは ZIP（xlsx の中身）からシートの XML を1枚ずつ読み、画像の中身は要るときに1枚ずつ取り出す。
//  使い方：const book = await openXlsx(data); for (const s of book.sheets) { const { cells, images } = await book.readSheet(s); … await book.media(images[0].path) }
//  cells：{ "E4": 値 }（数は number、文字は string。式のセルは保存されている計算の結果）
//  images：[{ path（ZIP の中の場所）, ext, from: { col, row }, to: { col, row } }]（行・列は1から数える。to は画像の右下が掛かるセル）
import JSZip from 'jszip';
import { colNumber } from './xmlCells.js';

// XML の文字の決まった書き方（&amp; など）を元の文字に
const unescape = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

// <t> の中身をつなぐ（ふりがな <rPh> の中は除く）
const textOf = (xml) =>
  [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join('');

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescape(m[1]) : null;
};

// 相対の場所を、ZIP の中の場所に（"../media/image1.png" を "xl/worksheets/" から → "xl/media/image1.png"）
function resolve(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir.split('/').filter(Boolean);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}
const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);
const relsOf = (path) => `${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;

// rels の XML → { rId: 場所 }
function readRels(xml, baseDir) {
  const out = {};
  for (const m of String(xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target && attr(m[0], 'TargetMode') !== 'External') out[id] = resolve(baseDir, target);
  }
  return out;
}

export async function openXlsx(data) {
  const zip = await JSZip.loadAsync(data);
  const read = async (path) => (zip.file(path) ? zip.file(path).async('string') : '');
  const wbXml = await read('xl/workbook.xml');
  if (!wbXml) throw new Error('Excel のファイル（.xlsx）ではありません');
  const wbRels = readRels(await read('xl/_rels/workbook.xml.rels'), 'xl/');
  const sheets = [...wbXml.matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => ({ name: attr(m[0], 'name') || '', path: wbRels[attr(m[0], 'r:id')] || '' }))
    .filter((s) => s.path && zip.file(s.path));
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  // シート1枚のセルと画像
  async function readSheet(sheet) {
    const xml = await read(sheet.path);
    const cells = {};
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${m[1]}>`;
      const ref = attr(tag, 'r');
      if (!ref || m[2] == null) continue;
      const type = attr(tag, 't');
      const v = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value;
      if (type === 's') value = v != null ? shared[Number(v)] ?? '' : '';
      else if (type === 'inlineStr') value = textOf(m[2].match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
      else if (type === 'str' || type === 'e') value = v != null ? unescape(v) : '';
      else if (type === 'b') value = v === '1';
      else value = v != null && v !== '' ? Number(v) : '';
      if (value !== '') cells[ref] = value;
    }
    // 画像：シートの rels → 図形（drawing）→ その rels → 画像の中身
    const images = [];
    const sheetRels = readRels(await read(relsOf(sheet.path)), dirOf(sheet.path));
    for (const dm of xml.matchAll(/<drawing\b[^>]*>/g)) {
      const dPath = sheetRels[attr(dm[0], 'r:id')];
      if (!dPath) continue;
      const dXml = await read(dPath);
      const dRels = readRels(await read(relsOf(dPath)), dirOf(dPath));
      for (const am of dXml.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
        const a = am[0];
        const pos = (name) => {
          const p = a.match(new RegExp(`<xdr:${name}>([\\s\\S]*?)</xdr:${name}>`))?.[1];
          if (!p) return null;
          return { col: Number(p.match(/<xdr:col>(\d+)<\/xdr:col>/)?.[1] ?? 0) + 1, row: Number(p.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1] ?? 0) + 1 };
        };
        const from = pos('from');
        if (!from) continue;
        const to = pos('to') || from;
        // 1つの位置にまとめた図（グループ）の中の写真も拾う
        for (const bm of a.matchAll(/<a:blip\b[^>]*>/g)) {
          const path = dRels[attr(bm[0], 'r:embed')];
          if (!path || !zip.file(path)) continue;
          images.push({ path, ext: path.slice(path.lastIndexOf('.') + 1).toLowerCase(), from, to });
        }
      }
    }
    return { cells, images };
  }

  return {
    sheets,
    readSheet,
    // 画像の中身（Uint8Array）
    media: (path) => zip.file(path).async('uint8array'),
  };
}

// "Q4:V16" → { c1, r1, c2, r2 }（1から数える）
export function rangeOf(range) {
  const [a, b = a] = String(range).split(':');
  const p = (x) => {
    const m = x.match(/^([A-Z]+)(\d+)$/);
    return m ? { c: colNumber(m[1]), r: Number(m[2]) } : null;
  };
  const s = p(a);
  const e = p(b);
  if (!s || !e) return null;
  return { c1: Math.min(s.c, e.c), r1: Math.min(s.r, e.r), c2: Math.max(s.c, e.c), r2: Math.max(s.r, e.r) };
}
