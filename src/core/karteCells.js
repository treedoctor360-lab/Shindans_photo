// 確認用のカルテ（1本1シート）の、どのセルに何を書くか（設定 initialSurvey.karte）と、値の作り方
//  書き出しは src/excel/karteExport.js。値の形は karteExport.js の先頭の説明を参照

import { toHalf } from './text.js';

export const KARTE_MATCH = ['exact', 'first', 'contains'];
// 確認用カルテにだけ出す計算した値（store/initial.js の karteExtras が作る）
export const KARTE_CALC = ['@girthList', '@girthStems', '@heightRatio', '@heightInput', '@branchRatio', '@branchInput'];

const isStr = (x) => typeof x === 'string' && x.length > 0;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isAddr = (x) => typeof x === 'string' && /^[A-Z]{1,3}[1-9]\d*$/.test(x);

// ---------- 設定の確かめ（config.js から呼ぶ） ----------
//  keys：その書式（form）で使える項目の名前（入力画面の項目・ブックの列・調査日など）
export function validateKarte(k, keysOf, siteTypes, need) {
  if (!need(isObj(k), 'initialSurvey.karte の形が違います')) return;
  need(k.mark == null || typeof k.mark === 'string', 'initialSurvey.karte.mark は文字にしてください');
  need(k.fileLabel == null || typeof k.fileLabel === 'string', 'initialSurvey.karte.fileLabel（ファイル名に入れる書式の名前）は文字にしてください');
  need(k.minFontSize == null || (typeof k.minFontSize === 'number' && k.minFontSize >= 5 && k.minFontSize <= 11), 'initialSurvey.karte.minFontSize（長い文を小さくするときの最小の文字の大きさ）は 5〜11 の数にしてください');
  if (!need(Array.isArray(k.sheets) && k.sheets.length > 0, 'initialSurvey.karte.sheets（カルテの様式の一覧）がありません')) return;
  const seen = new Set();
  k.sheets.forEach((sh, i) => {
    const at = `initialSurvey.karte.sheets[${i}]`;
    if (!need(isObj(sh), `${at} の形が違います`)) return;
    need(['initial', 'environment'].includes(sh.form), `${at}.form は initial・environment のどれかです`);
    need(siteTypes.includes(sh.siteType), `${at}.siteType は dbFormat.sheets の type のどれかです`);
    const id = `${sh.form}|${sh.siteType}`;
    need(!seen.has(id), `${at}：同じ form・siteType の様式が2つあります`);
    seen.add(id);
    let reOk = isStr(sh.sheet);
    if (reOk)
      try {
        new RegExp(sh.sheet);
      } catch {
        reOk = false;
      }
    need(reOk, `${at}.sheet（様式のシート名の正規表現）が読めません`);
    need(sh.suffix == null || typeof sh.suffix === 'string', `${at}.suffix は文字にしてください`);
    need(sh.markCell == null || isAddr(sh.markCell), `${at}.markCell（確認用の印を書くセル）はセルの番地にしてください`);
    if (sh.checks != null) need(isObj(sh.checks) && Object.entries(sh.checks).every(([a, t]) => isAddr(a) && isStr(t)), `${at}.checks は { "D7": "樹高", … }（番地: 入っているはずの文字）の形にしてください`);
    if (!need(Array.isArray(sh.cells) && sh.cells.length > 0, `${at}.cells（書き込むセルの一覧）がありません`)) return;
    const known = keysOf(sh.form);
    const addrs = [];
    sh.cells.forEach((c, j) => {
      const ct = `${at}.cells[${j}]`;
      if (!need(isObj(c) && isAddr(c.cell), `${ct}.cell はセルの番地（例 K7）にしてください`)) return;
      addrs.push(c.cell);
      const unknown = (x) => !known.has(x) && !KARTE_CALC.includes(x);
      const unknownMsg = (x) => `${ct}：項目「${x}」は ${sh.form} の入力画面・ブックの列にありません（計算した値は ${KARTE_CALC.join('・')}）`;
      need(c.keep == null || typeof c.keep === 'boolean', `${ct}.keep は true か false にしてください`);
      if (c.keep) need(typeof c.fmt === 'string' && c.fmt.length > 0, `${ct}：keep（値を変えない）には fmt（表示形式）が必要です`);
      else {
        const ks = c.keys != null ? c.keys : [c.key];
        if (need(Array.isArray(ks) && ks.length > 0 && ks.every(isStr), `${ct}：key か keys（項目の名前）が必要です`)) ks.filter(unknown).forEach((x) => need(false, unknownMsg(x)));
      }
      if (c.fmt != null && need(typeof c.fmt === 'string' && c.fmt.length > 0, `${ct}.fmt は文字（Excel の表示形式）にしてください`))
        fmtKeys(c.fmt).filter(unknown).forEach((x) => need(false, unknownMsg(x)));
      need(c.join == null || typeof c.join === 'string', `${ct}.join は文字にしてください`);
      need(c.replaceFormula == null || typeof c.replaceFormula === 'boolean', `${ct}.replaceFormula は true か false にしてください`);
      if (c.boxes != null) {
        need(typeof c.boxes === 'string' && boxOptions(c.boxes).length > 0, `${ct}.boxes は「□無 □有」のような□の付いた文字にしてください`);
        need(c.match == null || KARTE_MATCH.includes(c.match), `${ct}.match は ${KARTE_MATCH.join('・')} のどれかです`);
        need(c.pattern == null, `${ct}：boxes と pattern は一緒に使えません`);
      }
      need(c.map == null || (isObj(c.map) && Object.values(c.map).every((v) => typeof v === 'string')), `${ct}.map は { "元の値": "読み替える値" } の形にしてください`);
      need(c.omit == null || (Array.isArray(c.omit) && c.omit.every((v) => typeof v === 'string')), `${ct}.omit は文字の並びにしてください`);
      if (c.pattern != null) {
        let ok = typeof c.pattern === 'string';
        if (ok)
          try {
            new RegExp(c.pattern);
          } catch {
            ok = false;
          }
        need(ok, `${ct}.pattern が正規表現として読めません`);
      }
    });
    if (isAddr(sh.markCell)) addrs.push(sh.markCell);
    need(new Set(addrs).size === addrs.length, `${at}.cells（と markCell）に同じ番地が2つあります`);
  });
}

