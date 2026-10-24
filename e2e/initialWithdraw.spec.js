// 詳しい診断の入力の取り消し（未入力に戻す）と、まだ送っていない下書きを消す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('入力済みの詳しい診断を未入力に戻せる（値は残る）。下書きは消せる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('w-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();

  // AB001：入力して保存 → 開き直して「入力を取り消す」
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await page.click('[data-group=lean] [data-v="有（安全）"]');
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('[data-tree=AB001] [data-initial]')).toHaveAttribute('data-initial', 'done');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await page.click('[data-testid=initial-remove]');
  await expect(page.locator('[data-testid=initial-remove-ask]')).toContainText('未入力に戻します');
  await page.click('[data-testid=initial-remove-ok]');
  await expect(page.locator('.toast')).toContainText('未入力に戻しました');
  await expect(page.locator('[data-group=lean] [data-v="有（安全）"]')).toHaveAttribute('aria-pressed', 'true'); // 値は下書きとして残る
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-tree=AB001] [data-initial]')).toHaveAttribute('data-initial', 'draft');

  // 下書きのまま（まだ送っていない）なら「下書きを消す」で、記録を作る前に戻る
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await page.click('[data-testid=initial-remove]');
  await expect(page.locator('[data-testid=initial-remove-ask]')).toContainText('下書きを消します');
  await page.click('[data-testid=initial-remove-ok]');
  await expect(page.locator('.toast')).toContainText('下書きを消しました');
  await expect(page.locator('[data-testid=initial-block] [data-initial]')).toHaveAttribute('data-initial', 'todo');
});
