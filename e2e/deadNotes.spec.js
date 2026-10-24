// 枯死の木でも特記事項は書ける（点検項目だけを原則空欄にする）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('枯死の木：点検項目は押せないが、特記事項（定型文・自由記述・一覧表用）は書ける', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/dn-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/dn-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.click('[data-group=vigor] [data-v="枯"]');
  // 点検項目は原則空欄のまま（押せない）
  await expect(page.locator('[data-group=lean] [data-v="無"]')).toBeDisabled();
  // 特記事項は書ける
  await page.click('[data-testid=note-chips] .chip:has-text("枝の偏り")');
  await expect(page.locator('#f-notes')).toBeEditable();
  await expect(page.locator('#f-notes')).toHaveValue(/枝の偏り/);
  await page.locator('#f-notes').press('End');
  await page.locator('#f-notes').pressSequentially('\n・自由記述のテスト');
  await expect(page.locator('#f-notes')).toHaveValue(/自由記述のテスト/);
  await expect(page.locator('#f-dbnote')).toBeEditable();
  await expect(page.locator('#f-dbnote')).toHaveValue(/枝の偏り/);
});
