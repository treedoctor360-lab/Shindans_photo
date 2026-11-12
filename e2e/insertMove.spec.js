// 差し込み（この木の前に追加）・番号を並び順に振り直す・別の路線へ移す（架空の路線）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

function configFile() {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.addGroups = {
    siteType: 'street',
    label: '路線',
    fields: [{ key: 'routeName', label: '路線名' }],
    presets: [{ label: '試験の東通り', values: { routeName: '試験の東通り' } }],
  };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/insert-move-config.json', JSON.stringify(cfg));
  return 'test-results/insert-move-config.json';
}

const listNos = (page) => page.locator('.card[data-tree]').evaluateAll((els) => els.map((e) => e.dataset.tree || '空'));

test('1番の前に抜けていた木を入れて番号を振り直し、後ろの木を別の路線へ移す', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', configFile());
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の西通り');
  await page.click('[data-testid=add-group-submit]');
  // 1・2・3 を入れる（保存してもう1本追加）
  for (const n of ['1', '2', '3']) {
    await expect(page.locator('#f-treeNo')).toHaveValue(n);
    await page.fill('#f-species', 'テストノキ');
    await page.click(n === '3' ? '[data-testid=save-stay]' : '[data-testid=save-and-add]');
    await page.click('text=未入力のまま保存する');
  }
  // 1番の前に2本（抜けていた木）
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree="1"]');
  await page.click('[data-testid=add-before]');
  await expect(page.locator('#f-treeNo')).toHaveValue('');
  await page.fill('#f-species', 'マエノキ');
  await page.click('[data-testid=save-and-add]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('#f-treeNo')).toHaveValue('');
  await page.fill('#f-species', 'マエノキ');
  await page.click('[data-testid=save-stay]');
  await page.click('text=未入力のまま保存する');
  await page.click('.tab:has-text("一覧")');
  expect(await listNos(page)).toEqual(['空', '空', '1', '2', '3']);

  // 番号を並び順に振り直す：一覧を見せてから
  await page.click('[data-testid=renumber-open]');
  await expect(page.locator('[data-testid=renumber-list]')).toContainText('番号なし→1、番号なし→2、1→3、2→4、3→5');
  await page.click('[data-testid=renumber-apply]');
  await expect(page.locator('.toast')).toContainText('5本の番号を振り直しました');
  expect(await listNos(page)).toEqual(['1', '2', '3', '4', '5']);

  // 4 から後ろを別の路線（一覧から）へ移す
  await page.click('[data-tree="4"]');
  await page.click('[data-testid=move-open]');
  await page.selectOption('[data-testid=move-dest]', { label: '試験の東通り' });
  await page.click('[data-testid=move-rest]');
  await page.click('[data-testid=move-apply]');
  await expect(page.locator('.toast')).toContainText('2本を「試験の東通り」へ移しました');
  await page.click('.tab:has-text("一覧")');
  expect(await listNos(page)).toEqual(['1', '2']); // 移す先（東通り）の 1・2
  // 元の路線は 1〜3 が残る
  const west = await page.locator('#s-group option', { hasText: '試験の西通り' }).getAttribute('value');
  await page.selectOption('#s-group', west);
  expect(await listNos(page)).toEqual(['1', '2', '3']);
});
