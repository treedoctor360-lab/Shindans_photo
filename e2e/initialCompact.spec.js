// 詳しい診断の画面：数・1行の文字は2列、選択肢は1行に詰める。枝下高などは空欄なら保存時に「-」
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

test('設定の row で横に並び、選択肢は長さで並べ方が変わる。空欄の枝下高は保存すると「-」になる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('c-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');

  // 樹高・幹周は設定の row で横に並ぶ
  await expect(page.locator('.grid2 [data-item=height]')).toBeVisible();
  await expect(page.locator('[data-item=clearWalk].inline')).toBeVisible(); // 組（row）のない項目は1行に見出しと入力
  const h = await page.locator('[data-item=height]').boundingBox();
  const g = await page.locator('[data-item=girth]').boundingBox();
  expect(Math.abs(h.y - g.y)).toBeLessThan(2); // 横に並ぶ
  // 選択肢が長い項目（有（安全）など）は、見出しの下にボタン。短い項目（無／有）は見出しの右
  const lean = page.locator('[data-item=lean]');
  const lb = await lean.locator('.lbl').boundingBox();
  const bb = await lean.locator('.seg').boundingBox();
  expect(bb.y).toBeGreaterThan(lb.y + lb.height - 1);
  await page.click('[data-form=environment]');
  const w = page.locator('[data-item=weather]');
  const wl = await w.locator('.lbl').boundingBox();
  const wb = await w.locator('.seg').boundingBox();
  expect(wb.x).toBeGreaterThan(wl.x + wl.width - 1);
  await page.click('[data-form=initial]');

  // 枝下高：数のキーボード・単位 m・空欄なら「-」
  await expect(page.locator('#i-clearWalk')).toHaveAttribute('inputmode', 'decimal');
  await expect(page.locator('[data-item=clearWalk] .unit span')).toHaveText('m');
  await expect(page.locator('#i-clearWalk')).toHaveAttribute('placeholder', '空欄なら -');
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await expect(page.locator('#i-clearWalk')).toHaveValue('-');
});
