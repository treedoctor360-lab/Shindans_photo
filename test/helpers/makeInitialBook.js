// テスト用の架空のデータ入力用ブック（詳しい診断用。実在の番号・地名は使わない）
//
//  公園_詳しい診断：見出し4行（階層つき）、5行目からデータ。A列に通し番号が先に入っている。
//                  弱点は「有無・判定・詳細」の3列ひと組（2列目・3列目の見出しは空）。
//                  入力済みは2行（同じ番号 AB009 が2行ある）
//  公園_周りの環境：見出し3行（結合あり）、4行目からデータ。C列に「無」が先に入っている
//  関係ないシート：読まない
import ExcelJS from 'exceljs';

// strict：選択肢にない値を入れると誤りを出す入力規則（Excel の「エラーメッセージを表示する」）。false は候補を出すだけ
const list = (values, strict = true) => ({ type: 'list', allowBlank: true, showErrorMessage: strict, formulae: [`"${values.join(',')}"`] });

//  withAB001：台帳の AB001（K01）も手で入力済みにする（入力画面でブックの内容を見るテスト用）
export async function makeInitialBook({ envHeader = '気象の影響', withAB001 = false } = {}) {
  const wb = new ExcelJS.Workbook();

  const a = wb.addWorksheet('公園_詳しい診断');
  // 「調査日」は B〜D の3列にまたがる体裁（結合はしない。2列目以降の見出しは空）
  a.getCell('B2').value = '調査日';
  a.getCell('E2').value = '調査者';
  a.getCell('F2').value = '基本情報';
  a.getCell('A4').value = '通し番号';
  a.getCell('B4').value = '年';
  a.getCell('C4').value = '月';
  a.getCell('D4').value = '日';
  a.getCell('F4').value = '樹木番号';
  a.getCell('G4').value = 'コード';
  a.getCell('H4').value = '樹種名';
  a.getCell('I2').value = '地上部の弱点';
  a.getCell('I3').value = '枝';
  a.getCell('I4').value = '枯れ枝';
  for (let r = 5; r <= 9; r++) {
    a.getCell(`A${r}`).value = r - 4; // 通し番号は先に入っている
    a.getCell(`I${r}`).dataValidation = list(['無', '有（小）', '有（大）']);
    a.getCell(`O${r}`).dataValidation = list(['40≦'], false); // 候補を出すだけ（ほかの値も入れられる）
  }
  [
    ['B5', 2099], ['C5', 4], ['D5', 5], ['E5', '試験 一郎(資格)'], ['F5', 'AB009'], ['G5', 'K01'], ['H5', 'テストノキ'], ['I5', '有（小）'], ['K5', '1本、地上2m'],
    ['B6', 2099], ['C6', 4], ['D6', 6], ['E6', '試験 一郎(資格)'], ['F6', 'ＡＢ００９'], ['G6', 'K09'], ['H6', '別の樹種'], ['I6', '無'],
  ].forEach(([addr, v]) => (a.getCell(addr).value = v));
  if (withAB001)
    [['B7', 2099], ['C7', 4], ['D7', 7], ['E7', '試験 三郎(資格)'], ['F7', 'AB001'], ['G7', 'K01'], ['H7', 'テストノキ'], ['I7', '有（大）'], ['K7', '2本、地上5m'], ['M7', 9.5]].forEach(
      ([addr, v]) => (a.getCell(addr).value = v),
    );

  const e = wb.addWorksheet('公園_周りの環境');
  e.getCell('A1').value = '樹木番号';
  e.mergeCells('A1:A3'); // 縦に結合
  e.getCell('B1').value = 'コード';
  e.mergeCells('B1:B3');
  e.getCell('C1').value = '生育条件';
  e.mergeCells('C1:D1'); // 横に結合（D列の見出しには数えない）
  e.getCell('C2').value = '保護材';
  e.getCell('C3').value = envHeader;
  e.getCell('D3').value = '支柱の損傷';
  for (let r = 4; r <= 7; r++) {
    e.getCell(`C${r}`).value = '無'; // 先に入っている
    e.getCell(`D${r}`).dataValidation = list(['支柱なし', '無', '有']);
  }
  e.getCell('A4').value = 'AB009';
  if (withAB001) [['A5', 'AB001'], ['B5', 'K01'], ['D5', '有']].forEach(([addr, v]) => (e.getCell(addr).value = v));
  e.getCell('B4').value = 'K01';
  e.getCell('D4').value = '支柱なし';

  wb.addWorksheet('メモ').getCell('A1').value = '関係ないシート';
  return wb.xlsx.writeBuffer();
}
