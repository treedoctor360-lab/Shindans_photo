// 追加した木の並び（この木の次に追加）・現地の番号に変える・内勤さんに渡す Excel
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};
const order = (page) => page.locator('[data-testid=tree-cards] [data-tree]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tree')));

test('この木の次に追加・並びを選び直す・現地の番号に変える・差し込む行の一覧', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('ap-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  expect(await order(page)).toEqual(['AB001', 'AB002', 'AB003']);

  // AB001 の次に追加
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=add-after]');
  await page.fill('#f-treeNo', 'AB0900');
  await page.fill('#f-species', 'アラカシ');
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
  expect(await order(page)).toEqual(['AB001', 'AB0900', 'AB002', 'AB003']);
  // 並びを選び直す（AB003 の次）
  await page.click('[data-tree=AB0900]');
  const v = await page.locator('[data-testid=after-select] option', { hasText: 'AB003' }).getAttribute('value');
  await page.selectOption('[data-testid=after-select]', v);
  await page.click('.tab:has-text("一覧")');
  expect(await order(page)).toEqual(['AB001', 'AB002', 'AB003', 'AB0900']);

  // AB002 を入力し、現地の番号に変える（特記の番号の書き込みは消す）
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '7');
  await page.fill('#f-girth0', '0.4');
  await page.fill('#f-notes', '・AB915に変更');
  await page.click('[data-testid=save-stay]');
  await page.click('text=未入力のまま保存する');
  await page.click('[data-testid=renumber]');
  await page.fill('#f-renum', 'AB0915');
  await expect(page.locator('[data-testid=renumber-ask]')).toContainText('特記事項から消す：・AB915に変更');
  await page.click('[data-testid=renumber-ok]');
  await expect(page.locator('#f-treeNo')).toHaveValue('AB0915');
  await expect(page.locator('#f-height')).toHaveValue('7');
  await expect(page.locator('#f-notes')).toHaveValue('');
  await expect(page.locator('[data-testid=renamed-from]')).toContainText('一覧表では AB002 の行');
  await page.click('.tab:has-text("一覧")');
  expect(await order(page)).toEqual(['AB001', 'AB002', 'AB0915', 'AB003', 'AB0900']);

  // 差し込む行の一覧
  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=insert-list]')).toContainText('2件');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=insert-list]')]);
  expect(dl.suggestedFilename()).toMatch(/^差し込む行の一覧_架空公園_\d{6}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(await dl.path()));
  const ws = wb.getWorksheet('差し込む行');
  expect([3, 4].map((r) => [2, 3, 5, 6].map((c) => ws.getRow(r).getCell(c).value ?? ''))).toEqual([
    ['番号を直す', 'AB0915', '', 'AB002'],
    ['行を差し込む', 'AB0900', 'AB003', ''],
  ]);
  // 入力内容の一覧（確認用）
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=entry-list]')]);
  expect(dl2.suggestedFilename()).toMatch(/^入力内容の一覧_確認用_提出不可_架空公園_\d{6}\.xlsx$/);
});
