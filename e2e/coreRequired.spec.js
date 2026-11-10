// 簡易診断の寸法：芯達か芯未達かを必ず選ぶ（設定の flag の required）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('幹の腐朽は芯達・芯未達を選ぶまで追加できない。芯未達は文に出さない。枝は選ばなくてよい', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/cr-ledger.xlsx', Buffer.from(await makeLedger()));
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  Object.assign(cfg.noteMeasures.parts.core, { required: ['幹', '根株'], offLabel: '芯未達' });
  fs.writeFileSync('test-results/cr-config.json', JSON.stringify(cfg));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/cr-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/cr-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.click('[data-testid=measure-open]');
  const box = page.locator('[data-testid=measure]');
  await box.locator('[data-measure-kind=decay]').click();
  await box.locator('[data-measure-place="幹"]').click();
  await box.locator('[data-part="height.a"]').fill('1');
  await expect(box.locator('[data-testid=measure-unchosen]')).toContainText('芯達かどうかを選んでください');
  await expect(box.locator('[data-testid=measure-add]')).toBeDisabled();
  await box.locator('[data-part=core][data-v="0"]').click(); // 芯未達
  await expect(box.locator('[data-testid=measure-unchosen]')).toHaveCount(0);
  await expect(box.locator('[data-testid=measure-preview]')).toHaveText('幹の腐朽：地上1m');
  await box.locator('[data-testid=measure-add]').click();
  await expect(page.locator('[data-testid=measure-line]')).toHaveText(['幹の腐朽：地上1m']);

  // 枝の腐朽は選ばなくても追加できる（いつもの「芯達」のボタン1つ）
  await box.locator('[data-measure-place="枝"]').click();
  await box.locator('[data-part="height.a"]').fill('3');
  await expect(box.locator('[data-part=core][data-v="0"]')).toHaveCount(0);
  await expect(box.locator('[data-testid=measure-add]')).toBeEnabled();
});
