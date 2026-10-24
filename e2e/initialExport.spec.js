// 詳しい診断の記録を、データ入力用ブックに書き込んで出力する（書き込み後の照合つき）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import cfg from '../test/fixtures/sample-config.json' with { type: 'json' };
import { readInitialBook } from '../src/excel/initialBook.js';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('アプリで入力した詳しい診断を、ブックの空き行に書き込んで出力する（読み直して照合）', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('x-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('x-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();

  // まだ入力済みの記録がないときは押せない
  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=export-initial]')).toBeDisabled();

  // AB001（台帳で「必要」）の詳しい診断を入力して保存
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await page.click('[data-group=b4] [data-v="有（大）"]');
  await page.fill('#i-b4Detail', '1本、地上4m');
  await page.click('[data-form=environment]');
  await page.click('[data-group=stake] [data-v="無"]');
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');

  // 出力：検査OKでダウンロード。ブックの中身を読み直して確かめる
  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=export-initial]')).toContainText('1本');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-initial]')]);
  await expect(page.locator('.toast')).toContainText('検査OK。1本を書き込みました');
  await expect(page.locator('[data-testid=check-errors]')).toHaveCount(0);
  expect(dl.suggestedFilename()).toMatch(/^x-book_入力反映_\d{6}\.xlsx$/);
  const r = await readInitialBook(fs.readFileSync(await dl.path()), cfg);
  const [main, env] = r.sheets;
  expect(main.rows.find((x) => x.rowNumber === 7).values).toMatchObject({ serial: 3, year: 2099, month: 5, day: 6, inspector: '試験 二郎(資格)', treeNo: 'AB001', parkCode: 'K01', b4: '有（大）', b4Detail: '1本、地上4m' });
  expect(env.rows.find((x) => x.rowNumber === 5).values).toMatchObject({ treeNo: 'AB001', parkCode: 'K01', stake: '無' });
  expect(main.rows.filter((x) => x.filled)).toHaveLength(3);
});
