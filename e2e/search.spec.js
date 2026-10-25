// 一覧の検索：樹木番号・樹種で探せる。ほかの公園・路線の木も出て、押すとその木が開く
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('番号の一部・ひらがなの樹種で探せる。ほかの公園・路線で見つかった木を押すと、その木が開く', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('s-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');

  // 全角で入っている番号も、半角の一部で見つかる
  await page.fill('[data-testid=list-search]', '002');
  await expect(page.locator('[data-testid=tree-cards] .card')).toHaveCount(1);
  await expect(page.locator('[data-testid=tree-cards] [data-tree=AB002]')).toBeVisible();
  await expect(page.locator('[data-testid=search-note]')).toContainText('1本');

  // ひらがなで樹種を探す
  await page.fill('[data-testid=list-search]', 'みほん');
  await expect(page.locator('[data-testid=tree-cards] [data-tree=AB002]')).toBeVisible();

  // ほかの公園・路線にも同じ番号がある
  await page.fill('[data-testid=list-search]', 'ab001');
  const other = page.locator('[data-testid=search-elsewhere] .card');
  await expect(other).not.toHaveCount(0);
  const n = await page.locator('[data-testid=tree-cards] .card').count();
  expect(n).toBeGreaterThan(0);
  await other.filter({ hasText: '別の樹種' }).click();
  await expect(page.locator('#f-species')).toHaveValue('別の樹種');
  await expect(page.locator('body')).toContainText('K09 別の架空公園');

  // 一覧に戻ると、その木の公園・路線に切り替わっている。「消す」で検索を外す
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('#s-group option:checked')).toContainText('別の架空公園');
  await page.click('[data-testid=list-search-clear]');
  await expect(page.locator('[data-testid=search-note]')).toHaveCount(0);
  await expect(page.locator('[data-filter=all]')).toBeVisible();
});

test('探す範囲で「すべての公園・路線」を選ぶと、どの公園・路線の木か分かる形で上にまとめて出る', async ({ page }) => {
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('s2-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');

  await page.fill('[data-testid=list-search]', 'ab001');
  // この公園・路線だけ（ほかは下に）
  await expect(page.locator('[data-scope=group]')).toHaveClass(/on/);
  const here = await page.locator('[data-testid=tree-cards] .card').count();
  // すべての公園・路線
  await page.click('[data-scope=all]');
  await expect(page.locator('[data-scope=all]')).toHaveClass(/on/);
  await expect(page.locator('[data-testid=search-elsewhere]')).toHaveCount(0);
  const cards = page.locator('[data-testid=tree-cards] .card');
  expect(await cards.count()).toBeGreaterThan(here);
  await expect(page.locator('[data-testid=search-note]')).toContainText('すべての公園・路線で');
  await expect(cards.filter({ hasText: '別の樹種' }).locator('[data-testid=card-group]')).toContainText('別の架空公園');
  // 押すと、その木の公園・路線に切り替わって開く
  await cards.filter({ hasText: '別の樹種' }).click();
  await expect(page.locator('#f-species')).toHaveValue('別の樹種');
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('#s-group option:checked')).toContainText('別の架空公園');
  // 範囲の選択は残る（次に探すときも、すべての公園・路線）
  await expect(page.locator('[data-scope=all]')).toHaveClass(/on/);
});
