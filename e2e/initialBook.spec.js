// データ入力用ブックに手で入力済みの木：初期診断の画面でブックの内容を見られる。アプリで入力し直すとブックの値が下書きになる
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

test('ブックに入力済みの木は、ブックの内容を表示だけする。「アプリで入力し直す」でブックの値を下書きにして保存できる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('b-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('b-book.xlsx', await makeInitialBook({ withAB001: true })));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();

  // AB001（台帳で「必要」）：ブックで入力済み
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-tree=AB001] [data-initial]')).toHaveAttribute('data-initial', 'book');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial-book]');

  // ブックの内容（表示だけ）
  await expect(page.locator('[data-testid=book-note]')).toContainText('公園_詳しい診断 7行目');
  await expect(page.locator('[data-group=b4] [data-v="有（大）"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-group=b4] [data-v="無"]')).toBeDisabled();
  await expect(page.locator('#i-b4Detail')).toHaveValue('2本、地上5m');
  await expect(page.locator('#i-height')).toHaveValue('9.5');
  await expect(page.locator('[data-testid=save-initial]')).toHaveCount(0);
  await page.click('[data-form=environment]');
  await expect(page.locator('[data-group=stake] [data-v="有"]')).toHaveAttribute('aria-pressed', 'true');

  // アプリで入力し直す → ブックの値が下書き。直して保存できる
  await page.click('[data-testid=book-copy]');
  await expect(page.locator('[data-group=stake] [data-v="有"]')).toBeEnabled();
  await page.click('[data-form=initial]');
  await expect(page.locator('[data-item=height] .tag.prev')).toHaveText('ブックから');
  await page.fill('#i-b4Detail', '2本、地上5m・6m');
  await page.click('[data-testid=save-initial]');
  // 未入力が残っていれば確かめが出る（ブックの値で埋まっていれば出ない）
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');

  // アプリとブックの両方で入力済み：アプリの入力を表示し、ブックの内容にも切り替えられる
  await page.click('.chip:has-text("詳しい診断待ち")');
  await expect(page.locator('[data-tree=AB001] [data-initial]')).toHaveAttribute('data-initial', 'both');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await expect(page.locator('#i-b4Detail')).toHaveValue('2本、地上5m・6m');
  await page.click('[data-testid=book-toggle]');
  await expect(page.locator('#i-b4Detail')).toHaveValue('2本、地上5m');
  await page.click('[data-testid=book-toggle]');
  await expect(page.locator('#i-b4Detail')).toHaveValue('2本、地上5m・6m');
});
