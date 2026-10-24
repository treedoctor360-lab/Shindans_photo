// 詳しい診断（初期診断など）の記録から、確認用のカルテ（1本1シート）を作る
//
// 最終の提出用のカルテは、別の仕組み（データ入力用ブックを読むマクロなど）で作る。
// ここで作るのは、入力の途中で中身を紙のカルテと同じ見た目で確かめるための「確認用」。
//
//  - 様式は、カルテの空の様式が入ったブック（設定 initialSurvey.karte.sheets の sheet で探す）から写す
//  - 様式のシートの XML をそのまま写し、書き込むセルだけを書き換える（xmlCells.js）。
//    書式・結合・入力規則・式はそのまま残る（ExcelJS でシートを写すと結合の下側の書式などが落ちるため）
//  - どのセルに何を書くかは設定（cells）に置く。値の形：
//      key        … 記録の項目の値をそのまま
//      keys＋join … いくつかの項目をつないだ文字（例：年・月・日を「/」で）
//      boxes      … 「□無 □有」のような空の形。選んだものの□を■にする（full: true なら、■の後ろを値の全文にする）
//                   match：exact（同じ）／first（値がその言葉で始まる）／contains（値にその言葉を含む）。map で値を読み替え
//      pattern    … 正規表現。当てはまれば1つ目の（ ）の中だけ。omit にある値は空欄
//      num: true  … 数の形の文字は数として書く（様式の式で計算できるように）
//      replaceFormula: true … 様式で式が入っているセルに値を書く（その式は消える。確認用なので、入力どおりの値を見せたいとき）
//      fmt        … セルの表示形式（Excel の書式記号）。{項目} は記録の値で埋める。どれかが空なら様式の表示形式のまま
//                   値は数のままなので、様式の式も計算できる（例 '0.00" m（{@girthStems} の和×0.7）"'）
//      keep: true … 値（式）は変えず、fmt だけ変える（様式の式の結果に、入力した値などを並べて見せる）
//    項目の名前が「@」で始まるものは、確認用カルテにだけ出す計算した値（store/initial.js の karteExtras）
//  - 印刷したときの上の余白（ヘッダー）の右に「確認用」の印（設定 mark）を入れる。markCell があれば、そのセルにも書く
// 保存する前に、書き出したファイルを読み直して照合する。1件でも食い違えば保存しない。

import ExcelJS from 'exceljs';
import { fitSize, sheetGeometry } from './fitText.js';
import JSZip from 'jszip';
import { toHalf } from '../core/text.js';
import { fillFmt, karteValue } from '../core/karteCells.js';
import { colNumber, setCells, splitAddress } from './xmlCells.js';
import { sheetFiles } from './xlsxFix.js';

const DEFAULT_MARK = '確認用（提出不可）';

// ---------- 様式のブックを読む ----------

// 共有の文字の表（sharedStrings.xml）を読む
function readSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''),
  );
}
const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

// シートの XML のセルを、番地ごとに読む。返す形：Map(番地 → { xml, text })
export function readCells(sheetXml, sst) {
  const out = new Map();
  const start = sheetXml.indexOf('<sheetData');
  const end = sheetXml.indexOf('</sheetData>');
  if (start < 0 || end < 0) return out;
  const data = sheetXml.slice(start, end);
  for (const m of data.matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
    const r = (m[1].match(/\br="([A-Z]+\d+)"/) || [])[1];
    if (!r) continue;
    const t = (m[1].match(/\bt="([^"]+)"/) || [])[1];
    const inner = m[3] || '';
    let text = '';
    if (t === 's') text = sst[Number((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1])] ?? '';
    else if (t === 'inlineStr') text = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1])).join('');
    else text = unescapeXml((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
    out.set(r, { xml: m[0], text, formula: /<f\b/.test(inner) });
  }
  return out;
}

