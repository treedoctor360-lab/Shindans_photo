// テスト用の架空の台帳（実在の番号・地名は使わない）
import ExcelJS from 'exceljs';

// 架空の台帳を作る
//  公園シート：見出しの並びは設定と違う順・改行入り。2行目は凡例
//  道路シート：同じ番号 AB001 があるが、別の木として扱う
//  関係ないシート：取り込まない
export async function makeLedger() {
  const wb = new ExcelJS.Workbook();
  const park = wb.addWorksheet('公園');
  park.addRow(['連番', '公園コード', '公園名', '木の番号', '樹種', '調査日', '調査者', '樹高', '幹周', '樹高/幹径', '枝長/枝径', '①\n樹勢', '傾斜', '枯れ枝', '腐朽', 'キノコ', '特記', '詳しい診断\nの必要性', '健全度', '処置', '伐採理由', '写真']);
  park.addRow(['(凡例)', '', '', '番号を書く']);
  // 入力済み（日付・式・リッチテキスト・「有(…)」）
  park.addRow([1, 'K01', '架空公園', 'AB001', 'テストノキ', new Date(Date.UTC(2099, 3, 5)), '試験 一郎', 8.5, 0.5,
    { formula: 'ROUND((H3/(I3/3.14)),0)', result: 53 }, 12.345, '良', '無', '有(3本)', '無', '有(ツヨイタケ)',
    { richText: [{ text: '枝の偏りあり。' }, { text: '支柱は不要。', font: { bold: true } }] }, '〇', '', '枯れ枝剪定', '', '有']);
  // 未入力
  park.addRow([2, 'K01', '架空公園', 'ＡＢ００２', 'ミホンカエデ']);
  // 番号札なしで残っている木
  park.addRow(['残存', 'K02', '架空公園', 'AB003', '']);
  // 番号が重複した行（台帳の誤り。捨てずに別の木として取り込む）
  park.addRow([4, 'K09', '別の架空公園', 'AB001', '別の樹種']);
  // 番号が空の行（読まない）
  park.addRow([5, 'K01', '架空公園', '', 'テストノキ']);

  // 設定にない列（担当者のメモなど）。書き戻しでは触らない
  park.getCell('W1').value = 'メモ';
  park.getCell('W4').value = '残しておくメモ';

  const road = wb.addWorksheet('道路');
  road.addRow(['連番', '木の番号', '道路番号', '道路名', '場所', '樹種', '樹勢']);
  road.addRow(['凡例']);
  road.addRow([1, 'AB001', 'R1', '架空通り', '北側', 'カクウザクラ', '']);

  const other = wb.addWorksheet('集計');
  other.addRow(['木の番号', '本数']);
  other.addRow(['', '']);
  other.addRow(['AB999', 1]);

  return wb.xlsx.writeBuffer();
}
