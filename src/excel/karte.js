// 前回の診断カルテ（Excel）を読む
//
// カルテは「1本1シート」の様式を想定する。カルテの種類（詳しい診断・周辺の環境・簡単な診断など）ごとに、
// どの文字の横に何があるかを設定 previous.kartes に書く（様式の言葉をコードに書かない）。
//  id / title … 種類の名前（画面に出す）
//  match   … シートの上の方にある表題の文字（空白を除いて一致したら、この種類のカルテとして読む）。省略するとどのシートにも当てはめる
//  fields  … 「見出しの文字」の右にある値（nth：右に何番目か）。例：樹木番号の右 → 番号
//  yesMark … 弱点が「有」のときの印（例：「■有」）。この印を含むセルがある行を、弱点の行とする
//  parts   … 部位の見出し（弱点の番号は部位ごとに①から始まるので、部位と組で持つ）
//  summary … 評価などの欄（見出しの文字と、そこから何行分を読むか）
//  photoCaptions … 写真・図の見出し（写真がどの見出しの下にあるかで、写真の名前にする）
//  captionBelow … true なら、写真のすぐ下の文字（同じ列の範囲）があれば、それを写真の名前にする
//  dropTexts … 評価の欄から除く言葉（表の飾りの言葉など）
//  info    … 画面に「見出し 値」で並べる基本情報（見出しの文字の右 nth 番目の値。title で表示の名前を変えられる。
//            unit で値の後ろに単位を付ける（単位がセルの書式で、値に入っていないとき。例 樹高・幹周））
//
// 結合セルは左上のセルだけを読む（同じ文字を何度も拾わないように）。
// 「□無 ■有」のようなチェック欄は、■の付いた言葉だけを取り出す。

import ExcelJS from 'exceljs';
import { toHalf } from '../core/text.js';

// 設定の種類の一覧（以前の形 previous.karte＝1種類だけ、にも対応する）
export function karteSpecs(cfg) {
  const p = cfg.previous || {};
  if (Array.isArray(p.kartes)) return p.kartes;
  return p.karte ? [{ id: 'karte', ...p.karte }] : [];
}

const squash = (s) => String(s || '').replace(/[\s　]/g, '');

// セルの中身を文字にする
function textOf(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('result' in v) return textOf(v.result);
    if (v.text != null) return String(v.text);
    return '';
  }
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000); // 計算結果の細かい端数は丸める
  return String(v);
}

// Excel の日付の通し番号（例 44482）や「2021年10月12日」を "2021-10-12" に。日付でなければそのまま
function serialDate(s) {
  const ymd = String(s ?? '').trim().match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const n = Number(s);
  if (!/^\d{5}$/.test(String(s).trim()) || n < 20000 || n > 80000) return s;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return textOf(d);
}

// チェック欄：「□Ａ ■Ｂ □Ｃ」→「Ｂ」、何も付いていなければ空。チェック欄でなければそのまま
export function checked(t) {
  if (!/[■□]/.test(t)) return t;
  const on = [...t.matchAll(/■\s*([^□■\s　]+)/g)].map((m) => m[1]);
  return on.join('・');
}

// 1行の、文字のあるセル（結合セルは左上だけ）
function rowCells(ws, r) {
  const out = [];
  const row = ws.getRow(r);
  for (let c = 1; c <= ws.columnCount; c++) {
    const cell = row.getCell(c);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    const t = textOf(cell.value).replace(/\s+/g, ' ').trim();
    if (t) out.push({ c, t });
  }
  return out;
}

// 見出しの右 nth 番目の値
function valueRight(cells, label, nth = 1) {
  const i = cells.findIndex((x) => x.t === label);
  return i >= 0 ? cells[i + nth]?.t || '' : null;
}

const BRACKETS = new Set(['[', ']', '（', '）', '(', ')']);

// シートの種類を決める（表題で見分ける。上の5行のどこかにあればよい）
export function specOf(rows, specs) {
  const top = rows.slice(0, 5).flatMap(({ cells }) => cells.map((x) => squash(x.t)));
  return specs.find((s) => !s.match || top.includes(squash(s.match))) || null;
}

