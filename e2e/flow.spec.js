// 読み込み → 入力 → 出力 → 照合 の流れを、実際の画面で確かめる（架空の設定・台帳・原本を使う）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { makeLedger } from '../test/helpers/makeLedger.js';
import { makeTemplate } from '../test/helpers/makeTemplate.js';

const tmp = (name, bytes) => {
  const p = `test-results/${name}`;
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('台帳を読み込み、2本入力して、野帳と一覧表を出力できる（照合に合格）', async ({ page }) => {
  const ledger = tmp('ledger.xlsx', await makeLedger());
  const template = tmp('template.xlsx', await makeTemplate());

  // 設定
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=template-file]', template);
  await page.setInputFiles('[data-testid=ledger-file]', ledger);
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();

  // 一覧 → AB002 を入力
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '10');
  await page.fill('#f-girth0', '0.5');
  for (const [g, v] of [['vigor', '並'], ['lean', '無'], ['deadBranch', '有'], ['decay', '無'], ['fungus', '無'], ['initialNeeded', '否'], ['grade', 'B']])
    await page.click(`[data-group=${g}] [data-v="${v}"]`);
  await page.fill('#f-deadBranchCount', '2');
  await page.click('[data-testid=note-chips] .chip:has-text("枝の偏り")');
  await page.click('.chip:has-text("枯れ枝") >> nth=0');
  await page.click('text=保存して次の木へ');
  await expect(page.locator('#f-treeNo')).toHaveValue('AB003');

  // AB003 は未入力のまま保存（確認を経て）
  await page.fill('#f-height', '6');
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');

  // 一覧：アプリで入力した木に、調査日と調査者を出す
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-tree=AB002] [data-testid=card-stamp]')).toHaveText(/^\d{1,2}\/\d{1,2}/);

  // 出力：野帳
  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=out-table] tbody tr')).toHaveCount(3);
  // 一覧表形式の列は、読み込んだ台帳と同じ並び・同じ見出し（台帳にない列は出さない）
  const heads = await page.locator('[data-testid=out-table] thead th').allTextContents();
  expect(heads.slice(0, 6)).toEqual(['連番', '公園コード', '公園名', '木の番号', '樹種', '調査日']);
  expect(heads).not.toContain('メモ');
  expect(await page.locator('[data-testid=out-table] tbody tr').first().locator('td').nth(3).textContent()).toBe('AB001');
  const [fieldDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-field]')]);
  await expect(page.locator('.toast')).toContainText('検査OK');
  await expect(page.locator('[data-testid=check-errors]')).toHaveCount(0);
  expect(fieldDl.suggestedFilename()).toMatch(/^野帳_架空公園_\d{6}\.xlsx$/);
  const fieldBuf = fs.readFileSync(await fieldDl.path());
  const zip = await JSZip.loadAsync(fieldBuf);
  const drawing = await zip.file('xl/drawings/drawing1.xml').async('string');
  expect(drawing).toContain('name="AB002|4|並|1"');

  // 出力：一覧表
  const [dbDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-db]')]);
  await expect(page.locator('.toast')).toContainText('検査OK');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(await dbDl.path()));
  const ws = wb.getWorksheet('公園');
  expect(ws.getCell('L4').value).toBe('並');
  expect(ws.getCell('N4').value).toBe('有(2本)');
  expect(ws.getCell('Q4').value).toBe('枝の偏りあり。');
  expect(ws.getCell('W4').value).toBe('残しておくメモ'); // 設定にない列は元のまま
});

test('入力は再読み込みしても残る', async ({ page }) => {
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('ledger2.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '7.5');
  await page.waitForTimeout(600); // まとめて保存する待ち時間より長く待つ
  await page.reload();
  await expect(page.locator('#f-height')).toHaveValue('7.5');
});
