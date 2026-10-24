// テスト用の架空のカルテの様式のブック（確認用カルテの出力のテスト用。実在の様式・地名は使わない）
//
//  管理：関係ないシート（写さない）
//  公園_カルテ：詳しい診断の様式。見出しの文字・結合・入力規則・式（樹高と幹周から計算）が入っている
//  公園_環境カルテ：周りの環境の様式
import ExcelJS from 'exceljs';

export async function makeKarteTemplate({ withFormulaTarget = false, title = '詳しい診断カルテ' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('管理').getCell('A1').value = '関係ないシート';

  const a = wb.addWorksheet('公園_カルテ');
  a.getCell('A1').value = title;
  a.mergeCells('A1:B1');
  a.getCell('D1').value = '調査日';
  a.getCell('A2').value = '樹木番号';
  a.getCell('A3').value = '樹高';
  a.getCell('A4').value = '幹周';
  a.getCell('A5').value = '樹高／幹径';
  a.getCell('C5').value = { formula: 'IFERROR(ROUND(C3/(C4/3.14),0),0)', result: 0 };
  a.getCell('A6').value = '不自然な傾斜';
  a.getCell('C6').value = '■無　□有'; // 様式の初めの値（書き込みで置き換わる）
  a.getCell('C6').dataValidation = { type: 'list', allowBlank: true, formulae: ['"■無 □有,□無 ■有"'] };
  a.getCell('E6').value = '□安全　□危険';
  a.getCell('A7').value = '枯れ枝';
  a.getCell('C7').value = '■無 □有';
  a.getCell('A8').value = '総合評価';
  a.getCell('A9').value = 'メモ欄';
  a.getCell('C9').value = '様式のまま残る文字';
  a.getCell('C2').font = { bold: true };
  // 欄の幅・高さ（長い文を枠に収めるテスト用）。詳細の欄 E7 は結合して2行分の高さ
  a.getColumn(3).width = 18;
  a.getColumn(5).width = 30;
  a.getColumn(6).width = 16;
  a.mergeCells('E7:H7');
  a.getRow(7).height = 30;
  if (withFormulaTarget) a.getCell('C8').value = { formula: '1+1', result: 2 };

  const e = wb.addWorksheet('公園_環境カルテ');
  e.getCell('A1').value = '周りの環境カルテ';
  e.getCell('A2').value = '樹木番号';
  e.getCell('A3').value = '気象の影響';
  e.getCell('C3').value = '■無 □有';
  e.getCell('A4').value = '支柱の損傷';
  e.getCell('C4').value = '■無 □有';
  e.mergeCells('E4:G4');
  return wb.xlsx.writeBuffer();
}