// 様式のブックを読み、設定の様式のシートを探す
//  返す形：{ sheets: [{ spec, name, file, errors: [...] }], errors: [...] }（errors は見つからない様式など）
export async function readKarteTemplate(buffer, cfg) {
  const k = cfg.initialSurvey?.karte;
  if (!k) throw new Error('設定に initialSurvey.karte（カルテの様式）がありません');
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('xl/workbook.xml')) throw new Error('Excel のブック（.xlsx・.xlsm）を選んでください');
  const files = await sheetFiles(zip);
  const sst = readSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'));
  const sheets = [];
  const errors = [];
  for (const spec of k.sheets) {
    const re = new RegExp(spec.sheet);
    const hit = files.find((f) => re.test(unescapeXml(f.name)));
    if (!hit) {
      errors.push(`様式のシート（${spec.sheet}）が見つかりません`);
      continue;
    }
    const xml = await zip.file(hit.file)?.async('string');
    if (!xml) {
      errors.push(`シート「${hit.name}」の中のファイルが見つかりません`);
      continue;
    }
    const cells = readCells(xml, sst);
    const errs = [];
    for (const [addr, text] of Object.entries(spec.checks || {})) {
      const got = (cells.get(addr)?.text || '').replace(/[\s　]/g, '');
      if (!got.includes(text.replace(/[\s　]/g, ''))) errs.push(`シート「${unescapeXml(hit.name)}」の ${addr} が「${text}」ではありません（${got || '空欄'}）`);
    }
    for (const c of spec.cells) if (cells.get(c.cell)?.formula && !c.replaceFormula && !c.keep) errs.push(`シート「${unescapeXml(hit.name)}」の ${c.cell} には式が入っているため書き込めません`);
    sheets.push({ spec, name: unescapeXml(hit.name), file: hit.file, errors: errs });
    errors.push(...errs);
  }
  return { sheets, errors };
}

// ---------- 書き出す ----------

