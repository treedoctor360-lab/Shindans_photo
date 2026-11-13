// カルテ（1本1シート）に写真を貼る
//  exportKarte で作ったブックに、後から図（写真）を足す。セルの中身には触らない。
//  どこに貼るかは設定 karte.photos：
//    slots  … 写真の枠の一覧 [{ key, label, range（枠のセルの範囲。例 "Q4:V16"） }]
//    pad    … 枠の内側に空ける余白（px。既定 3）
//    charPx … 様式の標準の書体の数字1文字の幅（px。列の幅を px に直すのに使う。既定 8）
//  写真は縦横の比を変えずに枠に収め、枠の中央に置く（引き伸ばさない）。色を変える効果は付けない。
//  貼った後に読み直して、シートごとの写真の数・写真の中身・置いた場所を照合する。
import JSZip from 'jszip';
import { colNumber, splitAddress } from './xmlCells.js';

const EMU_PX = 9525; // 1px の長さ（Excel の図の単位 EMU）
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// シートの列の幅・行の高さ（px）を読む。返す形：{ colPx(列の番号), rowPx(行の番号) }
//  隠した列・行は 0。幅・高さが書かれていなければ、シートの既定の値
export function sheetGrid(xml, charPx = 8) {
  const fmt = xml.match(/<sheetFormatPr\b[^>]*>/)?.[0] || '';
  const defCol = Number(fmt.match(/\bdefaultColWidth="([\d.]+)"/)?.[1] ?? 8.43);
  const defRow = Number(fmt.match(/\bdefaultRowHeight="([\d.]+)"/)?.[1] ?? 15);
  const cols = [...xml.matchAll(/<col\b[^>]*>/g)].map((m) => ({
    min: Number(m[0].match(/\bmin="(\d+)"/)?.[1]),
    max: Number(m[0].match(/\bmax="(\d+)"/)?.[1]),
    width: Number(m[0].match(/\bwidth="([\d.]+)"/)?.[1] ?? defCol),
    hidden: /\bhidden="1"/.test(m[0]),
  }));
  const rows = new Map();
  for (const m of xml.matchAll(/<row\b[^>]*>/g)) {
    const r = Number(m[0].match(/\br="(\d+)"/)?.[1]);
    const ht = m[0].match(/\bht="([\d.]+)"/)?.[1];
    rows.set(r, /\bhidden="1"/.test(m[0]) ? 0 : ht != null ? Number(ht) : defRow);
  }
  const colPx = (n) => {
    const c = cols.find((x) => n >= x.min && n <= x.max);
    if (c?.hidden) return 0;
    return Math.round((c ? c.width : defCol) * charPx);
  };
  const rowPx = (n) => ((rows.has(n) ? rows.get(n) : defRow) * 96) / 72; // pt → px
  return { colPx, rowPx };
}

// 枠（セルの範囲）の中に、w×h の写真を縦横の比のまま収めたときの置き場所
//  返す形：{ col, colOff, row, rowOff, cx, cy }（col・row は 0 から数える。Off・cx・cy は EMU）
export function placeInRange(grid, range, w, h, pad = 3) {
  const [a, b] = String(range).split(':');
  const from = splitAddress(a);
  const to = splitAddress(b || a);
  const c1 = colNumber(from.col);
  const c2 = colNumber(to.col);
  let boxW = 0;
  for (let c = c1; c <= c2; c++) boxW += grid.colPx(c);
  let boxH = 0;
  for (let r = from.row; r <= to.row; r++) boxH += grid.rowPx(r);
  const availW = Math.max(1, boxW - pad * 2);
  const availH = Math.max(1, boxH - pad * 2);
  const scale = Math.min(availW / w, availH / h);
  const pw = w * scale;
  const ph = h * scale;
  // 枠の左上からの位置（中央に置く）
  let x = (boxW - pw) / 2;
  let y = (boxH - ph) / 2;
  // 位置を「どの列・行の、端からどれだけ」に直す
  let col = c1;
  while (col < c2 && x >= grid.colPx(col)) x -= grid.colPx(col++);
  let row = from.row;
  while (row < to.row && y >= grid.rowPx(row)) y -= grid.rowPx(row++);
  const emu = (px) => Math.round(px * EMU_PX);
  return { col: col - 1, colOff: emu(x), row: row - 1, rowOff: emu(y), cx: emu(pw), cy: emu(ph) };
}

