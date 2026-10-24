// 「保存（この木のまま）」：保存して、同じ木の画面のまま続けて直せる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('保存だけ：同じ木のまま、スクロールした位置も変わらない。直して保存し直せる', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/ss-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/ss-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.fill('#f-species', 'テストノキ');
  await page.locator('[data-testid=save-stay]').scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => window.scrollY);
  await page.click('[data-testid=save-stay]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('AB002 を保存しました');
  await expect(page.locator('[data-testid=tree-bar-no]')).toHaveText('AB002');
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThan(80);

  // 続けて直して、もう一度保存できる
  await page.locator('#f-notes').fill('・続けて直した');
  await page.click('[data-testid=save-stay]');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('[data-testid=tree-bar-no]')).toHaveText('AB002');
  await expect(page.locator('#f-notes')).toHaveValue('・続けて直した');
  // 一覧では入力済み
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-tree=AB002]')).not.toContainText('未');
});
