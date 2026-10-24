// 詳しい診断（初期診断など）の入力：簡易診断を保存 →「続けて入力」→ 引き継ぎ・ブックの選択肢・すべて無・詳細 → 保存
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

test('簡易診断で「必要」にして保存すると続けて入力でき、引き継ぎ・選択肢・すべて無・詳細を入れて保存できる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('f-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('f-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();

  // 簡易診断：AB002 を「必要」にして保存
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '10');
  await page.fill('#f-girth0', '0.5');
  await page.click('[data-group=lean] [data-v="有"]');
  await page.click('[data-group=initialNeeded] [data-v="要"]');
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');

  // 次の木の画面に「続けて入力」
  await expect(page.locator('[data-testid=initial-prompt]')).toContainText('AB002');
  await page.click('[data-testid=initial-prompt-go]');
  await expect(page.locator('[data-testid=initial-tree]')).toContainText('AB002');

  // 引き継ぎ：樹高・幹周・傾斜（言い換え）
  await expect(page.locator('#i-height')).toHaveValue('10');
  await expect(page.locator('[data-item=height] .tag.prev')).toHaveText('簡易から');
  await expect(page.locator('[data-group=lean] [data-v="有（危険）"]')).toHaveAttribute('aria-pressed', 'true');

  // 選択肢はブックの入力規則から。「有」なら詳細を入れる
  await page.click('[data-group=b4] [data-v="有（小）"]');
  await page.fill('#i-b4Detail', '1本、地上3m');

  // 周りの環境：すべて無（選んである項目は変えない）
  await page.click('[data-form=environment]');
  await page.click('[data-group=weather] [data-v="有"]');
  await page.click('[data-testid=none-0]');
  await expect(page.locator('[data-group=weather] [data-v="有"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-group=stake] [data-v="無"]')).toHaveAttribute('aria-pressed', 'true');
  // 任意記入（設定 free）の項目：選択肢にない値を書ける。選択肢を押すと書いた値は消える
  await page.fill('[data-free=stake]', '自由に書いた値');
  await expect(page.locator('[data-group=stake] [aria-pressed=true]')).toHaveCount(0);
  await page.click('[data-group=stake] [data-v="無"]');
  await expect(page.locator('[data-free=stake]')).toHaveValue('');

  // 保存（この木のまま）：保存しても同じ木の画面のまま（一覧へ戻らない）
  await page.click('[data-testid=save-initial-stay]');
  await expect(page.locator('.toast')).toContainText('保存しました');
  await expect(page.locator('[data-testid=initial-view]')).toBeVisible();
  await expect(page.locator('[data-testid=tree-bar]')).toContainText('入力済み');
  await expect(page.locator('[data-free=stake]')).toBeVisible();

  await page.click('[data-testid=save-initial]');
  await expect(page.locator('.toast')).toContainText('保存しました');

  // 一覧：進み具合が「入力済み」。もう一度開くと値が残っている
  await page.click('.chip:has-text("詳しい診断待ち")');
  await expect(page.locator('[data-tree=AB002] [data-initial]')).toHaveAttribute('data-initial', 'done');
  await page.click('[data-tree=AB002]');
  await page.click('[data-testid=open-initial]');
  await expect(page.locator('#i-b4Detail')).toHaveValue('1本、地上3m');
});
