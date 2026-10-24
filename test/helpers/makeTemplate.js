// テスト用の架空の野帳の原本（実在の様式は使わない）
//  1行目：見出し（名前・調査者・日付） 2〜3行目：項目名 4行目から：1本2行 × 3本
//  選択肢の欄には、紙の野帳として使うための選択肢の文字が入っている
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export async function makeTemplate({ sheetId } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('原本');
  const widths = [14, 6, 6, 6, 5, 6, 7, 5, 16, 6, 6, 12, 10, 5];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  [30, 24, 24, 40, 60, 40, 60, 40, 60].forEach((h, i) => (ws.getRow(i + 1).height = h));
  ws.getCell('A1').value = '名前：';
  ws.getCell('G1').value = '調査者';
  ws.getCell('K1').value = '　年　月　日';
  const heads = ['番号', '樹高', '幹周', '枝', '樹勢', '枯れ枝', 'キノコ', '傾斜', '特記', '詳しい診断', '健全度', '処置', '伐採理由', '写真'];
  heads.forEach((h, i) => {
    ws.getCell(2, i + 1).value = h;
    ws.mergeCells(2, i + 1, 3, i + 1);
  });
  const opts = { E: '良\n並\n枯', F: '無\n少\n有(　本)', G: '無\n有(　　)', H: '無\n有', K: 'A\nB\nC\nD', N: '無\n有' };
  const thin = { style: 'thin' }; // 色なしの罫線（ExcelJS で色「自動」が落ちる問題の確認用）
  for (let k = 0; k < 3; k++) {
    const r = 4 + k * 2;
    for (let c = 1; c <= 14; c++) {
      if (c > 1) ws.mergeCells(r, c, r + 1, c);
      for (const rr of [r, r + 1]) ws.getCell(rr, c).border = { top: thin, left: thin, bottom: thin, right: thin };
    }
    for (const [col, text] of Object.entries(opts)) ws.getCell(`${col}${r}`).value = text;
  }
  let buf = await wb.xlsx.writeBuffer();
  if (sheetId) {
    // シートの番号（sheetId）と中のファイル名をずらした原本を作る（並び順と sheetN.xml が一致しない状態の再現）
    const zip = await JSZip.loadAsync(buf);
    const x = await zip.file('xl/workbook.xml').async('string');
    zip.file('xl/workbook.xml', x.replace(/sheetId="1"/, `sheetId="${sheetId}"`));
    buf = await zip.generateAsync({ type: 'uint8array' });
  }
  return buf;
}
