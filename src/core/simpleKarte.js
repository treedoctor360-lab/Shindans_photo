// 簡易診断のカルテ（1本1シート。提出用）に書く値
//  どのセルに何を書くかは設定 karte（形は詳しい診断の initialSurvey.karte と同じ。src/core/karteCells.js）
//  書き出しは src/excel/karteExport.js の exportKarte（submit: true）
//
//  記録の項目：木の項目（樹木番号・樹種・点検項目・追加で入れる項目・場所の情報など）に、次の計算した値を足す
//    @girth        … 幹周（株立は係数を掛けた記録値）
//    @branchRatio  … 枝長/枝径（小数第2位まで。枯死・入力なしは空）
//    @dateSerial   … 調査日を Excel の日付の数にしたもの（様式の日付の表示形式で見せる）
//    @check:項目   … その点検項目の部位・寸法（checks の measure）の文と、「有」のとき入れた項目の値（この順）
//    @notes        … 特記事項（文字の欄の文と、点検項目に付けていない寸法の1行。行の頭の「・」は付けない）
//    @photoCaption1〜 … 写真の見出し（設定 karte.photos の枠の caption の番号。写真を選んだ木だけ）
//  寸法の文の形は karte.measureLine（{text}・{place}・{kind}。既定「{text} {place}」。noteMeasures.hidePlaces の部位は書かない）
//  1つの項目に2つ以上あるときのつなぎは karte.checkJoin（既定「／」）、特記事項の行のつなぎは karte.notesJoin（既定は全角の空白）
import { branchRatioRaw, girthOf } from './calc.js';
import { isMeasuresV2, measureKinds, measuresWithLines, measureText, measurePlaces, fullNotesOf, shownPlace } from './noteMeasures.js';
import { blankTree, isFelled, isLocked } from './tree.js';

export const SIMPLE_KARTE_CALC = ['@girth', '@branchRatio', '@dateSerial', '@notes'];
const checkKey = (key) => `@check:${key}`;
// 写真の見出しの項目の名前（i：karte.photos の枠の caption の番号。出力のときに OutView が記録に足す）
export const photoCaptionKey = (i) => `@photoCaption${i}`;
const str = (v) => String(v ?? '').trim();
const round2 = (x) => Math.round(x * 100) / 100;

// 設定 karte の cells に書ける項目の名前
export function simpleKarteKeys(cfg) {
  const keys = new Set(Object.keys(blankTree()));
  for (const c of cfg.checks || []) {
    keys.add(c.key);
    keys.add(checkKey(c.key));
  }
  for (const d of cfg.details || []) keys.add(d.field);
  for (const f of cfg.extraFields || []) keys.add(f.key);
  for (const k of cfg.dbFormat?.infoKeys || []) keys.add(k);
  for (const k of SIMPLE_KARTE_CALC) keys.add(k);
  for (let i = 1; i <= 9; i++) keys.add(photoCaptionKey(i)); // 写真の見出し（karte.photos の枠の caption の番号）
  return keys;
}

// 調査日 "2099-04-05" → Excel の日付の数（1900年からの日数）
export function excelDate(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000;
}

// 寸法1件の文（カルテの形）
function karteMeasure(m, cfg) {
  const text = measureText(cfg, m.kind, m.values);
  if (!text) return '';
  const kind = measureKinds(cfg).find((k) => k.key === m.kind);
  const place = measurePlaces(m.kind, cfg).length ? shownPlace(cfg, m.place) : ''; // hidePlaces の部位（例 幹）は書かない
  const fmt = cfg.karte?.measureLine ?? '{text} {place}';
  return fmt
    .replace('{text}', text)
    .replace('{place}', place)
    .replace('{kind}', kind?.label || '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 1本の木から、カルテに書く記録を作る
export function simpleKarteRecord(tree, cfg) {
  const locked = isLocked(tree, cfg);
  const rec = { ...tree };
  const g = girthOf(tree, cfg);
  rec['@girth'] = g == null ? '' : g;
  const r = locked ? null : branchRatioRaw(tree);
  rec['@branchRatio'] = r == null ? '' : round2(r);
  rec['@dateSerial'] = excelDate(tree.date);

  const ms = isMeasuresV2(tree) ? (tree.measures || []).filter((m) => m && m.kind) : [];
  const linked = new Set();
  for (const c of cfg.checks || []) {
    const kinds = c.measure?.kinds || [];
    kinds.forEach((k) => linked.add(k));
    if ((locked && !c.always) || isFelled(tree, cfg)) {
      rec[checkKey(c.key)] = '';
      continue;
    }
    const details = (cfg.details || []).filter((d) => d.when.field === c.key && tree[c.key] === d.when.eq).map((d) => str(tree[d.field]));
    const measures = ms.filter((m) => kinds.includes(m.kind)).map((m) => karteMeasure(m, cfg));
    // 部位・寸法を先に、そのあとに「有」のとき入れた項目（例 子実体の種類）。カルテの「部位・大きさ」「部位・種類」の順
    rec[checkKey(c.key)] = [...measures, ...details].filter(Boolean).join(cfg.karte?.checkJoin ?? '／');
  }
  // 特記事項：文字の欄の文＋点検項目に付けていない寸法の1行
  const text = isMeasuresV2(tree) ? String(tree.notes || '') : String(fullNotesOf(tree, cfg) || '');
  const others = isMeasuresV2(tree) ? [...new Set(measuresWithLines(tree, cfg).filter((m) => !linked.has(m.kind)).map((m) => m.line))] : [];
  rec['@notes'] = [...text.split('\n'), ...others]
    .map((l) => str(l).replace(/^・\s*/, ''))
    .filter(Boolean)
    .join(cfg.karte?.notesJoin ?? '　'); // 文（。で終わる）を続けるなら notesJoin を '' に
  return rec;
}