// 1シート（1本の1種類）を読む。カルテでなければ null
export function readKarteSheet(ws, wb, specs) {
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) rows.push({ r, cells: rowCells(ws, r) });
  // 写真・図の位置（行・列は1から数える）
  const images = ws
    .getImages()
    .map((im) => {
      const top = Math.floor(im.range?.tl?.nativeRow ?? im.range?.tl?.row ?? 0) + 1; // 1から数えた行
      const left = Math.floor(im.range?.tl?.nativeCol ?? im.range?.tl?.col ?? 0) + 1;
      // 写真の下端の行（1から数える）。下端が行の境目ちょうど（ずれ 0）なら、その行には掛かっていない
      const br = im.range?.br;
      const bottom = br ? Math.floor(br.nativeRow ?? br.row) + (br.nativeRowOff > 0 ? 1 : 0) : top;
      const right = Math.floor(im.range?.br?.nativeCol ?? im.range?.br?.col ?? left - 1) + 1;
      const media = wb.getImage(Number(im.imageId));
      if (!media?.buffer) return null;
      return { top, left, bottom, right, type: `image/${media.extension === 'jpg' ? 'jpeg' : media.extension}`, buffer: media.buffer };
    })
    .filter(Boolean);
  return readKarteRows(rows, images, specs);
}

