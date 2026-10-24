// 一覧表の健全度への書き戻し：詳しい診断の総合評価を、アプリで入力した木の健全度に書く。台帳の行は知らせるだけ
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import cfg from '../test/fixtures/sample-config.json' with { type: 'json' };
import { mergeLedger, readLedger } from '../src/excel/ledger.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

async function saveInitial(page) {
  await page.click('[data-testid=save-initial]');
  const ask = page.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(page.locator('.toast')).toContainText('保存しました');
}

test('総合評価を一覧表の健全度に書き、処置の違いと台帳の行を知らせる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', tmp('g-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();

  // AB002：簡易診断を「要」で保存 → 詳しい診断で総合評価 D・処置を入れる
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.fill('#f-height', '10');
  await page.click('[data-group=vigor] [data-v="並"]'); // 一覧表で入力済みと分かるように（読み直しの確認用）
  await page.click('[data-group=initialNeeded] [data-v="要"]');
  await page.click('text=保存して次の木へ');
  await page.click('text=未入力のまま保存する');
  await page.click('[data-testid=initial-prompt-go]');
  await page.click('[data-group=overall] [data-v="D"]');
  await page.fill('#i-treatment', '縮小剪定');
  await saveInitial(page);

  // AB001（台帳で入力済みの行）：詳しい診断で総合評価 C
  await page.click('[data-tree=AB001]');
  await page.click('[data-testid=open-initial]');
  await page.click('[data-group=overall] [data-v="C"]');
  await saveInitial(page);

  await page.click('.tab:has-text("出力")');
  const note = page.locator('[data-testid=grade-writeback]');
  await expect(note).toContainText('健全度に書く木：1本（AB002）');
  await expect(page.locator('[data-testid=treat-diff]')).toContainText('AB002：一覧表「（なし）」');
  await expect(page.locator('[data-testid=grade-ledger]')).toContainText('AB001＝C');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-db]')]);
  await expect(page.locator('.toast')).toContainText('検査OK');
  await expect(page.locator('.toast')).toContainText('健全度に書いた木1本');
  await expect(page.locator('.toast')).toContainText('台帳で入力済みの行に健全度だけ書いた木1本');
  const trees = mergeLedger([], (await readLedger(fs.readFileSync(await dl.path()), cfg)).rows, cfg).trees;
  expect(trees.find((t) => t.treeNo === 'AB002').grade).toBe('D');
  expect(trees.find((t) => t.treeNo === 'AB001' && t.siteType === 'park' && t.dupIndex === 1).grade).toBe('C'); // 紙から手で入力した行にも健全度だけ書く
  expect(trees.find((t) => t.treeNo === 'AB002').treatSel || []).not.toContain('縮小'); // 処置は書き換えない
});
