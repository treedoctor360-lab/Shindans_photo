// 詳しい診断（初期診断など）の準備：データ入力用ブックを読み込み、対象の木に進み具合が出る
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

test('データ入力用ブックを読み込むと、入力済みの本数が出る。詳しい診断が必要な木に進み具合の印が付く', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=ledger-file]', tmp('i-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();

  // ブック：見出しが合っていれば、入力済みの本数（同じ番号でも場所のコードが違えば別の木）
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('i-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status]')).toContainText('入力済み2本');
  await expect(page.locator('[data-testid=initial-book-errors]')).toHaveCount(0);

  // 見出しが違うブック：使わないシートを知らせる
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('i-book-bad.xlsx', await makeInitialBook({ envHeader: '台風の影響' })));
  await expect(page.locator('[data-testid=initial-book-errors]')).toContainText('C列（weather）');

  // 簡易診断で「必要」にした木に、詳しい診断の進み具合が出る
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.click('[data-group=initialNeeded] [data-v="要"]');
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-tree=AB002] [data-initial]')).toHaveAttribute('data-initial', 'todo');
});
