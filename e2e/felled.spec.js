// 伐採済み（設定 felled）：押すと点検項目・要否・樹勢を空欄にして止め、番号と樹種だけで入力済みにできる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test('伐採済みを押すと点検項目が空欄になり、番号と樹種だけで保存できる', async ({ page }) => {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.numbering = { start: 1 };
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }] };
  cfg.felled = { label: '伐採済み' };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/felled-config.json', JSON.stringify(cfg));
  const k0 = cfg.checks[0].key;
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/felled-config.json');
  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の通り');
  await page.click('[data-testid=add-group-submit]');
  await page.fill('#f-species', 'テストノキ');
  await page.click(`[data-group=${k0}] [data-v="${cfg.options[k0][0]}"]`);
  await page.click('[data-testid=felled]');
  await expect(page.locator('[data-testid=felled]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-group=${k0}] button`).first()).toBeDisabled();
  await expect(page.locator(`[data-group=${k0}] [aria-pressed=true]`)).toHaveCount(0); // 選んでいた値は空欄に
  await expect(page.locator('[data-group=initialNeeded] button').first()).toBeDisabled();
  // 番号と樹種があるので、未入力の確かめなしで保存できる
  await page.click('[data-testid=save-stay]');
  await expect(page.locator('text=未入力のまま保存する')).toHaveCount(0);
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-tree="1"]')).toBeVisible();
  // もう一度押すと戻る
  await page.click('[data-tree="1"]');
  await page.click('[data-testid=felled]');
  await expect(page.locator(`[data-group=${k0}] button`).first()).toBeEnabled();
});
