// テスト用の架空の簡易診断カルテの様式と設定（実在の様式・地名は使わない）
import ExcelJS from 'exceljs';

export const LEAN = '□無　□有';
export const BOX = '□無  □有';
// 架空の様式：見出し・□の選択肢・結合した詳細の欄・日付の欄。選択肢の一覧のシート（そのまま写す）
export async function makeSimpleKarteTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('説明').getCell('A1').value = '関係ないシート';
  const s = wb.addWorksheet('架空カルテ様式');
  s.getCell('A1').value = '架空の簡易カルテ';
  s.getCell('A2').value = '調査日';
  s.getCell('C2').numFmt = 'yyyy/m/d';
  s.getCell('A3').value = '樹木番号';
  s.getCell('A4').value = '樹種';
  s.getCell('A5').value = '幹周';
  s.getCell('A6').value = '枝長/枝径';
  s.getCell('A7').value = '傾斜';
  s.getCell('C7').value = LEAN;
  s.getCell('A8').value = '腐朽';
  s.getCell('C8').value = BOX;
  s.mergeCells('E8:F8');
  s.getColumn(5).width = 10;
  s.getColumn(6).width = 10;
  s.getCell('A9').value = '特記事項';
  s.mergeCells('C9:F9');
  s.getCell('A10').value = '要否';
  s.getCell('C10').value = '□必要 □不要';
  const l = wb.addWorksheet('選択肢');
  l.getCell('A1').value = BOX;
  return wb.xlsx.writeBuffer();
}

// 見本の設定に、架空の様式のカルテの設定と、腐朽の部位・寸法を足したもの
export function simpleKarteConfig(cfgJson) {
  return {
    ...structuredClone(cfgJson),
    checks: cfgJson.checks.map((c) => (c.key === 'decay' ? { ...c, measure: { kinds: ['decay', 'rod'], eq: ['小', '有'] } } : c)),
    karte: {
      fileLabel: '架空カルテ',
      keepSheets: ['^選択肢$'],
      sheets: [
        {
          form: 'simple',
          siteType: 'park',
          sheet: '^架空カルテ様式$',
          checks: { A3: '樹木番号', A8: '腐朽' },
          cells: [
            { cell: 'C2', key: '@dateSerial', num: true },
            { cell: 'C3', key: 'treeNo', num: true },
            { cell: 'C4', key: 'species' },
            { cell: 'C5', key: '@girth', num: true },
            { cell: 'C6', key: '@branchRatio', num: true },
            { cell: 'C7', key: 'lean', map: { '': LEAN, 無: '■無　□有', 有: '□無　■有' } },
            { cell: 'C8', key: 'decay', boxes: BOX, match: 'exact', map: { 小: '有' } },
            { cell: 'E8', key: '@check:decay' },
            { cell: 'C9', keys: ['@notes', '@check:fungus'], join: '　', skipEmpty: true },
            { cell: 'C10', key: 'initialNeeded', boxes: '□必要 □不要', map: { [cfgJson.initial.yes]: '必要', [cfgJson.initial.no]: '不要' } },
          ],
        },
      ],
    },
  };
}
