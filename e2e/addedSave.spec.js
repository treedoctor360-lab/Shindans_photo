// 追加した木の保存：「保存して次の木へ」を出さない（台帳の最初の未入力の木が開いてしまい、
// その木を追加の続きと思って上書きする事故があったため）。「保存して一覧へ」「保存してもう1本追加」にする
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('追加した木は「保存して一覧へ」「保存してもう1本追加」で保存し、台帳の木を開かない', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('a-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();

  // 台帳の木の画面は今までどおり
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await expect(page.locator('text=保存して次の木へ')).toBeVisible();
  await expect(page.locator('[data-testid=save-to-list]')).toHaveCount(0);

  // 追加した木：「保存して次の木へ」はない。「保存してもう1本追加」で、空の木がもう1本開く
  await page.click('.tab:has-text("一覧")');
  await page.click('text=一覧にない木を追加');
  await expect(page.locator('text=保存して次の木へ')).toHaveCount(0);
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-testid=save-and-add]');
  await page.click('text=未入力のまま保存する'); // 未入力の確かめの後も、同じ行き先（もう1本追加）
  await expect(page.locator('.toast')).toContainText('保存しました');
  await expect(page.locator('#f-species')).toHaveValue(''); // 台帳の木ではなく、新しい空の木
  await expect(page.locator('#f-treeNo')).toHaveValue('');
  await expect(page.locator('[data-testid=save-to-list]')).toBeVisible();

  // 「保存して一覧へ」：一覧に戻る。追加した2本が一覧にある
  await page.fill('#f-species', 'ミホンカエデ');
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible();
  await page.click('[data-filter=all]');
  await expect(page.locator('.card:has-text("(番号なし)")')).toHaveCount(2);
  await expect(page.locator('[data-tree=AB002] .pill.none')).toBeVisible(); // 台帳の木は未入力のまま
});

test('追加した木が詳しい診断の対象なら、一覧に戻っても「続けて入力」を聞く', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('a2-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('text=一覧にない木を追加');
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-group=initialNeeded] [data-v="要"]');
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('[data-testid=initial-prompt]')).toBeVisible();
  await page.click('[data-testid=initial-prompt-go]');
  await expect(page.locator('[data-testid=initial-view]')).toBeVisible();
  await expect(page.locator('[data-testid=initial-tree]')).toContainText('テストノキ');
});