// 図のファイル（drawing）の XML
function drawingXml(pics) {
  const body = pics
    .map(
      (p, i) =>
        `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.at.col}</xdr:col><xdr:colOff>${p.at.colOff}</xdr:colOff><xdr:row>${p.at.row}</xdr:row><xdr:rowOff>${p.at.rowOff}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${p.at.cx}" cy="${p.at.cy}"/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${escapeXml(p.label || `写真${i + 1}`)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip xmlns:r="${REL_NS}" r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.at.cx}" cy="${p.at.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    body +
    '</xdr:wsDr>'
  );
}

// シートの XML に <drawing> を入れる（置く順番の決まり：legacyDrawing などの前。なければ最後）
function withDrawing(xml, rid) {
  let x = /\bxmlns:r="/.test(xml.match(/<worksheet\b[^>]*>/)?.[0] || '') ? xml : xml.replace(/<worksheet\b/, `<worksheet xmlns:r="${REL_NS}"`);
  const el = `<drawing r:id="${rid}"/>`;
  const before = x.match(/<(legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  const at = before ? before.index : x.lastIndexOf('</worksheet>');
  return x.slice(0, at) + el + x.slice(at);
}

// ブックの中のシートの名前 → ファイルの場所
async function sheetPaths(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/\bId="([^"]+)"/)?.[1], m[0].match(/\bTarget="([^"]+)"/)?.[1]]));
  const out = new Map();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = (m[0].match(/\bname="([^"]*)"/)?.[1] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const t = target.get(m[0].match(/\br:id="([^"]+)"/)?.[1]);
    if (t) out.set(name, t.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  return out;
}

// カルテのブックに写真を貼る
//  items：[{ sheet: シートの名前, pics: [{ slot: 枠の key, data: 写真（JPEG の Uint8Array）, w, h（写真の大きさ px） }] }]
//  返す形：{ buffer, errors, stats: { photos: 貼った写真の数, sheets: 写真を貼ったシートの数 } }
export async function addKartePhotos(buffer, items, photosCfg) {
  const errors = [];
  const stats = { photos: 0, sheets: 0 };
  const slots = new Map((photosCfg?.slots || []).map((s) => [s.key, s]));
  const zip = await JSZip.loadAsync(buffer);
  const paths = await sheetPaths(zip);
  const placed = []; // 照合用 [{ sheet, path, pics: [{ at, data }] }]
  let ct = await zip.file('[Content_Types].xml').async('string');
  let n = 0; // 図のファイルの番号
  let mediaNo = 0;
  for (const item of items) {
    const pics = (item.pics || []).filter((p) => p?.data?.length);
    if (!pics.length) continue;
    const path = paths.get(item.sheet);
    if (!path) {
      errors.push(`写真を貼るシート「${item.sheet}」が見つかりません`);
      continue;
    }
    let xml = await zip.file(path).async('string');
    if (/<drawing\b/.test(xml)) {
      errors.push(`シート「${item.sheet}」には、すでに図があります`);
      continue;
    }
    const grid = sheetGrid(xml, photosCfg.charPx ?? 8);
    const done = [];
    for (const p of pics) {
      const slot = slots.get(p.slot);
      if (!slot) {
        errors.push(`シート「${item.sheet}」：写真の枠「${p.slot}」が設定にありません`);
        continue;
      }
      if (!(p.w > 0 && p.h > 0)) {
        errors.push(`シート「${item.sheet}」：写真の大きさが分かりません（${slot.label || slot.key}）`);
        continue;
      }
      done.push({ ...p, label: slot.label || slot.key, at: placeInRange(grid, slot.range, p.w, p.h, photosCfg.pad ?? 3) });
    }
    if (!done.length) continue;
    n += 1;
    const drawingPath = `xl/drawings/drawing${n}.xml`;
    const relLines = done.map((p, i) => {
      mediaNo += 1;
      p.media = `xl/media/photo${mediaNo}.jpeg`;
      zip.file(p.media, p.data);
      return `<Relationship Id="rId${i + 1}" Type="${REL_NS}/image" Target="../media/photo${mediaNo}.jpeg"/>`;
    });
    zip.file(drawingPath, drawingXml(done));
    zip.file(
      `xl/drawings/_rels/drawing${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relLines.join('')}</Relationships>`,
    );
    const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    if (zip.file(relPath)) {
      errors.push(`シート「${item.sheet}」には、ほかの部品への関連付けがあります`);
      continue;
    }
    zip.file(
      relPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`,
    );
    xml = withDrawing(xml, 'rId1');
    zip.file(path, xml);
    ct = ct.replace('</Types>', `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    placed.push({ sheet: item.sheet, path, drawingPath, pics: done });
    stats.photos += done.length;
    stats.sheets += 1;
  }
  if (errors.length) return { buffer: null, errors, stats };
  if (!placed.length) return { buffer, errors: [], stats };
  if (!/Extension="jpeg"/.test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="jpeg" ContentType="image/jpeg"/>');
  zip.file('[Content_Types].xml', ct);
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  errors.push(...(await verifyKartePhotos(out, placed)));
  return errors.length ? { buffer: null, errors, stats } : { buffer: out, errors: [], stats };
}

// 照合：貼ったシートごとに、写真の数・置いた場所・写真の中身が渡したとおりか（書き出したファイルを読み直す）
async function verifyKartePhotos(buffer, placed) {
  const errors = [];
  const zip = await JSZip.loadAsync(buffer);
  for (const s of placed) {
    const xml = await zip.file(s.path)?.async('string');
    if (!xml || (xml.match(/<drawing\b/g) || []).length !== 1) {
      errors.push(`シート「${s.sheet}」：写真の関連付けが正しく入っていません`);
      continue;
    }
    const d = await zip.file(s.drawingPath)?.async('string');
    const anchors = d ? [...d.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)].map((m) => m[0]) : [];
    if (anchors.length !== s.pics.length) {
      errors.push(`シート「${s.sheet}」：写真の数が違います（${anchors.length}枚。渡したのは${s.pics.length}枚）`);
      continue;
    }
    if (/<a:(duotone|grayscl|biLevel|clrChange)\b/.test(d)) errors.push(`シート「${s.sheet}」：写真に色を変える効果が付いています`);
    for (let i = 0; i < s.pics.length; i++) {
      const p = s.pics[i];
      const want = `<xdr:col>${p.at.col}</xdr:col><xdr:colOff>${p.at.colOff}</xdr:colOff><xdr:row>${p.at.row}</xdr:row><xdr:rowOff>${p.at.rowOff}</xdr:rowOff></xdr:from><xdr:ext cx="${p.at.cx}" cy="${p.at.cy}"/>`;
      if (!anchors[i].includes(want)) errors.push(`シート「${s.sheet}」：${p.label}の置き場所が違います`);
      const got = await zip.file(p.media)?.async('uint8array');
      if (!got || got.length !== p.data.length || got.some((v, k) => v !== p.data[k])) errors.push(`シート「${s.sheet}」：${p.label}の写真の中身が違います`);
    }
  }
  return errors;
}