// 行と写真の位置から、1本の1種類を読む（Excel・PDF で共通）。カルテでなければ null
//  rows：[{ r（1から数えた行）, cells: [{ c（左からの位置）, t（文字） }] }]。rows[r-1] が r 行目
//  images：[{ top, left, bottom, right（行・位置）, type, buffer, belowRows?（写真の下の文字を探す行） }]
//  opts.partAt(row, spec)：その行の部位を返す（PDF 用。部位の見出しが部位の行の真ん中に書かれているため）。
//                         なければ、部位の見出しのある行から次の見出しまでをその部位とする
//  opts.captionInside：写真の名前を、写真の左右の幅の中にある見出しから選ぶ（PDF 用。見出しが写真の真ん中に書かれているため）
export function readKarteRows(rows, images, specs, opts = {}) {
  const spec = specOf(rows, specs);
  if (!spec) return null;
  const captions = spec.photoCaptions || [];

  // 見出しの右の値
  const f = {};
  for (const [key, def] of Object.entries(spec.fields || {})) {
    const labels = Array.isArray(def.label) ? def.label : [def.label];
    for (const { cells } of rows) {
      for (const label of labels) {
        const v = valueRight(cells, label, def.nth || 1);
        if (v != null && f[key] == null) f[key] = v;
      }
    }
  }
  if (!f.treeNo) return null;

  // 基本情報（例：植栽年・管理履歴）。見つからない項目は出さない
  const info = [];
  for (const def of spec.info || []) {
    let v = null;
    for (const { cells } of rows) {
      v = valueRight(cells, def.label, def.nth || 1);
      if (v != null) break;
    }
    if (v) {
      let value = serialDate(checked(v));
      // 数は Excel の小数の誤差（1.1499999999999999 など）を除く
      if (/^-?\d+\.\d{7,}$/.test(value)) value = String(Number(Number(value).toPrecision(12)));
      if (def.unit && /^-?\d+(\.\d+)?$/.test(value)) value = `${value} ${def.unit}`;
      info.push({ label: def.title || def.label.replace(/[：:]$/, ''), value });
    }
  }

  // 弱点（「有」の行だけ）
  const items = [];
  let part = '';
  for (const row of rows) {
    const { cells } = row;
    if (opts.partAt) part = opts.partAt(row, spec) || '';
    else {
      const p = cells.find((x) => (spec.parts || []).includes(x.t));
      if (p) part = p.t;
    }
    const mi = cells.findIndex((x) => x.t.includes(spec.yesMark));
    if (mi < 1) continue;
    const rest = cells.slice(mi + 1).map((x) => x.t);
    // [ 判定 ] があれば判定。かっこの記号と写真の見出しを除いた残りが詳細
    const open = rest.indexOf('[');
    const close = rest.indexOf(']');
    const grade = open >= 0 && close > open ? rest.slice(open + 1, close).join('') : '';
    const detail = rest
      .filter((x, i) => !(open >= 0 && i > open && i < close))
      .filter((x) => !BRACKETS.has(x) && !captions.includes(x))
      .map(checked)
      .filter(Boolean)
      .join(' ');
    const mark = cells[mi].t;
    const result = checked(mark.slice(mark.indexOf(spec.yesMark))) || '有';
    items.push({ part, item: cells[mi - 1].t, result, grade, detail });
  }

  // 評価などの欄：見出しの行から rows 行分の文字を、見出しを除いてつなぐ（チェック欄は■の言葉だけ）
  const summary = [];
  for (const s of spec.summary || []) {
    const at = rows.findIndex(({ cells }) => cells.some((x) => x.t === s.label));
    if (at < 0) continue;
    const lines = rows
      .slice(at, at + (s.rows || 1))
      .map(({ cells }) =>
        cells
          .filter((x) => x.t !== s.label && !captions.includes(x.t) && !(spec.parts || []).includes(x.t) && !(spec.dropTexts || []).includes(x.t))
          .map((x) => checked(x.t))
          .filter(Boolean)
          .join(' '),
      )
      .filter(Boolean);
    if (lines.length) summary.push({ label: s.label, lines });
  }

  // 写真・図：上の見出しの名前を付ける（同じ行に見出しが並んでいれば、左右の位置で決める）
  const capCells = rows.flatMap(({ r, cells }) => cells.filter((x) => captions.includes(x.t)).map((x) => ({ r, c: x.c, t: x.t })));
  const captionOf = (top, left, right) => {
    const above = capCells.filter((x) => x.r <= top + 1);
    if (!above.length) return '写真';
    const r = Math.max(...above.map((x) => x.r));
    const same = above.filter((x) => x.r === r);
    if (opts.captionInside) {
      const inside = same.find((x) => x.c >= left - 1 && x.c <= right);
      if (inside) return inside.t;
    }
    const leftOf = same.filter((x) => x.c <= left + 1).sort((a, b) => b.c - a.c)[0];
    return (leftOf || same.sort((a, b) => Math.abs(a.c - left) - Math.abs(b.c - left))[0]).t;
  };
  // 写真のすぐ下の文字（写真の左端〜右端の列にあるもの）
  //  belowRows：写真の下の文字を探す行（PDF 用。なければ写真の下端のすぐ下の2行）
  const textBelow = (bottom, left, right, belowRows) => {
    for (const r of belowRows || [bottom + 1, bottom + 2]) {
      const hit = rows[r - 1]?.cells.find((x) => x.c >= left && x.c <= right && !BRACKETS.has(x.t));
      if (hit) return hit.t;
    }
    return '';
  };
  const photos = images
    .map(({ top, left, bottom, right, type, buffer, belowRows }) => {
      const below = spec.captionBelow ? textBelow(bottom, left, right, belowRows) : '';
      return { caption: below || captionOf(top, left, right), top, left, type, buffer };
    })
    .sort((a, b) => a.top - b.top || a.left - b.left);

  return {
    kind: spec.id,
    title: spec.title || spec.id,
    treeNo: toHalf(f.treeNo).trim().toUpperCase(),
    code: toHalf(f.code || '').trim(),
    placeName: f.placeName || '',
    species: f.species || '',
    date: f.date ? serialDate(f.date) : '',
    inspector: f.inspector || '',
    info,
    items,
    summary,
    photos,
  };
}

// カルテのファイル1つを読む。返す形：{ trees: [...], skipped: [カルテでなかったシート名] }
export async function readKarteBook(buffer, cfg, fileName = '') {
  const specs = karteSpecs(cfg);
  if (!specs.length) throw new Error('設定ファイルに前回のカルテの読み方（previous.kartes）がありません');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const trees = [];
  const skipped = [];
  for (const ws of wb.worksheets) {
    const t = readKarteSheet(ws, wb, specs);
    if (t) trees.push({ ...t, file: fileName, sheet: ws.name });
    else skipped.push(`${fileName} ${ws.name}`.trim());
  }
  return { trees, skipped };
}
