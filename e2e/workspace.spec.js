// 業務ごとの置き場所：台帳を読み込んだ業務のまま、名前の違う設定を読み込んでも、前の業務の木と混ざらない
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, data) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data));
  return p;
};

test('別の業務として使うと空から始まり、切り替えで前の業務の木に戻れる', async ({ page }) => {
  const ledger = tmp('ws-ledger.xlsx', await makeLedger());
  const cfgB = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfgB.job = { title: '架空の別業務', year: 2099 };
  cfgB.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }] };
  const fileB = tmp('ws-config-b.json', JSON.stringify(cfgB));

  // 最初の業務：台帳を読み込む
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', ledger);
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await expect(page.locator('[data-testid=workspaces]')).toHaveCount(0); // 業務が1つの間は出さない

  // 名前の違う設定を読み込む → どこに入れるか聞かれる
  await page.setInputFiles('[data-testid=config-file]', fileB);
  await expect(page.locator('[data-testid=workspace-ask]')).toContainText('架空の別業務');
  await page.click('[data-testid=workspace-new]');

  // 読み込み直して、新しい業務：木がなく、路線を足す欄が出る
  await expect(page.locator('[data-testid=config-status]')).toContainText('架空の別業務');
  await expect(page.locator('[data-testid=workspace-current]')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-testid=add-group-box]')).toBeVisible();
  await page.fill('#ag-routeName', '試験の新しい通り');
  await page.click('[data-testid=add-group-submit]');
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible();
  await page.waitForTimeout(600); // まとめて保存する待ち時間より長く待つ

  // 前の業務に戻る：台帳の木があり、足した路線は混ざっていない
  await page.click('.tab:has-text("設定")');
  await page.click('[data-testid=workspace-switch]');
  await expect(page.locator('[data-testid=config-status]')).toContainText(JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8')).job.title);
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('#s-group option', { hasText: '試験の新しい通り' })).toHaveCount(0);

  // もう一度別の業務へ：足した木が残っている
  await page.click('.tab:has-text("設定")');
  await page.click('[data-testid=workspace-switch]');
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-filter=all]');
  await expect(page.locator('[data-testid=tree-cards]')).toContainText('テストノキ');
});