// ---------- 値の作り方 ----------

// 表示形式の {項目} の名前
export const fmtKeys = (fmt) => [...String(fmt).matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);

// 表示形式の {項目} を記録の値で埋める。どれかが空なら null（その場合は様式の表示形式のまま）
//  値の中の「"」は表示形式を壊すので除く
export function fillFmt(fmt, rec) {
  if (!fmt) return null;
  let empty = false;
  const out = String(fmt).replace(/\{([^{}]+)\}/g, (_, k) => {
    const v = String(rec[k] ?? '').replace(/"/g, '').trim();
    if (!v) empty = true;
    return v;
  });
  return empty ? null : out;
}

// 「□無 □有」から選択肢の言葉と位置を取り出す。返す形：[{ word, at }]（at は□の位置）
export function boxOptions(boxes) {
  return [...String(boxes).matchAll(/[□■]([^□■\s　]+)/g)].map((m) => ({ word: m[1], at: m.index }));
}

// 空の形の□を、選んだものだけ■にする（full なら■の後ろを値の全文にする）
function fillBoxes(c, value) {
  const raw = String(value ?? '').trim();
  const v = c.map && raw in c.map ? c.map[raw] : raw;
  // 空の形は□だけにそろえる（設定に■が混ざっていても）
  const blank = c.boxes.replace(/■/g, '□');
  if (!v) return blank;
  const match = c.match || 'exact';
  const hit = boxOptions(blank).find(({ word }) => (match === 'first' ? v.startsWith(word) : match === 'contains' ? v.includes(word) : v === word));
  if (!hit) return blank;
  const shown = c.full ? v : hit.word;
  return blank.slice(0, hit.at) + '■' + shown + blank.slice(hit.at + 1 + hit.word.length);
}

const isNumText = (s) => /^-?\d+(\.\d+)?$/.test(s);

// 設定の1つのセルに書く値（文字か数。空なら ''）
export function karteValue(c, rec) {
  const get = (k) => {
    const v = rec[k];
    return v == null ? '' : typeof v === 'number' ? String(v) : String(v);
  };
  let v = c.keys ? (c.keys.every((k) => get(k).trim() === '') ? '' : c.keys.map(get).join(c.join ?? '')) : get(c.key);
  if (c.boxes != null) return fillBoxes(c, v);
  if (c.map && v.trim() in c.map) v = c.map[v.trim()];
  if (c.omit && c.omit.includes(v.trim())) return '';
  if (c.pattern != null) {
    const m = v.match(new RegExp(c.pattern));
    if (m) v = m[1] ?? m[0];
  }
  if (c.num) {
    const h = toHalf(v).trim();
    if (isNumText(h)) return Number(h);
  }
  return v;
}

