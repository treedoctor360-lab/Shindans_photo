// まとまり（路線）を現地で足す・番号を順に振る（設定 addGroups・numbering）
//  台帳を読み込まなくても、路線を足して1本目から入力できる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

// 見本の設定に、路線を足す・番号を振る指定を足したもの
function configFile() {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.extraFields = [
    { key: 'spread', label: '枝張り', unit: 'm', numeric: true },
    { key: 'clearWalk', label: '枝下高（歩道）', unit: 'm', numeric: true },
  ];
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }, { key: 'routeNo', label: '路線番号' }] };
  fs.mkdirSync('test-results', { recursive: true });
  const p = 'test-results/add-group-config.json';
  fs.writeFileSync(p, JSON.stringify(cfg));
  return p;
}

test('台帳なしで路線を足し、1から番号を振りながら入力できる', async ({ page }) => {
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', configFile());

  // 一覧：木が1本もないので、路線を足す欄が最初から開いている
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-testid=add-group-box]')).toBeVisible();
  await page.click('[data-testid=add-group-submit]');
  await expect(page.locator('[data-testid=add-group-error]')).toContainText('路線名を入れてください');
  await page.fill('#ag-routeName', '架空通り');
  await page.fill('#ag-routeNo', '7');
  await page.click('[data-testid=add-group-submit]');

  // 1本目：番号1が入っている
  await expect(page.locator('#f-treeNo')).toHaveValue('1');
  await page.fill('#f-species', 'テストノキ');
  // 設定で足した計測の欄（全角で入れても半角になる）
  await page.fill('#f-x-spread', '３．５');
  await page.locator('#f-x-spread').blur();
  await expect(page.locator('#f-x-spread')).toHaveValue('3.5');
  await page.click('[data-testid=save-and-add]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('.toast')).toContainText('保存しました');

  // 2本目：次の番号と、前の木の樹種が入っている
  await expect(page.locator('#f-treeNo')).toHaveValue('2');
  await expect(page.locator('#f-species')).toHaveValue('テストノキ');
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible();
  await page.click('[data-filter=all]');
  await expect(page.locator('[data-testid=tree-cards] .no')).toHaveText(['1', '2']);

  // 別の路線を足すと、また1から
  await page.click('[data-testid=add-group-open]');
  await page.fill('#ag-routeName', '別の通り');
  await page.click('[data-testid=add-group-submit]');
  await expect(page.locator('#f-treeNo')).toHaveValue('1');
  await expect(page.locator('#f-species')).toHaveValue('');

  // 読み込み直しても残っている（端末内に保存されている）
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible();
  await page.waitForTimeout(600); // まとめて保存する待ち時間より長く待つ
  await page.reload();
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('#s-group option')).toHaveCount(2);
  await page.selectOption('#s-group', { index: 0 });
  await page.click('[data-filter=all]');
  await page.locator('[data-testid=tree-cards] button', { hasText: 'テストノキ' }).first().click();
  await expect(page.locator('#f-x-spread')).toHaveValue('3.5'); // 足した欄の値も保存されている
});
