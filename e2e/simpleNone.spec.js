// 簡易診断：まだ選んでいない点検項目をすべて「無」にする／特記事項に枯れ枝の寸法を足す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

async function open(page) {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/sn-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/sn-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
}

test('点検項目：まだ選んでいない項目をすべて「無」にする', async ({ page }) => {
  await open(page);
  await page.click('[data-group=deadBranch] [data-v="有"]');
  await page.click('[data-testid=checks-none]');
  await expect(page.locator('.toast')).toContainText('3項目を「無」にしました');
  for (const k of ['lean', 'decay', 'fungus']) await expect(page.locator(`[data-group=${k}] [data-v="無"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-group=deadBranch] [data-v="有"]')).toHaveAttribute('aria-pressed', 'true'); // 選んであった項目はそのまま
  // 枯死の木は点検項目を原則空欄にするので押せない
  await page.click('[data-group=vigor] [data-v="枯"]');
  await expect(page.locator('[data-testid=checks-none]')).toBeDisabled();
});

test('寸法を入れる：枯れ枝（部位なし・本数は入力済みの値）', async ({ page }) => {
  await open(page);
  await page.click('[data-group=deadBranch] [data-v="有"]');
  await page.fill('#f-deadBranchCount', '6');
  await page.click('[data-testid=measure-open]');
  const box = page.locator('[data-testid=measure]');
  await box.locator('[data-measure-kind=deadBranch]').click();
  await expect(box.locator('[data-measure-place]')).toHaveCount(0); // 部位は選ばない
  await expect(box.locator('[data-part=count]')).toHaveValue('6');
  await box.locator('[data-part="height.a"]').fill('5');
  await box.locator('[data-part=branchDia]').fill('4');
  await box.locator('[data-part=branchLen]').fill('3');
  await box.locator('[data-part=max]').click();
  await box.locator('[data-testid=measure-add]').click();
  await expect(page.locator('#f-notes')).toHaveValue('・枯れ枝：6本、地上5m、枝直径4cm、枝長3m（最大）');
});
