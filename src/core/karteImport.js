// 記入済みの簡易診断カルテ（1本1シート。Excel に直接打ち込んだもの）から木を作る
//  カルテの形は設定 karte（書き出しと同じ cells の定義）を逆にたどって読む：
//    □■の欄・読み替え（map）の欄 … 選択肢を1つずつ書き出しの形にして、セルの文字と同じになるものを選ぶ
//    数の欄 … 数（「10.0ｍ」のように単位が付いていても数だけ）
//    @dateSerial … 調査日（Excel の日付の数・日付の文字）
//    @girth … 幹周（1本の幹として）
//    @check:項目 … その項目の部位・寸法の文。数字を含む文で、項目に寸法（measure）があれば寸法の1行（文は手で直した文としてそのまま持つ）、
//                  そうでなければ「有」のとき入れる項目（details）の値。どちらもなければ寸法の1行
//    @notes・keys の欄 … 特記事項（「。」で区切って1文ずつの行に）
//    @photoCaption番号 … 写真の見出し（写真を貼るときに使う）
//    計算した値で、木の入力から作り直せないもの（@branchRatio など）… 木の karteKeep に残し、カルテを出し直すときもその値を書く
//  読めなかった値（選択肢にない □■ の付き方など）は、入力表と同じく木の entryBad に残して入力中のままにする。
//  ここは Excel に依存しない（シートの読み取りは src/excel/xlsxRead.js）。
import { toHalf } from './text.js';
import { blankTree } from './tree.js';
import { groupKey } from './groups.js';
import { karteValue } from './karteCells.js';
import { appendNoteLine } from './noteMeasures.js';

const str = (v) => String(v ?? '').trim();
const half = (v) => toHalf(str(v));
const squash = (s) => String(s ?? '').replace(/[\s　]/g, '');

// 簡易診断のカルテの様式の定義（form: simple）
export const simpleKarteSheetSpec = (cfg) => (cfg.karte?.sheets || []).find((s) => s.form === 'simple') || null;

// セルの値を文字に（数は小数の誤差を除く）
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

