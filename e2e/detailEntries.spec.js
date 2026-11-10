// 弱点の詳細：別の箇所を足すと、①②ごとに数値の欄が並び、文も①②で並ぶ。消すと1か所に戻る
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('別の箇所を足す・箇所ごとに入れる・消す', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('e-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('e-book.xlsx', await makeInitialBook()));
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');

  await page.click('[data-group=b4] [data-v="有（大）"]');
  const box = page.locator('[data-entries=b4Detail]');
  await box.locator('[data-entry="0"] [data-part="height.a"]').fill('2');
  await expect(page.locator('#i-b4Detail')).toHaveValue('3本、地上2m'); // 本数は簡易診断から
  await page.click('[data-add-entry=b4Detail]');
  await expect(box.locator('[data-entry]')).toHaveCount(2);
  await box.locator('[data-entry="1"] [data-part="height.a"]').fill('5');
  await expect(page.locator('#i-b4Detail')).toHaveValue('①3本、地上2m ②地上5m');
  await box.locator('[data-entry="0"] [data-remove-entry="0"]').click();
  await expect(box.locator('[data-entry]')).toHaveCount(1);
  await expect(page.locator('#i-b4Detail')).toHaveValue('地上5m');
});
