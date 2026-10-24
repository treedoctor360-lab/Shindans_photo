// 選んだ木が見つからないとき、別の木を黙って開かない（別の木を書き換える事故の再発防止）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('【再発防止】開いていた木が見つからないときは、最初の木を開かずに一覧から始める。調べるためのデータを書き出せる', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/m-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/m-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.waitForTimeout(500);

  // 端末の状態を「見つからない木を選んで入力画面」にして開き直す
  await page.evaluate(
    () =>
      new Promise((ok) => {
        const rq = indexedDB.open('shindans_photo');
        rq.onsuccess = () => {
          const db = rq.result;
          const store = db.objectStoreNames[0];
          const tx = db.transaction(store, 'readwrite');
          const os = tx.objectStore(store);
          const g = os.get('state');
          g.onsuccess = () => os.put({ ...g.result, currentId: 'みつからない木', view: 'form' }, 'state');
          tx.oncomplete = () => ok();
        };
      }),
  );
  await page.reload();
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible(); // 一覧から始まる
  await expect(page.locator('#f-treeNo')).toHaveCount(0); // 別の木の入力画面は出さない

  // 調べるためのデータ
  await page.click('.tab:has-text("設定")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=diagnostic]')]);
  const d = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(d.kind).toBe('shindans-photo-diagnostic');
  expect(d.state.trees.length).toBeGreaterThan(0);
});

test('公園・路線を切り替えてから「入力」を押すと、切り替えた先の未入力の木が開く（止まらない）', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/m2-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/m2-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await expect(page.locator('#f-treeNo')).toHaveValue('AB002');
  // 別の公園に切り替えて「入力」
  await page.click('.tab:has-text("一覧")');
  const other = await page.locator('#s-group option', { hasText: '別の架空公園' }).getAttribute('value');
  await page.selectOption('#s-group', other);
  await page.click('.tab:has-text("入力")');
  await expect(page.locator('[data-testid=tree-missing]')).toHaveCount(0);
  await expect(page.locator('#f-treeNo')).toHaveValue('AB001');
});
