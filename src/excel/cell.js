// ExcelJS のセルの値を、普通の値（文字・数・日付）にする道具

// 式は計算結果、リッチテキスト（一部だけ太字など）は文字だけ、エラーは空欄にする
export function cellValue(cell) {
  let v = cell?.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((x) => x.text).join('');
    else if ('text' in v) v = v.text;
    else v = '';
  }
  if (v && typeof v === 'object' && !(v instanceof Date)) v = '';
  return v ?? '';
}

// 見出しの比較用：空白・改行を取り除く
export const normalizeHeader = (s) => String(s ?? '').replace(/[\s　]/g, '');

// Excel の日付 → "2099-04-05"
// Excel の日付には時差の情報がなく、ExcelJS は世界標準時の0時として読むので、UTC で取り出す
export function ymdOfCell(v) {
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  const m = String(v ?? '').match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
