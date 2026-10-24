// 入力画面で下へスクロールしても、樹木番号と樹種が画面の上に見えている
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('入力画面：スクロールしても樹木番号と樹種が上に残る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/tb-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/tb-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.fill('#f-species', 'テストノキ');
  await expect(page.locator('[data-testid=tree-bar-no]')).toHaveText('AB002');
  await expect(page.locator('[data-testid=tree-bar-species]')).toHaveText('テストノキ');
  // 前後の木の番号をボタンに出す
  await expect(page.locator('[data-testid=prev-tree]')).toContainText('AB001');
  await expect(page.locator('[data-testid=next-tree]')).toContainText('AB003');

  // 一番下の特記事項までスクロールしても、帯は上の帯（表題）のすぐ下に見えている
  await page.locator('#f-notes').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 3000);
  const top = await page.locator('.top').boundingBox();
  const bar = await page.locator('[data-testid=tree-bar]').boundingBox();
  expect(Math.abs(bar.y - (top.y + top.height))).toBeLessThan(2);
  await expect(page.locator('[data-testid=tree-bar-no]')).toBeInViewport();
});

test('上の帯の高さが変わっても（文字の折り返し・画面の向き）、樹木番号の帯は上の帯のすぐ下に付いてくる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/tb2-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/tb2-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  // 上の帯を高くする（調査情報が長く折り返したときと同じ）
  await page.locator('.top').evaluate((e) => (e.style.paddingBottom = '60px'));
  await page.mouse.wheel(0, 3000);
  await expect
    .poll(async () => {
      const top = await page.locator('.top').boundingBox();
      const bar = await page.locator('[data-testid=tree-bar]').boundingBox();
      return Math.abs(bar.y - (top.y + top.height));
    })
    .toBeLessThan(2);
  // 前後の木のボタンもスクロールした所から押せる
  await expect(page.locator('[data-testid=tree-bar] button:has-text("次の木")')).toBeInViewport();
});

test('詳しい診断の画面でも、スクロールしても樹木番号と樹種が上に残る（区切りの見出しはその下）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/tb3-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/tb3-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await expect(page.locator('[data-testid=tree-bar-no]')).toHaveText('AB001');
  await expect(page.locator('[data-testid=tree-bar-species]')).toHaveText('テストノキ');

  await page.mouse.wheel(0, 3000);
  await expect
    .poll(async () => {
      const top = await page.locator('.top').boundingBox();
      const bar = await page.locator('[data-testid=tree-bar]').boundingBox();
      return Math.abs(bar.y - (top.y + top.height));
    })
    .toBeLessThan(2);
  await expect(page.locator('[data-testid=tree-bar-no]')).toBeInViewport();
  // 上に残っている区切りの見出しは、樹木番号の帯に隠れない
  const bar = await page.locator('[data-testid=tree-bar]').boundingBox();
  const stuck = await page.locator('.initial-form .form-body .sec > h2').evaluateAll((hs) =>
    hs.map((h) => h.getBoundingClientRect()).filter((r) => r.top < 300 && r.bottom > 0).map((r) => r.top),
  );
  for (const y of stuck) expect(y).toBeGreaterThanOrEqual(bar.y + bar.height - 2);
});
