// テスト用の架空の「前回の診断カルテ」（実在の番号・地名・様式の言葉は使わない）
//  1本1シート。見出しの文字は test/fixtures/sample-config.json の previous.karte に合わせる
//  結合セル・写真（小さな JPEG）・「有」と「無」の行・カルテでないシートを含む
import ExcelJS from 'exceljs';

// 8×8 の小さな JPEG
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooornPPP/9k=',
  'base64',
);

// 1本分のシートを作る
function addTree(wb, { no, code = 'K01', place = '架空公園', species = 'テストノキ', withPhoto = true }) {
  const ws = wb.addWorksheet(no);
  const set = (addr, v) => (ws.getCell(addr).value = v);
  set('A1', '前回の詳しい診断');
  set('H1', '調べた日：');
  set('I1', new Date(Date.UTC(2090, 8, 1)));
  set('K1', '調べた人：');
  set('L1', '試験 一郎(資格)・試験 二郎(資格)');
  set('A2', '基本');
  set('B2', '場所コード');
  set('C2', code);
  set('D2', place);
  set('F2', '木の番号');
  set('G2', no);
  set('J2', '全体の写真');
  set('B3', '木の種類');
  set('C3', species);
  // 結合セル（左上だけを読むこと）
  ws.mergeCells('C3:E3');
  set('B4', '植えた年');
  set('C4', 1990);
  set('E4', '手入れ');
  set('F4', '年に1回');
  // 数の基本情報（Excel の小数の誤差つき。単位はセルの書式なので値には入らない）
  set('B5', '高さ');
  set('C5', 12.300000000000001);

  // 弱点の表：部位・番号つきの項目・印・[ 判定 ]・詳細
  const rows = [
    [6, '枝', '①枯れた枝', '■無　□有', '', ''],
    [7, '', '②折れた枝', '□無　■有', 'C', '1本、地上約5m'],
    [9, '幹', '①うろ', '□無 ■有（大）', 'E', '地上0～1m、30×20cm'],
    [10, '', '②ひび', '■無　□有', '', ''],
    [12, '根', '①根の傷み', '□無 ■有（小）', 'D', '根元'],
  ];
  set('J5', '弱点の図');
  for (const [r, part, item, mark, grade, detail] of rows) {
    if (part) set(`A${r}`, part);
    set(`B${r}`, item);
    set(`C${r}`, mark);
    set(`D${r}`, '[');
    if (grade) set(`E${r}`, grade);
    set(`F${r}`, ']');
    if (detail) set(`G${r}`, detail);
  }
  ws.mergeCells('G9:I9');

  set('A15', '見た目の評価');
  set('E15', '飾り'); // 評価の欄から除く言葉
  set('B15', '生育');
  set('C15', 'B');
  set('B16', '危険度');
  set('C16', 'E');
  set('D16', 'うろ・根の傷み');
  set('A18', 'まとめ');
  set('B18', 'D');
  set('C18', '幹のうろが大きい。');

  if (withPhoto) {
    const id = wb.addImage({ buffer: TINY_JPEG, extension: 'jpeg' });
    ws.addImage(id, 'J3:L4'); // 全体の写真の下
    ws.addImage(id, 'J6:L8'); // 弱点の図の下
  }
  return ws;
}

// 「周りの様子」の種類のカルテ（1本1シート）
//  日付は Excel の通し番号（44482）、写真は同じ行に左右に並び、見出しは上の行。3枚目は写真のすぐ下に名前がある
function addPlace(wb, { no, code = 'K01', place = '架空公園' }) {
  const ws = wb.addWorksheet(`${no}-周り`);
  const set = (addr, v) => (ws.getCell(addr).value = v);
  set('A1', '周りの様子');
  set('A2', '調べた日：');
  set('B2', 44482);
  set('A3', '木の番号');
  set('B3', no);
  set('A4', '場所コード');
  set('B4', code);
  set('C4', place);
  set('A6', '配置の図');
  set('K6', '周りの写真');
  set('A20', 'まわり');
  set('B20', '人の通行');
  set('C20', '□無　■有');
  set('D20', '歩く人');
  set('B21', '建物');
  set('C21', '■無　□有');
  set('B22', '土地の使われ方');
  set('C22', '□畑　■住宅地');
  set('A30', '写真');
  set('D35', '根元の様子');
  const id = wb.addImage({ buffer: TINY_JPEG, extension: 'jpeg' });
  ws.addImage(id, 'A7:H15');
  ws.addImage(id, 'K7:R15');
  ws.addImage(id, 'D31:H34');
  return ws;
}

// 架空のカルテのファイル。trees：[{ no, code, place, species, withPhoto, kind }]（kind：'place' なら「周りの様子」）
export async function makeKarte(trees = [{ no: 'AB001' }, { no: 'AB002', species: 'ミホンカエデ', withPhoto: false }]) {
  const wb = new ExcelJS.Workbook();
  for (const t of trees) (t.kind === 'place' ? addPlace : addTree)(wb, t);
  wb.addWorksheet('一覧').addRow(['カルテではないシート']);
  return wb.xlsx.writeBuffer();
}
