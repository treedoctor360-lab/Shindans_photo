// 簡易診断のカルテ（設定 karte）：様式を読み込み、入力した木を1本1シートで出力する
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { makeSimpleKarteTemplate, simpleKarteConfig } from '../test/helpers/makeSimpleKarte.js';

async function files() {
  const base = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  const cfg = simpleKarteConfig(base);
  cfg.karte.sheets[0].siteType = 'street';
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }] };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/simple-karte-config.json', JSON.stringify(cfg));
  fs.writeFileSync('test-results/simple-karte-template.xlsx', Buffer.from(await makeSimpleKarteTemplate()));
  return cfg;
}

test('様式を読み込み、入力した木を簡易診断のカルテ（1本1シート）に出力できる', async ({ page }) => {
  const cfg = await files();
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/simple-karte-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=karte-template-file]', 'test-results/simple-karte-template.xlsx');
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();

  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の新しい通り');
  await page.click('[data-testid=add-group-submit]');
  await page.fill('#f-species', 'テストノキ');
  await page.fill('#f-height', '6.5');
  await page.fill('#f-girth0', '0.68');
  await page.click('[data-testid=checks-none]');
  await page.click('[data-group=decay] [data-v="有"]');
  const box = page.locator('[data-testid=check-measures][data-kinds="decay rod"]');
  await box.locator('[data-testid=measure-open]').click();
  await box.locator('[data-measure-kind=decay]').click();
  await box.locator('[data-measure-place="幹"]').click();
  await box.locator('[data-part="height.a"]').fill('1');
  await box.locator('[data-testid=measure-add]').click();
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');

  await page.click('.tab:has-text("出力")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-simple-karte]')]);
  await expect(page.locator('.toast')).toContainText('検査OK。1本のカルテ');
  expect(dl.suggestedFilename()).toMatch(/^架空カルテ_試験の新しい通り_1_\d{6}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  expect(wb.worksheets.map((w) => w.name)).toEqual(['1', '選択肢']);
  const ws = wb.getWorksheet('1');
  expect(ws.getCell('C3').value).toBe(1);
  expect(ws.getCell('C4').value).toBe('テストノキ');
  expect(ws.getCell('C8').value).toBe('□無  ■有');
  expect(ws.getCell('E8').value).toBe('地上1m 幹');
  expect(cfg.karte.fileLabel).toBe('架空カルテ');
});

test('入力画面の「カルテで見る」で、入力中の内容をカルテの形で見られる（選択肢の一覧のシートは出さない）', async ({ page }) => {
  await files();
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/simple-karte-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=karte-template-file]', 'test-results/simple-karte-template.xlsx');
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の新しい通り');
  await page.click('[data-testid=add-group-submit]');
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-group=decay] [data-v="有"]');
  // 保存しないまま開く
  await page.click('[data-testid=karte-view-open]');
  const kv = page.locator('[data-testid=karte-view]');
  await expect(kv).toContainText('カルテ（見るだけ）');
  await expect(kv.locator('[data-cell="4:3"]')).toHaveText('テストノキ');
  await expect(kv.locator('[data-cell="8:3"]')).toHaveText('□無  ■有');
  await expect(kv.locator('[data-kv-sheet]')).toHaveCount(0); // カルテのシートは1枚だけ（選択肢の一覧のシートは出さない）
  await page.click('[data-testid=kv-close]');
  await expect(kv).toHaveCount(0);
});
