// 一覧表形式の列とセルの文字（画面の「一覧表形式」と、入力内容の一覧の Excel で共通）
import { fullNotesOf } from '../core/noteMeasures.js';
import { toHalf } from '../core/text.js';

// 一覧表形式の列（[列のキー, 見出し]…）。一覧表と同じ並び（貼り付けたり見比べたりしやすいように）
//  台帳を読み込んだときの見出しの並び（ledgerInfo.columns）があれば、その並びと見出しの文字を使う。
//  なければ設定の列の並び（dbFormat.columns）で、ほかのシートの種類の場所の項目と、どの木も空の場所の項目は出さない
export function columns(cfg, siteType, ledgerColumns, trees) {
  const f = cfg.dbFormat;
  const label = {
    [f.serialKey]: '通しNo.', treeNo: '樹木番号', parkCode: 'コード', parkName: '公園緑地名', routeNo: '路線番号', routeName: '路線名', drawingNo: '図面番号',
    place: '場所', region: '地域',
    date: '調査日', inspector: '調査者', species: '樹種', height: '樹高', girth: '幹周', heightRatio: '樹高/幹径', branchRatio: '枝長/枝径',
    vigor: cfg.vigorLabel, note: '特記事項', initialNeeded: cfg.initial.label, grade: cfg.gradeLabel, treat: '処置', photo: '写真の有無',
  };
  cfg.checks.forEach((c) => (label[c.key] = c.label));
  cfg.rules.filter((r) => r.type === 'treatRequires').forEach((r) => (label[r.field] = r.label));
  const shows = (k) => k === f.serialKey || k === 'treeNo' || f.writeKeys.includes(k) || f.infoKeys.includes(k);
  if (ledgerColumns?.length) return ledgerColumns.filter((c) => shows(c.key)).map((c) => [c.key, c.header || label[c.key] || c.key]);
  const others = f.sheets.filter((sh) => sh.type !== siteType).flatMap((sh) => [sh.identify, sh.code]);
  return Object.keys(f.columns)
    .filter(shows)
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

