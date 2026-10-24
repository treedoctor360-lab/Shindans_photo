// 詳しい診断（初期診断など）の記録を、データ入力用ブックに書き込む（書き込んだ後に全件照合）
//
// このブックは別の仕組み（カルテを作るマクロなど）が「列の位置」で読む。そのため、
//  - 列は設定（initialSurvey.book）の列だけを使う。見出しが設定と違うシートには書かない
//  - 書き込むセルの XML だけを書き換え、ほかの部分（書式・入力規則・結合など）は変えない（xmlCells.js）
//  - 書き込む行は、入力済みの最後の行より下の空き行。通し番号など、先に入っている値の列には書かない
//  - ブックで入力済みの木は書かない（二重入力の防止）
//  - 選択肢の項目は、ブックの入力規則（ドロップダウン）にある値だけ書く（候補を出すだけの入力規則なら、ほかの値も書く）
// 保存する前に、書き出したファイルを読み直して照合する。1件でも食い違えば保存しない。

import JSZip from 'jszip';
import { toHalf } from '../core/text.js';
import { bookKey, filledIndex, readInitialBook } from './initialBook.js';
import { setCells } from './xmlCells.js';
import { sheetFiles } from './xlsxFix.js';

const isBlank = (v) => v == null || String(v).trim() === '';
const FORMS = ['initial', 'environment'];

// 記録の場所のコード（公園のコードなど。台帳の設定 dbFormat.sheets の code）
const codeOf = (rec, cfg) => {
  const k = cfg.dbFormat.sheets.find((x) => x.type === rec.siteType)?.code;
  return k ? rec[k] : '';
};

// 書き込んだ行の場所のコード（照合用）
const codeOfRow = (sheet, e, cfg) => {
  const k = cfg.dbFormat.sheets.find((x) => x.type === sheet.spec.siteType)?.code;
  return k ? e.values[k] : '';
};

// 照合のための値の比べ方（数と数字の文字は同じとみなさない。文字は前後の空白を無視しない）
const same = (a, b) => (a ?? '') === (b ?? '');

// 書き込む値の一覧を作る。返す形：[{ key, col, value }]
function valuesFor(rec, spec, serialKey) {
  const out = [];
  for (const [key, c] of Object.entries(spec.columns)) {
    if (key === serialKey) continue; // 通し番号はブックのものを使う
    const v = rec[key];
    if (isBlank(v)) continue;
    out.push({ key, col: c.col, value: typeof v === 'number' ? v : String(v) });
  }
  return out;
}

// 書き込む
//  records：書き込む詳しい診断の記録（入力済み・削除していないもの。絞り込みは呼ぶ側）
//  返す形：{ buffer, errors: [...], stats: { written: [{ treeNo, sheet, row }], skippedInBook: [番号…], skippedNoNumber: n } }
// 設定で任意記入（free）にした項目の名前（選択肢にない値も書ける）
const freeKeys = (cfg, form) =>
  new Set((cfg.initialSurvey?.forms?.[form]?.sections || []).flatMap((sec) => sec.items).filter((it) => it.free).map((it) => it.key));

