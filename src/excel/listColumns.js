// 一覧表形式の列とセルの文字（画面の「一覧表形式」と、入力内容の一覧の Excel で共通）
import { fullNotesOf } from '../core/noteMeasures.js';
import { toHalf } from '../core/text.js';

// 一覧表形式の列（[列のキー, 見出し]…）。一覧表と同じ並び（貼り付けたり見比べたりしやすいように）
//  台帳を読み込んだときの見出しの並び（ledgerInfo.columns）があれば、その並びと見出しの文字を使う。
//  なければ設定の列の並び（dbFormat.columns）で、ほかのシートの種類の場所の項目と、どの木も空の場所の項目は出さない
//  見出しは、計測に足した欄（extraFields）・「有」のとき入れる項目（details）・点検項目は設定の名前、ほかは下の表
export function columns(cfg, siteType, ledgerColumns, trees) {
  const f = cfg.dbFormat;
  const label = {
    [f.serialKey]: '通しNo.', treeNo: '樹木番号', parkCode: 'コード', parkName: '公園緑地名', routeNo: '路線番号', routeName: '路線名', drawingNo: '図面番号',
    place: '場所', region: '地域',
    date: '調査日', inspector: '調査者', species: '樹種', height: '樹高', girth: '幹周', heightRatio: '樹高/幹径', branchRatio: '枝長/枝径',
    vigor: cfg.vigorLabel, note: '特記事項', initialNeeded: cfg.initial.label, grade: cfg.gradeLabel, treat: '処置', photo: '写真の有無',
  };
  label.branchLen = '枝長(cm)';
  label.branchDia = '枝径(cm)';
  label.lat = '緯度';
  label.lng = '経度';
  cfg.checks.forEach((c) => (label[c.key] = c.label));
  (cfg.extraFields || []).forEach((x) => (label[x.key] = x.unit ? `${x.label}(${x.unit})` : x.label)); // 計測に足した欄
  cfg.details.forEach((d) => (label[d.field] = d.label)); // 「有」のとき追加で入れる項目
  cfg.rules.filter((r) => r.type === 'treatRequires').forEach((r) => (label[r.field] = r.label));
  const shows = (k) => k === f.serialKey || k === 'treeNo' || f.writeKeys.includes(k) || f.infoKeys.includes(k);
  if (ledgerColumns?.length) return ledgerColumns.filter((c) => shows(c.key)).map((c) => [c.key, c.header || label[c.key] || c.key]);
  const others = f.sheets.filter((sh) => sh.type !== siteType).flatMap((sh) => [sh.identify, sh.code]);
  // 通し番号は一覧表（台帳）の行の印。台帳の行の木が1本もなければ出さない（台帳を使わず現地で足した木だけの業務）
  const noLedger = !trees.some((t) => t.ledgerRow);
  return Object.keys(f.columns)
    .filter(shows)
    .filter((k) => !(noLedger && k === f.serialKey))
    .filter((k) => !others.includes(k))
    .filter((k) => !f.infoKeys.includes(k) || trees.some((t) => t[k]))
    .map((k) => [k, label[k] || k]);
}

// 表のセルに出す文字
// 一覧表形式の右端に足す列：特記事項（野帳の特記事項の全文。一覧表用の特記では寸法などが省かれるため）
export const FULL_NOTE = '特記事項（全文）';
export const fullNoteOf = (t, cfg) => (t.source === 'app' ? fullNotesOf(t, cfg) : '');

export function cellText(t, k, v, cfg) {
  const f = cfg.dbFormat;
  if (k === f.serialKey) return t.ledgerRow ? t.ledgerSerial || '' : (f.serialFor?.[t.status] ?? f.newSerial ?? '');
  if (k === 'treeNo') return toHalf(t.treeNo);
  if (f.infoKeys.includes(k)) return t[k] || '';
  if (k === 'date') return (t.source === 'ledger' ? t.ledgerDate : t.date || '').replace(/-/g, '/');
  if (k === 'inspector') return t.source === 'ledger' ? t.ledgerInspector : t.inspector;
  if (k === 'branchRatio' && v == null) return t.ledgerBranchRatio || '';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return v ?? '';
}

