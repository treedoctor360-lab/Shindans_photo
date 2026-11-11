// 一覧型の野帳（設定 listSheet）：台帳なしで路線を足して入力し、A3 の野帳を出力する
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';

function configFile() {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  const [k1] = cfg.checks.map((c) => c.key);
  const yes = cfg.options[k1].find((v) => v !== '無');
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }, { key: 'routeNo', label: '路線番号' }] };
  cfg.details = [...cfg.details, { when: { field: k1, eq: yes }, field: 'whereX', label: '架空：部位' }];
  cfg.listSheet = {
    paper: 'A3',
    rowsPerSheet: 38,
    noneValue: '無',
    noneMark: '－',
    header: [{ key: 'routeName', label: '路線名' }],
    columns: [
      { key: 'treeNo', label: '樹木番号', width: 6 },
      { key: 'species', label: '樹種', width: 14, align: 'left' },
      { key: 'height', label: 'H', width: 6 },
      { key: 'girth', label: 'C', width: 6 },
      { key: 'branch', label: '枝長/枝径', width: 9 },
      ...cfg.checks.map((c) => ({ key: c.key, label: c.label, width: 6 })),
      { key: 'remarks', label: '備考', width: 40, align: 'left' },
    ],
  };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/list-sheet-config.json', JSON.stringify(cfg));
  return { path: 'test-results/list-sheet-config.json', cfg, k1, yes };
}

test('路線を足して入力した木を、A3 の一覧型の野帳に出力できる（照合つき）', async ({ page }) => {
  const { path, cfg, k1, yes } = configFile();
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', path);
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の新しい通り');
  await page.fill('#ag-routeNo', '7');
  await page.click('[data-testid=add-group-submit]');

  // 1本目：項目1を「有」にして部位を入れる
  await page.fill('#f-species', 'テストノキ');
  await page.fill('#f-height', '6.5');
  await page.fill('#f-girth0', '0.68');
  await page.fill('#f-bl', '300');
  await page.fill('#f-bd', '5');
  await page.click('[data-testid=checks-none]');
  await page.click(`[data-group=${k1}] [data-v="${yes}"]`);
  await page.fill('#f-whereX', '幹');
  await page.click('[data-testid=save-and-add]');
  await page.click('text=未入力のまま保存する');
  // 2本目：番号だけ
  await expect(page.locator('#f-treeNo')).toHaveValue('2');
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');

  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=export-field]')).toHaveCount(0); // 原本の野帳のボタンは出さない
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-list-sheet]')]);
  await expect(page.locator('.toast')).toContainText('全件照合OK');
  expect(dl.suggestedFilename()).toMatch(/^野帳_7_試験の新しい通り_\d{6}\.xlsx$/) // 路線番号も入る（番号違いの路線が上書きし合わない）;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  const ws = wb.worksheets[0];
  const row = (r) => cfg.listSheet.columns.map((_, i) => String(ws.getRow(r).getCell(i + 1).value ?? ''));
  expect(ws.getRow(1).getCell(2).value).toBe('試験の新しい通り');
  const r1 = row(4);
  expect(r1.slice(0, 5)).toEqual(['1', 'テストノキ', '6.5', '0.68', '300/5']);
  expect(r1[5]).toBe(yes);
  expect(r1.slice(6, -1).every((v) => v === '－' || v === '')).toBe(true);
  expect(r1.at(-1)).toBe('架空：幹');
  expect(row(5).slice(0, 2)).toEqual(['2', 'テストノキ']);
  expect(row(6).every((v) => v === '')).toBe(true); // 空の行
});
