// 表記の統一：特記事項の自由記述に決まりと違う書き方があれば知らせ、ボタンで直す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('簡易診断：「表記を直す」で自由記述だけを直す（定型文の行はそのまま）', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/wd-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/wd-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.locator('#f-notes').fill('・枝の偏り\n・枯枝2ヵ所');
  const alert = page.locator('.alert', { hasText: '表記の統一' });
  await expect(alert).toContainText('枯枝→枯れ枝');
  await expect(alert).toContainText('～か所→～箇所');
  await alert.locator('button', { hasText: '表記を直す' }).click();
  await expect(page.locator('#f-notes')).toHaveValue('・枝の偏り\n・枯れ枝2箇所');
  await expect(page.locator('.alert', { hasText: '表記の統一' })).toHaveCount(0);
});