// 数の欄：「10.0ｍ」「1.00m」「38倍」→ "10.0"・"1.00"・"38"。数がなければ ''
function numText(v) {
  if (typeof v === 'number') return cellText(v);
  const m = half(v).match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

// 日付：Excel の日付の数（例 46336）・「2026/11/10」・「2026-11-10」・「2026年11月10日」→ "2026-11-10"
export function karteDate(v) {
  const pad = (n) => String(n).padStart(2, '0');
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = half(v).match(/(\d{4})\s*[/\-年.]\s*(\d{1,2})\s*[/\-月.]\s*(\d{1,2})/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : '';
}

// 特記事項の文：「。」で区切って1文ずつに（区切りの空白は除く）
function sentences(text) {
  return String(text || '')
    .split(/\r?\n/)
    .flatMap((l) => l.split(/(?<=。)/))
    .map((l) => l.replace(/^[\s　・]+|[\s　]+$/g, ''))
    .filter(Boolean);
}

// 項目の呼び名（知らせに出す）
function labelOf(key, cfg) {
  if (key === 'vigor') return cfg.vigorLabel || '樹勢';
  if (key === 'initialNeeded') return cfg.initial?.label || '健全度調査';
  return (cfg.checks || []).find((c) => c.key === key)?.label || key;
}

// 選べる値の一覧（点検項目・樹勢・要否など）
function optionsOf(key, cfg) {
  if (cfg.options?.[key]) return cfg.options[key];
  if (key === 'initialNeeded' && cfg.initial) return [cfg.initial.yes, cfg.initial.no].filter(Boolean);
  return null;
}

// □■の欄・読み替えの欄を逆にたどる：書き出したときにセルと同じ文字になる選択肢。返す形：{ value } か { bad: true }
function readChoiceCell(c, raw, cfg) {
  const opts = optionsOf(c.key, cfg);
  if (!opts) return null;
  const target = squash(raw);
  const blankText = squash(karteValue(c, { [c.key]: '' }));
  if (!target || target === blankText) return { value: '' }; // 何も付いていない
  const hits = opts.filter((o) => squash(karteValue(c, { [c.key]: o })) === target);
  if (!hits.length) return { bad: true };
  // 2つ以上が同じ書き方になるとき（例 読み替えで「小」も「有」も「■有」）は、■の後ろの言葉と同じ値を選ぶ
  const word = target.match(/■([^□■]+)/)?.[1] || '';
  return { value: hits.find((o) => squash(o) === word) ?? hits[0] };
}

// 1つの点検項目の欄（@check:項目）の文を、寸法の1行か「有」のとき入れる項目にする
function readCheckText(key, text, cfg, t) {
  const c = (cfg.checks || []).find((x) => x.key === key);
  const kinds = c?.measure?.kinds || [];
  const detail = (cfg.details || []).find((d) => d.when?.field === key);
  const parts = String(text)
    .split(cfg.karte?.checkJoin ?? '／')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (kinds.length && (/\d/.test(toHalf(p)) || !detail)) {
      // 寸法の1行（数字は取り出さず、カルテの文をそのまま「手で直した文」として持つ）
      t.measures = [...(t.measures || []), { kind: kinds[0], place: '', values: {}, text: p, textAuto: '' }];
    } else if (detail) {
      t[detail.field] = t[detail.field] ? `${t[detail.field]}、${p}` : p;
    } else {
      t.notes = appendNoteLine(t.notes || '', p);
    }
  }
}

// 様式に印字された文字のままか（何も書いていない欄）：様式のままのシートと同じ文字か、数字がなく「H=」「m」「cm」「/」だけ
function isPrinted(text, printedText) {
  const t = squash(toHalf(text));
  if (!t) return true;
  if (printedText != null && t === squash(toHalf(cellText(printedText)))) return true;
  return !/\d/.test(t) && /^[Hh=mc/]+$/.test(t);
}

// シートが簡易診断のカルテか（様式の確かめる文字 checks が合うか）
export function isKarteSheet(cells, cfg) {
  const spec = simpleKarteSheetSpec(cfg);
  if (!spec) return false;
  return Object.entries(spec.checks || {}).every(([addr, word]) => squash(cells[addr]).includes(squash(word)));
}

// 1枚のシートの値を読む。返す形：{ treeNo, info, fields（木の項目）, captions: { 番号: 見出し }, bad: { 項目: セルの文字 } }
//  printed：様式のままのシート（同じブックにあれば）のセル。印字された文字（例「H=　　m」）を、書いていない欄として読む
export function readKarteCells(cells, cfg, printed = {}) {
  const spec = simpleKarteSheetSpec(cfg);
  const infoKeys = new Set(cfg.dbFormat?.infoKeys || []);
  const out = { treeNo: '', info: {}, fields: { measuresV: 2, measures: [] }, captions: {}, bad: {}, keep: {} };
  const t = out.fields;
  const notes = [];
  for (const c of spec?.cells || []) {
    const raw = cells[c.cell];
    const text = str(cellText(raw));
    if (c.keys) {
      // いくつかの項目をつないだ欄（例 植栽環境の内容＋特記事項）は特記事項に
      if (!c.keepIfEmpty || text) notes.push(...sentences(text));
      continue;
    }
    const key = c.key;
    if ((c.keepIfEmpty || String(key).startsWith('@check:')) && isPrinted(text, printed[c.cell])) continue; // 様式の印字のまま（何も書いていない）
    if (key === 'treeNo') out.treeNo = half(text);
    else if (key === '@dateSerial') t.date = karteDate(raw);
    else if (key === '@girth') t.girths = [numText(raw)];
    else if (key === '@notes') notes.push(...sentences(text));
    else if (key.startsWith('@check:')) {
      if (text) readCheckText(key.slice(7), text, cfg, t);
    } else if (/^@photoCaption\d+$/.test(key)) {
      if (text) out.captions[Number(key.slice(13))] = text;
    } else if (key.startsWith('@')) {
      if (text) out.keep[key] = typeof raw === 'number' ? raw : numText(raw) || text; // 作り直せない計算の値はそのまま残す
    } else if (c.boxes != null || c.map) {
      const r = readChoiceCell(c, text, cfg);
      if (r == null) t[key] = text; // 選択肢のない項目の読み替え
      else if (r.bad) out.bad[key] = text;
      else if (r.value) t[key] = r.value;
    } else if (infoKeys.has(key)) out.info[key] = half(text);
    else if (c.num) t[key] = numText(raw);
    else t[key] = text;
  }
  for (const n of notes) t.notes = appendNoteLine(t.notes || '', n);
  return out;
}

// まとまり（路線）の候補：路線の一覧（presets）と、今あるまとまりのうち、カルテの路線番号などに合うもの
//  read：readKarteCells の結果の一覧（1つのファイルの木）。返す形：{ choices: [{ key, label, info }], pick: 初めに選んでおく候補の key }
export function karteGroupChoices(state, cfg, read) {
  const ag = cfg.addGroups;
  if (!ag) return { choices: [], pick: '' };
  const sheet = cfg.dbFormat.sheets.find((x) => x.type === ag.siteType);
  const code = sheet?.code;
  const typed = read.find((r) => Object.values(r.info).some(Boolean))?.info || {};
  const make = (values) => {
    const info = { siteType: ag.siteType };
    for (const f of ag.fields) info[f.key] = half(values?.[f.key]);
    return info;
  };
  const choices = [];
  const add = (info, label) => {
    const key = groupKey(info, cfg);
    if (!info[sheet.identify] || choices.some((x) => x.key === key)) return;
    choices.push({ key, label, info });
  };
  // 路線の一覧から（路線番号が合うもの）
  const presets = (ag.presets || []).filter((p) => !code || !typed[code] || half(p.values?.[code]) === typed[code]);
  for (const p of presets) add(make(p.values), p.label);
  // 今あるまとまりから（路線番号が合うもの）
  for (const t of state.trees) {
    if (t.deleted || t.siteType !== ag.siteType || (code && typed[code] && half(t[code]) !== typed[code])) continue;
    add(make(t), [t[sheet.identify], ...ag.fields.filter((f) => f.key !== sheet.identify).map((f) => t[f.key])].filter(Boolean).join('　'));
  }
  // カルテに路線名まで書いてあれば、その値のまま（一覧にない路線）
  const own = make(typed);
  if (own[sheet.identify]) add(own, `カルテに書かれた路線：${ag.fields.map((f) => own[f.key]).filter(Boolean).join('　')}`);
  // 1つに決まらないときは、樹種がいちばん多く合うもの
  const species = read.map((r) => r.fields.species).filter(Boolean);
  const score = (ch) => {
    const p = (ag.presets || []).find((x) => groupKey(make(x.values), cfg) === ch.key);
    return p?.tree?.species ? species.filter((s) => s === p.tree.species).length : 0;
  };
  const sorted = [...choices].sort((a, b) => score(b) - score(a));
  return { choices, pick: choices.length === 1 ? choices[0].key : sorted[0] && score(sorted[0]) > 0 ? sorted[0].key : '' };
}

// 読んだカルテ（1つのまとまり）から木を作る
//  read：[{ sheet: シート名, ...readKarteCells の結果 }]、info：まとまりの情報（karteGroupChoices の候補の info）
//  place：木を並びに入れる関数 (trees, 木) => trees（番号の順に入れるのは src/store/actions.js の importKarte）
//  返す形：{ state, stats: { added: [{ sheet, treeNo, key（木の鍵 simpleKey 用の木）, tree }], skipped: [すでにある番号], check: [{ sheet, treeNo, why }] } }
export function importKarteSheets(state, cfg, read, info, { file = '', now = Date.now(), place } = {}) {
  const stats = { added: [], skipped: [], check: [] };
  let trees = [...state.trees];
  const key = groupKey(info, cfg);
  let seq = 0;
  for (const r of read) {
    const treeNo = r.treeNo;
    if (!treeNo) continue;
    if (trees.some((t) => groupKey(t, cfg) === key && !t.deleted && half(t.treeNo) === treeNo)) {
      stats.skipped.push(`${r.sheet}`);
      continue;
    }
    seq += 1;
    const stamp = now + seq;
    let t = blankTree({ id: `new:${stamp}`, uid: `${state.server?.deviceId || 'dev'}-${stamp.toString(36)}`, status: cfg.newTreeStatus ?? '', ...info, ...r.fields, treeNo });
    t.fromKarte = `${file} ${r.sheet}`.trim(); // 記入済みカルテから読み込んだ木（どのファイルのどのシートか）
    if (Object.keys(r.keep).length) t.karteKeep = r.keep;
    const why = Object.entries(r.bad).map(([k, v]) => `${labelOf(k, cfg)}「${v}」を読めません`);
    if (why.length) {
      t = { ...t, entryBad: { ...r.bad }, fromEntry: true }; // 入力表で止まった木と同じ扱い（一覧の「入力表で止まった木」で探せる）
      stats.check.push({ sheet: r.sheet, treeNo, why });
    } else {
      t = { ...t, done: true, sent: false, source: 'app', updatedAt: new Date(stamp).toISOString() };
    }
    trees = place ? place(trees, t) : [...trees, t];
    stats.added.push({ sheet: r.sheet, treeNo, tree: t });
  }
  return { state: { ...state, trees }, stats };
}

// 貼ってある写真を、設定 karte.photos の枠に当てる
//  images：[{ from: { col, row }, to: { col, row }, … }]（1から数える）、slots：karte.photos.slots（range は "Q4:V16" の形。rangeOf で数にしたもの r を渡す）
//  写真の真ん中が入っている枠に当てる。どの枠にも入らない写真・同じ枠の2枚目からは slot を null にする（その木の写真として入れるが、貼る枠は選ばない）
//  返す形：[{ image, slot（枠の key か null） }]（並びは枠の順、そのあと枠のない写真）
export function karteImageSlots(images, slots) {
  const used = new Set();
  const out = images.map((image) => {
    const cx = (image.from.col + image.to.col) / 2;
    const cy = (image.from.row + image.to.row) / 2;
    const s = slots.find((x) => x.r && cx >= x.r.c1 && cx <= x.r.c2 + 1 && cy >= x.r.r1 && cy <= x.r.r2 + 1 && !used.has(x.key));
    if (s) used.add(s.key);
    return { image, slot: s ? s.key : null };
  });
  const order = (x) => (x.slot ? slots.findIndex((s) => s.key === x.slot) : slots.length);
  return out.sort((a, b) => order(a) - order(b));
}