export async function exportInitialBook(buffer, records, cfg) {
  const book = cfg.initialSurvey?.book;
  if (!book) throw new Error('設定に initialSurvey（データ入力用ブックの書式）がありません');
  const serialKey = cfg.initialSurvey.serialKey || 'serial';
  const errors = [];
  const stats = { written: [], skippedInBook: [], skippedNoNumber: 0 };

  const before = await readInitialBook(buffer, cfg);
  const filled = filledIndex(before, cfg);
  const sheetOf = (form, siteType) => before.sheets.find((s) => s.spec.form === form && (s.spec.siteType || '') === (siteType || ''));

  // 書き込む行の割り当て：シートごとに、入力済みの最後の行より下の空き行を上から使う
  const freeRows = new Map(); // シート名 → [行番号…]
  for (const s of before.sheets) {
    const lastFilled = Math.max(0, ...s.rows.filter((r) => r.filled).map((r) => r.rowNumber));
    freeRows.set(
      s.name,
      s.rows.filter((r) => !r.filled && r.rowNumber > lastFilled).map((r) => r.rowNumber),
    );
  }

  const edits = new Map(); // シート名 → [{ addr, value }]
  const expect = []; // 照合用：{ sheet, row, values: { 項目: 値 } }
  const seen = new Set();
  for (const rec of records) {
    const no = toHalf(String(rec.treeNo ?? '')).trim();
    if (!no) {
      stats.skippedNoNumber++;
      continue;
    }
    const k = bookKey('', rec.siteType, codeOf(rec, cfg), no); // 書式の部分を空けた鍵（同じ木の見分け用）
    if (FORMS.some((f) => filled.has(bookKey(f, rec.siteType, codeOf(rec, cfg), no)))) {
      stats.skippedInBook.push(no);
      continue;
    }
    if (seen.has(k)) {
      errors.push(`${no}：同じ木の記録が2件あります（書き込みません）`);
      continue;
    }
    seen.add(k);

    for (const form of FORMS) {
      const spec = book.sheets.find((s) => s.form === form && (s.siteType || '') === (rec.siteType || ''));
      if (!spec) continue; // その書式のシートを使わない設定
      const sheet = sheetOf(form, rec.siteType);
      if (!sheet) {
        errors.push(`${no}：ブックにシート（${spec.name}）が見つかりません`);
        continue;
      }
      if (sheet.errors.length) {
        errors.push(`${no}：シート「${sheet.name}」の見出しが設定と違うため書き込めません`);
        continue;
      }
      const vals = valuesFor(rec, spec, serialKey);
      // 選択肢の項目は、入力規則にある値だけ（候補を出すだけの入力規則と、設定で任意記入（free）にした項目は除く）
      const free = freeKeys(cfg, spec.form);
      for (const v of vals) {
        const opts = sheet.strict?.has(v.key) && !free.has(v.key) ? sheet.options[v.key] : null;
        if (opts && !opts.includes(String(v.value))) errors.push(`${no}：${sheet.name} の ${v.col}列（${v.key}）の「${v.value}」はブックの選択肢にありません`);
      }
      const row = freeRows.get(sheet.name).shift();
      if (!row) {
        errors.push(`${no}：シート「${sheet.name}」に空き行が足りません（ブックに行を足してから、もう一度出力してください）`);
        continue;
      }
      if (!edits.has(sheet.name)) edits.set(sheet.name, []);
      edits.get(sheet.name).push(...vals.map((v) => ({ addr: `${v.col}${row}`, value: v.value })));
      expect.push({ sheet: sheet.name, row, no, values: Object.fromEntries(vals.map((v) => [v.key, v.value])) });
      stats.written.push({ treeNo: no, sheet: sheet.name, row });
    }
  }
  for (const s of before.errors) errors.push(s);
  if (errors.length) return { buffer: null, errors, stats };

  // XML を直接書き換える
  const zip = await JSZip.loadAsync(buffer);
  const files = await sheetFiles(zip);
  for (const [name, list] of edits) {
    const f = files.find((x) => x.name === name)?.file;
    if (!f || !zip.file(f)) throw new Error(`シート「${name}」の中のファイルが見つかりません`);
    zip.file(f, setCells(await zip.file(f).async('string'), list));
  }
  // 式の計算結果を開いたときに計算し直してもらう印は付けない（式には触らないため）
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

  // ---------- 照合 ----------
  const after = await readInitialBook(out, cfg);
  errors.push(...verify(before, after, expect, cfg));
  errors.push(...(await verifyXml(buffer, out, edits)));
  if (errors.length) return { buffer: null, errors, stats };
  return { buffer: out, errors: [], stats };
}

