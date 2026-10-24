// 【再発防止】台帳の木の樹木番号は書き換えられない（別の木を入れるときは「一覧にない木を追加」）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('台帳の木の樹木番号は書き換えられない。追加した木の番号は書ける', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/n-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/n-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await expect(page.locator('#f-treeNo')).toHaveValue('AB002');
  await expect(page.locator('#f-treeNo')).not.toBeEditable();
  await expect(page.locator('[data-testid=treeno-locked]')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('text=一覧にない木を追加');
  await expect(page.locator('#f-treeNo')).toBeEditable();
});
