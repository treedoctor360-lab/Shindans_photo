// 文に出さない入力の数（周囲長／幹周など）：詳細の文には入れず、詳細の下に「入力した数」として見せる
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

test('周囲長／幹周を入れると、周囲長比が決まり、入れた数は詳細の下に見える（詳細の文には入れない）', async ({ page }) => {
  // 見本の設定に、周囲長比と、周囲長／幹周の欄を足したもの
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.initialSurvey.detailParts.circ = { type: 'pair', label: '周囲長／幹周', unit: 'cm', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3', to: 'ratio' } };
  cfg.initialSurvey.forms.initial.sections[1].items[0].parts.push('circ', 'ratio');
  const cfgPath = tmp('cn-config.json', JSON.stringify(cfg));

  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', cfgPath);
  await page.setInputFiles('[data-testid=ledger-file]', tmp('cn-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('cn-book.xlsx', await makeInitialBook()));
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');

  await page.click('[data-group=b4] [data-v="有（大）"]');
  const parts = page.locator('[data-parts=b4Detail]');
  await parts.locator('[data-part="height.a"]').fill('2');
  await parts.locator('[data-part="circ.a"]').fill('13');
  await parts.locator('[data-part="circ.b"]').fill('80');
  await expect(parts.locator('[data-auto=circ]')).toHaveText('計算では＜1/3');
  await expect(page.locator('#i-b4Detail')).toHaveValue('地上2m、周囲長比＜1/3');
  await expect(page.locator('[data-check=b4Detail]')).toContainText('入力した数：【13cm/80cm】');
});