// 読み直した中身の照合
//  - 書き込んだ行：書き込んだ項目はすべて入力どおり、書き込んでいない項目は元のまま
//  - ほかの行：すべての項目が元のまま
//  - シートの数・行の数が変わっていない。入力済みの本数が、書き込んだ分だけ増えている
//  - 書き込んだ木が、ブックの中で重なっていない
function verify(before, after, expect, cfg) {
  const errors = [];
  if (after.sheets.length !== before.sheets.length) errors.push('読み直したブックのシートの数が変わっています');
  const byRow = new Map(expect.map((e) => [`${e.sheet}|${e.row}`, e]));
  for (const b of before.sheets) {
    const a = after.sheets.find((s) => s.name === b.name);
    if (!a) {
      errors.push(`読み直したブックにシート「${b.name}」がありません`);
      continue;
    }
    if (a.errors.length) errors.push(`シート「${b.name}」の見出しが変わっています`);
    const aRows = new Map(a.rows.map((r) => [r.rowNumber, r]));
    for (const br of b.rows) {
      const ar = aRows.get(br.rowNumber);
      if (!ar) {
        errors.push(`シート「${b.name}」の${br.rowNumber}行目がなくなっています`);
        continue;
      }
      const e = byRow.get(`${b.name}|${br.rowNumber}`);
      for (const key of Object.keys(b.spec.columns)) {
        const want = e && key in e.values ? e.values[key] : br.values[key];
        if (!same(ar.values[key], want))
          errors.push(
            `シート「${b.name}」${br.rowNumber}行目の${b.spec.columns[key].col}列（${key}）：${e ? `${e.no}の` : '書き込んでいない行の'}値が違います（期待：${want ?? ''} ／ ファイル：${ar.values[key] ?? ''}）`,
          );
      }
    }
    const nWritten = expect.filter((x) => x.sheet === b.name).length;
    const nb = b.rows.filter((r) => r.filled).length;
    const na = a.rows.filter((r) => r.filled).length;
    if (na !== nb + nWritten) errors.push(`シート「${b.name}」の入力済みの行の数が合いません（元${nb}行＋書き込み${nWritten}行 ／ ファイル${na}行）`);
  }
  // 書き込んだ木が、同じシートの中で2行以上になっていない
  const index = filledIndex(after, cfg);
  for (const e of expect) {
    const s = after.sheets.find((x) => x.name === e.sheet);
    const k = bookKey(s.spec.form, s.spec.siteType, codeOfRow(s, e, cfg), e.no);
    if ((index.get(k) || []).length !== 1) errors.push(`${e.no}：シート「${e.sheet}」に同じ木の行が${(index.get(k) || []).length}行あります`);
  }
  return errors;
}

// XML の照合：書き込んだシート以外のファイルは1文字も変わっていない。書き込んだシートでも、
// セルの並び（sheetData）より後ろ（入力規則・結合・印刷の設定など）と前（列の幅など）は変わっていない
async function verifyXml(original, out, edits) {
  const errors = [];
  const a = await JSZip.loadAsync(original);
  const b = await JSZip.loadAsync(out);
  const aNames = Object.keys(a.files).filter((n) => !a.files[n].dir).sort();
  const bNames = Object.keys(b.files).filter((n) => !b.files[n].dir).sort();
  if (aNames.join('\n') !== bNames.join('\n')) errors.push('ブックの中のファイルの構成が変わっています');
  const touched = new Set((await sheetFiles(a)).filter((x) => edits.has(x.name)).map((x) => x.file));
  for (const n of aNames) {
    if (!b.file(n)) continue;
    const [x, y] = await Promise.all([a.file(n).async('uint8array'), b.file(n).async('uint8array')]);
    if (!touched.has(n)) {
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) errors.push(`書き込んでいない部分（${n}）が変わっています`);
      continue;
    }
    const sx = new TextDecoder().decode(x);
    const sy = new TextDecoder().decode(y);
    const head = (s) => s.slice(0, s.indexOf('<sheetData'));
    const tail = (s) => {
      const i = s.indexOf('</sheetData>');
      return i < 0 ? '' : s.slice(i);
    };
    if (head(sx) !== head(sy) || tail(sx).replace(/^<\/sheetData>/, '') !== tail(sy).replace(/^<\/sheetData>/, ''))
      errors.push(`${n}：セル以外の部分（入力規則・結合など）が変わっています`);
  }
  return errors;
}

// 出力するファイルの名前に使う、書き込んだ本数の説明
export const writtenTrees = (stats) => [...new Set(stats.written.map((w) => w.treeNo))];
