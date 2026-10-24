// 調査日をまとめて直す：設定の調査日を間違えて保存した木を、一覧画面からまとめて直す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('「調査日＋調査者」の組を選んで、調査日・調査者を直す', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/rd-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06'); // 間違えた日付
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/rd-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-testid=save-stay]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('AB002 を保存しました');

  // 保存ボタンの近くに、記録される調査日・調査者が出る（今日でなければ知らせる）
  await expect(page.locator('[data-testid=session-stamp]')).toContainText('調査日 2099/05/06・調査者 試験 二郎(資格)');
  await expect(page.locator('[data-testid=session-today]')).toBeVisible();

  await page.click('.tab:has-text("一覧")');
  await page.click('[data-testid=redate-open]');
  await page.selectOption('[data-testid=redate-from]', { label: '2099/05/06・試験 二郎(資格)（1本）' });
  await expect(page.locator('[data-testid=redate-trees] [data-tree-chip=AB002]')).toHaveClass(/on/);
  await expect(page.locator('[data-testid=redate-run]')).toBeDisabled(); // まだ何も変えていない
  await page.fill('[data-testid=redate-to]', '2099-05-05');
  await page.fill('[data-testid=redate-insp]', '試験 三子');
  await expect(page.locator('[data-testid=redate-preview]')).toContainText('直す木：1本');
  await page.click('[data-testid=redate-run]');
  await expect(page.locator('.toast')).toContainText('調査日 2099/05/06 → 2099/05/05、調査者 試験 二郎(資格) → 試験 三子 に直しました（1本）');

  const saved = await page.evaluate(
    () =>
      new Promise((ok) => {
        const req = indexedDB.open('shindans_photo');
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, 'readonly');
          const out = [];
          let left = names.length;
          for (const n of names) {
            const all = tx.objectStore(n).getAll();
            all.onsuccess = () => {
              out.push(JSON.stringify(all.result));
              if (--left === 0) ok(out.join('\n'));
            };
          }
        };
      }),
  );
  // 端末に保存された AB002 の記録：調査日・調査者が変わっている
  expect(saved).toMatch(/"treeNo":"AB002"[^{}]*"date":"2099-05-05","inspector":"試験 三子"/);
  // 直した後は、新しい組になる
  await page.click('[data-testid=redate-open]');
  await expect(page.locator('[data-testid=redate-from] option')).toContainText(['2099/05/05・試験 三子（1本）']);
});
