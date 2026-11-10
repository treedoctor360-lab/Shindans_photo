// 詳しい診断の画面：簡易診断の特記事項が反映されているかを、弱点の入力の手前にまとめて出す（設定 noteCheck）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, typeof bytes === 'string' ? bytes : Buffer.from(bytes));
  return p;
};

test('定型文の対応する項目が「有」でなければ黄色で先に出し、「有」にすると反映済みになる', async ({ page }) => {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.initialSurvey.noteCheck = [{ notes: ['根元の割れ'], items: ['b4'] }];
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', tmp('sn-config.json', JSON.stringify(cfg)));
  await page.setInputFiles('[data-testid=ledger-file]', tmp('sn-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('sn-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();

  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '10');
  await page.fill('#f-girth0', '0.5');
  await page.click('[data-testid=note-chips] >> text=根元の割れ');
  await page.click('[data-testid=note-chips] >> text=枝の偏り');
  await page.click('[data-group=initialNeeded] [data-v="要"]');
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');
  await page.click('[data-testid=initial-prompt-go]');

  const box = page.locator('[data-testid=simple-notes]');
  await expect(box.locator('[data-testid=simple-notes-miss]')).toHaveText('未反映 1');
  await expect(box.locator('.sn').first()).toHaveAttribute('data-sn', 'missing');
  await expect(box.locator('.sn').first()).toContainText('根元の割れ');
  await expect(box.locator('[data-sn=free]')).toContainText('枝の偏り');
  // 一覧は弱点の入力（「すべて無」のある区切り）の手前
  const top = async (sel) => (await page.locator(sel).boundingBox()).y;
  expect(await top('[data-testid=simple-notes]')).toBeLessThan(await top('[data-testid=none-1]'));

  await page.click('[data-group=b4] [data-v="有（小）"]');
  await expect(box.locator('[data-testid=simple-notes-miss]')).toHaveCount(0);
  await expect(box.locator('[data-sn=ok]')).toContainText('根元の割れ');
});