// 書式（styles.xml）に、表示形式だけを変えた書式を足していく道具
//  derive(元の書式の番号, 表示形式) → 新しい書式の番号（同じ組み合わせは使い回す）
//  xml() → 足した後の styles.xml
function styleBook(stylesXml) {
  let xml = stylesXml;
  const xfsM = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!xfsM) throw new Error('様式のブックの書式（cellXfs）が読めません');
  const xfs = [...xfsM[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
  const added = [];
  const fmts = [];
  const ids = [...xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
  let nextId = Math.max(163, ...ids) + 1;
  const cache = new Map();
  // 文字の書式（fonts）。文字の大きさを変えた書式を足すのに使う
  const fontsM = xml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/);
  const fonts = fontsM ? [...fontsM[1].matchAll(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g)].map((m) => m[0]) : [];
  const addedFonts = [];
  const xfOf = (base) => xfs[Number(base) || 0] || '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
  const fontIdOf = (base) => Number(xfOf(base).match(/\bfontId="(\d+)"/)?.[1] ?? 0);
  return {
    // 書式の文字の大きさ（pt）
    fontSize(base) {
      const f = fonts[fontIdOf(base)] || '';
      return Number(f.match(/<sz\b[^>]*\bval="([\d.]+)"/)?.[1] ?? 11);
    },
    // 文字の大きさを size にし、折り返して表示する書式を足す（同じ組み合わせは使い回す）
    fit(base, size) {
      const key = `${base}|fit|${size}`;
      if (cache.has(key)) return cache.get(key);
      const f = fonts[fontIdOf(base)] || '<font><sz val="11"/></font>';
      const font = /<sz\b/.test(f) ? f.replace(/<sz\b[^>]*\/>/, `<sz val="${size}"/>`) : f.replace(/^<font\b([^>]*)\/>$/, '<font$1></font>').replace(/^(<font\b[^>]*>)/, `$1<sz val="${size}"/>`);
      const fontId = fonts.length + addedFonts.length;
      addedFonts.push(font);
      let xf = xfOf(base).replace(/\bfontId="\d+"/, `fontId="${fontId}"`);
      if (!/\bfontId="/.test(xf)) xf = xf.replace(/^<xf\b/, `<xf fontId="${fontId}"`);
      xf = /\bapplyFont="/.test(xf) ? xf.replace(/\bapplyFont="[^"]*"/, 'applyFont="1"') : xf.replace(/^<xf\b/, '<xf applyFont="1"');
      xf = /\bapplyAlignment="/.test(xf) ? xf.replace(/\bapplyAlignment="[^"]*"/, 'applyAlignment="1"') : xf.replace(/^<xf\b/, '<xf applyAlignment="1"');
      // 折り返す（縮小して全体を表示、は外す。小さくなりすぎるため）
      if (/<alignment\b/.test(xf)) {
        xf = xf.replace(/<alignment\b[^>]*?\/?>/, (a) => {
          let t = a.replace(/\s+shrinkToFit="[^"]*"/, '').replace(/\s+wrapText="[^"]*"/, '');
          return t.replace(/<alignment\b/, '<alignment wrapText="1"');
        });
      } else xf = xf.endsWith('/>') ? xf.replace(/\/>$/, '><alignment wrapText="1" vertical="center"/></xf>') : xf.replace(/<\/xf>$/, '<alignment wrapText="1" vertical="center"/></xf>');
      const idx = xfs.length + added.length;
      added.push(xf);
      cache.set(key, idx);
      return idx;
    },
    derive(base, code) {
      const key = `${base}|${code}`;
      if (cache.has(key)) return cache.get(key);
      const id = nextId++;
      fmts.push(`<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`);
      const src = xfs[Number(base) || 0] || '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
      let xf = /\bnumFmtId="\d+"/.test(src) ? src.replace(/\bnumFmtId="\d+"/, `numFmtId="${id}"`) : src.replace(/^<xf\b/, `<xf numFmtId="${id}"`);
      xf = /\bapplyNumberFormat="/.test(xf) ? xf.replace(/\bapplyNumberFormat="[^"]*"/, 'applyNumberFormat="1"') : xf.replace(/^<xf\b/, '<xf applyNumberFormat="1"');
      // 足した文字で幅が足りなくなっても「###」にならないよう、縮小して全体を表示する
      if (/<alignment\b/.test(xf)) xf = /shrinkToFit=/.test(xf) ? xf.replace(/shrinkToFit="[^"]*"/, 'shrinkToFit="1"') : xf.replace(/<alignment\b/, '<alignment shrinkToFit="1"');
      else xf = xf.endsWith('/>') ? xf.replace(/\/>$/, ' applyAlignment="1"><alignment shrinkToFit="1"/></xf>') : xf.replace(/<\/xf>$/, '<alignment shrinkToFit="1"/></xf>');
      const idx = xfs.length + added.length;
      added.push(xf);
      cache.set(key, idx);
      return idx;
    },
    xml() {
      if (!added.length) return stylesXml;
      let out = xml.replace(/(<cellXfs\b[^>]*>)([\s\S]*?)(<\/cellXfs>)/, (_, a, b, c) => a.replace(/count="\d+"/, `count="${xfs.length + added.length}"`) + b + added.join('') + c);
      if (addedFonts.length)
        out = out.replace(/(<fonts\b[^>]*>)([\s\S]*?)(<\/fonts>)/, (_, a, b, c) => a.replace(/count="\d+"/, `count="${fonts.length + addedFonts.length}"`) + b + addedFonts.join('') + c);
      if (/<numFmts\b/.test(out)) {
        out = out.replace(/<numFmts\b[^>]*\/>/, '<numFmts count="0"></numFmts>');
        out = out.replace(/(<numFmts\b[^>]*>)([\s\S]*?)(<\/numFmts>)/, (_, a, b, c) => {
          const n = (b.match(/<numFmt\b/g) || []).length + fmts.length;
          return a.replace(/count="\d+"/, `count="${n}"`) + b + fmts.join('') + c;
        });
      } else out = out.replace(/(<styleSheet\b[^>]*>)/, `$1<numFmts count="${fmts.length}">${fmts.join('')}</numFmts>`);
      return out;
    },
  };
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 写したシートの XML を、単独のブックで使える形に整える
//  - 別のファイル（印刷の設定・図など）への関連付けを外す。外せない部品があれば誤り
//  - シートの選択の印（複数選ぶと「グループ」になる）、マクロ用の名前を外す
//  - 式の前回の計算結果を消す（開いたときに計算し直す）
//  - 印刷のヘッダーの右に印を入れる
export function normalizeSheet(xml, mark) {
  let x = xml
    .replace(/(<sheetPr\b[^>]*?)\s+codeName="[^"]*"/, '$1')
    .replace(/\s+tabSelected="1"/g, '')
    .replace(/(<pageSetup\b[^>]*?)\s+r:id="[^"]*"/, '$1')
    .replace(/<legacyDrawingHF\b[^>]*\/>/g, '')
    .replace(/<(drawing|legacyDrawing|picture)\b[^>]*\/>/g, '');
  // 式のセルの計算結果 <v>…</v> を消す
  x = x.replace(/(<c\b[^>]*?)(\s+t="(?:str|n|b|e)")?(>\s*<f\b[\s\S]*?(?:<\/f>|\/>))\s*<v>[\s\S]*?<\/v>/g, '$1$3');
  if (/\br:id="/.test(x)) throw new Error('様式のシートに、写せない部品（図・リンクなど）があります');
  if (mark) {
    const hf = `&amp;R${escapeXml(mark)}`;
    if (/<headerFooter\b/.test(x)) {
      x = x.replace(/<headerFooter\b([^>]*?)\/>/, `<headerFooter$1><oddHeader>${hf}</oddHeader></headerFooter>`);
      if (/<oddHeader>/.test(x)) x = x.replace(/<oddHeader>([\s\S]*?)<\/oddHeader>/, (_, h) => `<oddHeader>${h.replace(/&amp;R[\s\S]*?(?=&amp;[LC]|$)/, '')}${hf}</oddHeader>`);
      else x = x.replace(/(<headerFooter\b[^>]*>)/, `$1<oddHeader>${hf}</oddHeader>`);
    } else {
      const el = `<headerFooter><oddHeader>${hf}</oddHeader></headerFooter>`;
      // 置く順番の決まり：pageSetup の後ろ（なければ pageMargins の後ろ）。後ろに来る部品があればその前
      const after = x.match(/<pageSetup\b[^>]*\/>|<pageSetup\b[\s\S]*?<\/pageSetup>/) || x.match(/<pageMargins\b[^>]*\/>/);
      if (after) x = x.slice(0, after.index + after[0].length) + el + x.slice(after.index + after[0].length);
      else {
        const before = x.match(/<(rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
        const at = before ? before.index : x.lastIndexOf('</worksheet>');
        x = x.slice(0, at) + el + x.slice(at);
      }
    }
  }
  return x;
}

// シートの名前に使えない文字を除き、31文字までにし、重ならないようにする
function sheetName(base, used) {
  const clean = String(base).replace(/[\\/?*:[\]]/g, '').trim().slice(0, 31) || 'カルテ';
  let name = clean;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${clean.slice(0, 31 - String(i).length - 2)}(${i})`;
  used.add(name.toLowerCase());
  return name;
}

// 記録の並び：場所の種類 → 場所のコード → 樹木番号
const codeOf = (rec, cfg) => {
  const k = cfg.dbFormat.sheets.find((x) => x.type === rec.siteType)?.code;
  return k ? toHalf(String(rec[k] ?? '')).trim() : '';
};

// 確認用のカルテを作る
//  records：詳しい診断の記録（入力済み・削除していないもの。絞り込みは呼ぶ側）
//  返す形：{ buffer, errors: [...], stats: { sheets: [{ name, treeNo, form }], skippedNoTemplate: [番号…] } }
export async function exportKarte(templateBuffer, records, cfg) {
  const k = cfg.initialSurvey?.karte;
  if (!k) throw new Error('設定に initialSurvey.karte（カルテの様式）がありません');
  const mark = k.mark ?? DEFAULT_MARK;
  const tpl = await readKarteTemplate(templateBuffer.slice(0), cfg);
  const errors = [];
  const stats = { sheets: [], skippedNoTemplate: [], tooLong: [] }; // tooLong：最小の大きさでも枠に収まらない欄 [{ sheet, cell }]
  const src = await JSZip.loadAsync(templateBuffer);
  const base = new Map(); // 様式の form|siteType → 整えた XML
  for (const s of tpl.sheets) {
    if (s.errors.length) continue;
    try {
      base.set(`${s.spec.form}|${s.spec.siteType}`, normalizeSheet(await src.file(s.file).async('string'), mark));
    } catch (e) {
      errors.push(`シート「${s.name}」：${e.message}`);
    }
  }
  errors.push(...tpl.errors);
  if (errors.length) return { buffer: null, errors, stats };
  const stylesPath = await partPath(src, 'styles');
  const styles = styleBook(await src.file(stylesPath).async('string'));
  const baseStyle = (key, addr) => (readCells(base.get(key), []).get(addr)?.xml.match(/\bs="(\d+)"/) || [])[1] ?? '0';
  const geos = new Map([...base].map(([key, xml]) => [key, sheetGeometry(xml)])); // 様式ごとのセルの枠の大きさ
  // 様式のセルに元から入っている文（共有の文字の表から読む）
  const sstPath = await partPath(src, 'sharedStrings').catch(() => null);
  const sst0 = readSharedStrings(sstPath ? await src.file(sstPath)?.async('string') : '');
  const templateCells = new Map([...base].map(([key, xml]) => [key, readCells(xml, sst0)]));
  const templateText = (key, addr) => templateCells.get(key)?.get(addr)?.text ?? '';
  const minFont = k.minFontSize ?? 7;

  const order = (r) => [String(cfg.dbFormat.sheets.findIndex((x) => x.type === r.siteType)).padStart(3, '0'), codeOf(r, cfg), toHalf(String(r.treeNo ?? '')).trim()].join('|');
  const sorted = [...records].sort((a, b) => order(a).localeCompare(order(b), 'ja'));
  const used = new Set();
  const out = []; // [{ name, xml, edits, key, treeNo, form }]
  for (const rec of sorted) {
    const no = toHalf(String(rec.treeNo ?? '')).trim();
    const specs = k.sheets.filter((s) => s.siteType === rec.siteType);
    if (!specs.length) {
      stats.skippedNoTemplate.push(no || '(番号なし)');
      continue;
    }
    for (const spec of specs) {
      const key = `${spec.form}|${spec.siteType}`;
      const edits = spec.cells.map((c) => {
        const e = { addr: c.cell, value: c.keep ? undefined : karteValue(c, rec), replaceFormula: !!c.replaceFormula, keepValue: !!c.keep };
        const code = fillFmt(c.fmt, rec);
        if (code) {
          e.style = styles.derive(baseStyle(key, c.cell), code);
          e.numFmt = code;
        } else if (typeof e.value === 'string' && e.value && e.value.length > templateText(key, c.cell).length) {
          // 文が枠に収まらなければ、文字を小さくして折り返す（最小 minFont まで）
          //  様式に元から入っている文（「□無 □有」など）より長いときだけ。同じ長さなら様式の書式のまま
          const b = baseStyle(key, c.cell);
          const r = fitSize(e.value, geos.get(key)(c.cell), styles.fontSize(b), minFont);
          if (r.wrap) {
            e.style = styles.fit(b, r.size);
            e.fit = r.size;
          }
          if (!r.fits) e.tooLong = true;
        }
        return e;
      });
      if (spec.markCell && mark) edits.push({ addr: spec.markCell, value: mark }); // 画面でも見える確認用の印
      let xml;
      try {
        xml = setCells(base.get(key), edits);
      } catch (e) {
        errors.push(`${no}：${e.message}`);
        continue;
      }
      const name = sheetName(`${no || '番号なし'}${spec.suffix || ''}`, used);
      out.push({ name, xml, edits, key, treeNo: no, form: spec.form });
      for (const e of edits) if (e.tooLong) stats.tooLong.push({ sheet: name, cell: e.addr });
      stats.sheets.push({ name, treeNo: no, form: spec.form });
    }
  }
  if (errors.length) return { buffer: null, errors, stats };
  if (!out.length) return { buffer: null, errors: [], stats };

  const buffer = await buildBook(src, out, styles.xml());

  // ---------- 照合 ----------
  errors.push(...(await verifyKarte(buffer, out, base)));
  if (errors.length) return { buffer: null, errors, stats };
  return { buffer, errors: [], stats };
}

// ブックの中の部品（styles など）のファイルの場所
async function partPath(src, type) {
  const relXml = await src.file('xl/_rels/workbook.xml.rels').async('string');
  const m = [...relXml.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((x) => new RegExp(`Type="[^"]*/${type}"`).test(x));
  const t = m && (m.match(/\bTarget="([^"]+)"/) || [])[1];
  if (!t) throw new Error(`様式のブックに ${type} がありません`);
  return t.replace(/^\/?(xl\/)?/, 'xl/');
}

// 写したシートだけのブックを組み立てる（書式・共有の文字・テーマは様式のブックのものを使う）
async function buildBook(src, sheets, stylesXml) {
  const zip = new JSZip();
  const relXml = await src.file('xl/_rels/workbook.xml.rels').async('string');
  const target = (type) => {
    const m = [...relXml.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((x) => new RegExp(`Type="[^"]*/${type}"`).test(x));
    const t = m && (m.match(/\bTarget="([^"]+)"/) || [])[1];
    return t ? t.replace(/^\/?(xl\/)?/, 'xl/') : null;
  };
  const parts = [
    { type: 'styles', path: 'xl/styles.xml', ct: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml' },
    { type: 'sharedStrings', path: 'xl/sharedStrings.xml', ct: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml' },
    { type: 'theme', path: 'xl/theme/theme1.xml', ct: 'application/vnd.openxmlformats-officedocument.theme+xml' },
  ];
  const rels = [];
  const overrides = [];
  let rid = 1;
  sheets.forEach((s, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, i === 0 ? s.xml.replace(/<sheetView\b/, '<sheetView tabSelected="1"') : s.xml);
    rels.push(`<Relationship Id="rId${rid++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });
  for (const p of parts) {
    const from = target(p.type);
    const f = from && src.file(from);
    if (!f) {
      if (p.type === 'styles') throw new Error('様式のブックに書式（styles.xml）がありません');
      continue;
    }
    zip.file(p.path, p.type === 'styles' && stylesXml ? stylesXml : await f.async('uint8array'));
    rels.push(`<Relationship Id="rId${rid++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${p.type}" Target="${p.path.replace(/^xl\//, '')}"/>`);
    overrides.push(`<Override PartName="/${p.path}" ContentType="${p.ct}"/>`);
  }
  const sheetsXml = sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetsXml}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides.join('') +
      '</Types>',
  );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// 照合
//  - シートの数・名前・並びが、作ったとおり
//  - 書き込んだセルの値が、記録から作った値と同じ（ExcelJS で読み直す。別の読み方で確かめる）
//  - 書き込んでいないセルは、様式と1文字も違わない。セル以外の部分（結合・入力規則・印刷の設定）も様式のまま
async function verifyKarte(buffer, sheets, base) {
  const errors = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const names = wb.worksheets.map((w) => w.name);
  if (names.join('\n') !== sheets.map((s) => s.name).join('\n')) errors.push('読み直したカルテのシートの並びが、作ったものと違います');
  const zip = await JSZip.loadAsync(buffer);
  const sst = readSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'));
  const files = await sheetFiles(zip);
  for (const s of sheets) {
    const ws = wb.getWorksheet(s.name);
    if (!ws) {
      errors.push(`読み直したカルテにシート「${s.name}」がありません`);
      continue;
    }
    for (const e of s.edits) {
      const cell = ws.getCell(e.addr);
      if (!e.keepValue) {
        const got = cellOf(cell.value);
        if (got !== (e.value ?? '')) errors.push(`シート「${s.name}」の ${e.addr}：値が違います（期待：${e.value} ／ ファイル：${got}）`);
      }
      if (e.numFmt && cell.numFmt !== e.numFmt) errors.push(`シート「${s.name}」の ${e.addr}：表示形式が違います（期待：${e.numFmt} ／ ファイル：${cell.numFmt}）`);
      // ExcelJS は 0.5pt 刻みの大きさを整数に丸めて読むので、1pt 未満の違いは同じとみなす
      if (e.fit && (!(Math.abs((cell.font?.size ?? 0) - e.fit) < 1) || !cell.alignment?.wrapText)) errors.push(`シート「${s.name}」の ${e.addr}：文字の大きさ・折り返しが違います（期待：${e.fit}pt）`);
    }
    const f = files.find((x) => x.name === escapeXml(s.name) || x.name === s.name)?.file;
    const xml = f && (await zip.file(f)?.async('string'));
    if (!xml) {
      errors.push(`シート「${s.name}」の中のファイルが見つかりません`);
      continue;
    }
    const want = base.get(s.key);
    const head = (x) => x.slice(0, x.indexOf('<sheetData')).replace(/\s+tabSelected="1"/g, '');
    const tail = (x) => x.slice(x.indexOf('</sheetData>'));
    if (head(xml) !== head(want) || tail(xml) !== tail(want)) errors.push(`シート「${s.name}」：セル以外の部分（結合・入力規則・印刷の設定など）が様式と違います`);
    const a = readCells(want, sst);
    const b = readCells(xml, sst);
    const edited = new Set(s.edits.filter((e) => !e.keepValue).map((e) => e.addr));
    // 値を変えない（表示形式だけ変えた）セルは、書式の番号のほかは様式と同じ
    const noStyle = (x) => (x || '').replace(/\s+s="\d+"/, '');
    for (const e of s.edits.filter((x) => x.keepValue))
      if (noStyle(b.get(e.addr)?.xml) !== noStyle(a.get(e.addr)?.xml)) errors.push(`シート「${s.name}」の ${e.addr}：式・値が様式と違います`);
    const keptAddrs = new Set(s.edits.filter((x) => x.keepValue).map((x) => x.addr));
    for (const [addr, c] of a) if (!edited.has(addr) && !keptAddrs.has(addr) && b.get(addr)?.xml !== c.xml) errors.push(`シート「${s.name}」の ${addr}：書き込んでいないセルが様式と違います`);
    for (const addr of b.keys()) if (!edited.has(addr) && !a.has(addr)) errors.push(`シート「${s.name}」の ${addr}：様式にないセルがあります`);
  }
  return errors;
}

// ExcelJS のセルの値を、比べられる形（文字か数）にする
function cellOf(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v.richText) return v.richText.map((r) => r.text).join('');
  if (v.text != null) return String(v.text);
  return String(v);
}

// セルの番地を、行・列の順に並べる（テストで使う）
export const sortAddrs = (list) => [...list].sort((a, b) => splitAddress(a).row - splitAddress(b).row || colNumber(splitAddress(a).col) - colNumber(splitAddress(b).col));
