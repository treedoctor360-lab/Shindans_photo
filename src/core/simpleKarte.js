// 簡易診断のカルテ（1本1シート。提出用）に書く値
//  どのセルに何を書くかは設定 karte（形は詳しい診断の initialSurvey.karte と同じ。src/core/karteCells.js）
//  書き出しは src/excel/karteExport.js の exportKarte（submit: true）
//
//  記録の項目：木の項目（樹木番号・樹種・点検項目・追加で入れる項目・場所の情報など）に、次の計算した値を足す
//    @girth        … 幹周（株立は係数を掛けた記録値）
//    @branchRatio  … 枝長/枝径（小数第2位まで。枯死・入力なしは空）
//    @dateSerial   … 調査日を Excel の日付の数にしたもの（様式の日付の表示形式で見せる）
//    @check:項目   … その点検項目の「有」のとき入れた項目の値と、部位・寸法（checks の measure）の文
//    @notes        … 特記事項（文字の欄の文と、点検項目に付けていない寸法の1行。行の頭の「・」は付けない）
//  寸法の文の形は karte.measureLine（{text}・{place}・{kind}。既定「{text} {place}」）
import { branchRatioRaw, girthOf } from './calc.js';
import { isMeasuresV2, measureKinds, measuresWithLines, measureText, measurePlaces, fullNotesOf } from './noteMeasures.js';
import { blankTree, isLocked } from './tree.js';

export const SIMPLE_KARTE_CALC = ['@girth', '@branchRatio', '@dateSerial', '@notes'];
const checkKey = (key) => `@check:${key}`;
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
  const place = measurePlaces(m.kind, cfg).length ? m.place || '' : '';
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
    if (locked && !c.always) {
      rec[checkKey(c.key)] = '';
      continue;
    }
    const details = (cfg.details || []).filter((d) => d.when.field === c.key && tree[c.key] === d.when.eq).map((d) => str(tree[d.field]));
    const measures = ms.filter((m) => kinds.includes(m.kind)).map((m) => karteMeasure(m, cfg));
    rec[checkKey(c.key)] = [...details, ...measures].filter(Boolean).join('／');
  }
  // 特記事項：文字の欄の文＋点検項目に付けていない寸法の1行
  const text = isMeasuresV2(tree) ? String(tree.notes || '') : String(fullNotesOf(tree, cfg) || '');
  const others = isMeasuresV2(tree) ? [...new Set(measuresWithLines(tree, cfg).filter((m) => !linked.has(m.kind)).map((m) => m.line))] : [];
  rec['@notes'] = [...text.split('\n'), ...others]
    .map((l) => str(l).replace(/^・\s*/, ''))
    .filter(Boolean)
    .join('　');
  return rec;
}
