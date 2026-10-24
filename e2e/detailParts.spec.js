// 弱点の詳細：部品（本数・高さなど）を入れると文ができる。手で直した文は部品を変えても残り、「部品から作り直す」で戻る
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

test('部品から詳細の文を作る・手で直す・作り直す。保存しても残る', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('d-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('d-book.xlsx', await makeInitialBook()));
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');

  // 「無」のときは部品を出さない
  await page.click('[data-group=b4] [data-v="無"]');
  await expect(page.locator('[data-parts=b4Detail]')).toHaveCount(0);

  // 「有」にすると部品が出る。入れると文ができる（全角の数字も半角に）
  await page.click('[data-group=b4] [data-v="有（大）"]');
  const parts = page.locator('[data-parts=b4Detail]');
  await parts.locator('[data-part=count]').fill('１');
  await parts.locator('[data-part="height.a"]').fill('2');
  await parts.locator('[data-part=branchDia]').fill('18');
  await parts.locator('[data-part=branchLen]').fill('4');
  await expect(page.locator('#i-b4Detail')).toHaveValue('1本、地上2m、枝直径18cm、枝長4m');

  // 手で直すと、部品を変えても文は変わらない
  await page.fill('#i-b4Detail', '1本、地上2m付近');
  await parts.locator('[data-part=branchLen]').fill('5');
  await expect(page.locator('#i-b4Detail')).toHaveValue('1本、地上2m付近');
  // 書き換えた後だけ、詳細の下に「数値から作り直す」が出る
  await expect(page.locator('[data-rebuild=b4Detail]')).toHaveText('数値から作り直す');
  await page.click('[data-rebuild=b4Detail]');
  await expect(page.locator('[data-rebuild=b4Detail]')).toHaveCount(0);
  await expect(page.locator('#i-b4Detail')).toHaveValue('1本、地上2m、枝直径18cm、枝長5m');

  // 保存して開き直しても、部品と文が残っている
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await expect(page.locator('#i-b4Detail')).toHaveValue('1本、地上2m、枝直径18cm、枝長5m');
  await expect(page.locator('[data-parts=b4Detail] [data-part=branchLen]')).toHaveValue('5');
});
