// 株立の幹周：「1本減らす」を押し間違えても、入れた値は確かめずに消さない
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('値の入った幹周は、「消す」を押したときだけ減らす。空の幹周はすぐ減らす', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/gr-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/gr-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.fill('#f-girth0', '0.5');
  await page.click('[data-testid=girth-add]');
  await page.fill('#f-girth1', '0.4');

  // 押し間違え：確かめる。「やめる」なら値はそのまま
  await page.click('[data-testid=girth-remove]');
  await expect(page.locator('[data-testid=girth-remove-ask]')).toContainText('2本目（0.4m）');
  await page.click('[data-testid=girth-remove-cancel]');
  await expect(page.locator('#f-girth1')).toHaveValue('0.4');

  // 「消す」を押したときだけ減る
  await page.click('[data-testid=girth-remove]');
  await page.click('[data-testid=girth-remove-ok]');
  await expect(page.locator('#f-girth1')).toHaveCount(0);
  await expect(page.locator('#f-girth0')).toHaveValue('0.5');

  // 空の幹周は確かめずに減らす
  await page.click('[data-testid=girth-add]');
  await page.click('[data-testid=girth-remove]');
  await expect(page.locator('#f-girth1')).toHaveCount(0);
  await expect(page.locator('[data-testid=girth-remove-ask]')).toHaveCount(0);
});
