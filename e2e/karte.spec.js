// 詳しい診断の記録から、確認用のカルテ（1本1シート）を作って出力する（読み直して照合）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeKarteTemplate } from '../test/helpers/makeKarteTemplate.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('カルテの様式を読み込み、入力済みの詳しい診断を確認用カルテに出力する', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('k-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  // 選択肢（弱点の有無など）はデータ入力用ブックの入力規則から読む
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('k-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();

  // 様式が設定と違うブック：知らせて、出力は押せない
  await page.setInputFiles('[data-testid=karte-template-file]', tmp('k-bad.xlsx', await makeKarteTemplate({ title: '別のカルテ' })));
  await expect(page.locator('[data-testid=karte-template-errors]')).toContainText('A1');
  await page.setInputFiles('[data-testid=karte-template-file]', tmp('k-tpl.xlsx', await makeKarteTemplate()));
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();
  await expect(page.locator('[data-testid=karte-template-errors]')).toHaveCount(0);

  // まだ入力済みの記録がないときは押せない
  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=export-karte]')).toBeDisabled();

  // AB001 の詳しい診断を入力して保存
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await page.click('[data-group=lean] [data-v="有（危険）"]');
  await page.click('[data-group=b4] [data-v="有（大）"]');
  await page.fill('#i-b4Detail', '1本、地上4m');
  await page.click('[data-form=environment]');
  await page.click('[data-group=stake] [data-v="支柱なし"]');
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');

  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=export-karte]')).toContainText('1本');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-karte]')]);
  await expect(page.locator('.toast')).toContainText('検査OK。1本・2枚');
  // 公園ごと：「コード_名前(書式の名前)番号_確認用_提出不可_日付」
  expect(dl.suggestedFilename()).toMatch(/^K01_架空公園\(詳しい診断\)AB001_確認用_提出不可_\d{6}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(await dl.path()));
  expect(wb.worksheets.map((w) => w.name)).toEqual(['AB001', 'AB001_環境']);
  const a = wb.getWorksheet('AB001');
  expect(a.getCell('E1').value).toBe('2099/5/6');
  expect(a.getCell('F1').value).toBe('試験 二郎(資格)');
  expect(a.getCell('C6').value).toBe('□無 ■有');
  expect(a.getCell('E6').value).toBe('□安全　■危険');
  expect(a.getCell('C7').value).toBe('□無 ■有（大）');
  expect(a.getCell('E7').value).toBe('1本、地上4m');
  expect(a.getCell('A10').value).toBe('確認用（提出不可）');
  expect(wb.getWorksheet('AB001_環境').getCell('E4').value).toBe('支柱なし');

  // すべての公園・路線をまとめて出すこともできる
  await page.click('[data-testid=karte-all]');
  await expect(page.locator('[data-testid=export-karte]')).toContainText('すべての公園・路線（入力済みの1本）');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-karte]')]);
  expect(dl2.suggestedFilename()).toMatch(/^確認用カルテ_.+_1本_確認用_提出不可_\d{6}\.xlsx$/);
});
