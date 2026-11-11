// 一覧型の野帳（設定 listSheet）の検証。Excel を作る処理は src/excel/listSheet.js
//  設定を読み込むたびに使うので、Excel の部品（重い）を読み込まないよう、ここに分けて置く

export const PAPER = { A3: 8, A4: 9 }; // Excel の用紙の番号

// 設定 listSheet の検証（省略可）
export function validateListSheet(ls, cfg, need) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!need(isObj(ls), 'listSheet（一覧型の野帳）の形が違います')) return;
  need(ls.paper == null || ls.paper in PAPER, 'listSheet.paper は "A3" か "A4" にしてください');
  need(Number.isInteger(ls.rowsPerSheet) && ls.rowsPerSheet > 0 && ls.rowsPerSheet <= 200, 'listSheet.rowsPerSheet（1枚の行数）は 1〜200 の整数にしてください');
  if (!need(Array.isArray(ls.columns) && ls.columns.length >= 3, 'listSheet.columns（列）を3つ以上書いてください')) return;
  ls.columns.forEach((c, i) => {
    need(isObj(c) && typeof c.key === 'string' && typeof c.label === 'string', `listSheet.columns[${i}] は { key, label } にしてください`);
    need(c?.width == null || (typeof c.width === 'number' && c.width > 0), `listSheet.columns[${i}].width は正の数にしてください`);
    need(c?.align == null || ['left', 'center', 'right'].includes(c.align), `listSheet.columns[${i}].align は left・center・right のどれかにしてください`);
  });
  need(ls.columns[0]?.key === 'treeNo', 'listSheet.columns の最初の列は樹木番号（treeNo）にしてください');
  need(ls.columns.length >= 4 || !ls.header?.length, 'listSheet の列が少なすぎます');
  need(ls.header == null || (Array.isArray(ls.header) && ls.header.every((h) => isObj(h) && typeof h.key === 'string' && typeof h.label === 'string')), 'listSheet.header は [{ key, label }] にしてください');
  need((ls.header?.length || 0) * 5 + 4 <= ls.columns.length, 'listSheet.header が多すぎて、用紙の上に並びません（列の数を増やすか header を減らしてください）');
}
