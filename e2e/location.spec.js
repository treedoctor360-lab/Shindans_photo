// 木の位置（設定 location）：保存のときに GPS の位置を入れる・地図で直す・路線の位置図
//  GPS は Playwright の擬似の現在地。地図の背景の画像は読みに行かない（外のサイトに頼らない）
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const HERE = { latitude: 34.5, longitude: 135.25, accuracy: 10 };
test.use({ geolocation: HERE, permissions: ['geolocation'] });

function configFile() {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }] };
  cfg.location = { auto: true, tiles: [{ label: '架空の地図', url: 'https://tiles.example.invalid/{z}/{x}/{y}.png', attribution: '架空の出典' }] };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/location-config.json', JSON.stringify(cfg));
  return 'test-results/location-config.json';
}

test('保存のときに現在地を入れ、地図で直し、位置図に番号で出る', async ({ page }) => {
  await page.route('https://tiles.example.invalid/**', (r) => r.abort());
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', configFile());
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の新しい通り');
  await page.click('[data-testid=add-group-submit]');

  // 1本目：GPS を待ってから保存 → 位置が入る
  await expect(page.locator('[data-testid=location]')).toContainText('いまの精度 ±10m');
  await expect(page.locator('[data-testid=loc-text]')).toContainText('まだ記録していません');
  await page.fill('#f-species', 'テストノキ');
  await page.click('[data-testid=save-and-add]');
  await page.click('text=未入力のまま保存する');
  // 2本目：自動で入れない端末にしてから保存 → 位置なし。「現在地を入れる」で入る
  await expect(page.locator('#f-treeNo')).toHaveValue('2');
  await page.uncheck('[data-testid=loc-auto]');
  await page.click('[data-testid=save-stay]');
  await page.click('text=未入力のまま保存する');
  await expect(page.locator('[data-testid=loc-text]')).toContainText('まだ記録していません');
  await page.click('[data-testid=loc-here]');
  await expect(page.locator('[data-testid=loc-text]')).toHaveText('34.500000, 135.250000（GPS ±10m）');

  // 地図で直す：地図の右下の方を押すとピンが移る →「この位置にする」
  await page.click('[data-testid=loc-map]');
  const box = page.locator('[data-testid=map-box]');
  await expect(box.locator('.map-no.cur')).toHaveText('2');
  await expect(box.locator('.map-no:not(.cur)')).toHaveText(['1']); // 同じ路線のほかの木
  await expect(page.locator('.leaflet-control-attribution')).toContainText('架空の出典'); // 出典はいつも出す
  const b = await box.boundingBox();
  await page.mouse.click(b.x + b.width * 0.8, b.y + b.height * 0.8);
  await expect(page.locator('[data-testid=map-pos]')).not.toHaveText('34.500000, 135.250000');
  await page.click('[data-testid=map-ok]');
  await expect(page.locator('[data-testid=map-picker]')).toHaveCount(0);
  await expect(page.locator('[data-testid=loc-text]')).toContainText('地図で置いた位置');
  const t2 = await page.locator('[data-testid=loc-text]').textContent();
  const [lat2, lng2] = t2.split('（')[0].split(', ').map(Number);
  expect(lat2).toBeLessThan(34.5); // 下（南）を押した
  expect(lng2).toBeGreaterThan(135.25); // 右（東）を押した
  await page.click('[data-testid=save-stay]');

  // 1本目に戻ると、保存のときの GPS の位置が入っている
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree="1"]');
  await expect(page.locator('[data-testid=loc-text]')).toHaveText('34.500000, 135.250000（GPS ±10m）');

  // 位置図：2本とも番号で出る
  await page.click('.tab:has-text("出力")');
  await expect(page.locator('[data-testid=open-route-map]')).toContainText('位置のある木 2本／2本');
  await page.click('[data-testid=open-route-map]');
  const map = page.locator('[data-testid=route-map]');
  await expect(map.locator('.map-no')).toHaveText(['1', '2']);
  await expect(map).toContainText('位置のある木 2本／2本');
  // 印刷のときは位置図だけを出す（ほかの画面・ボタンは出さない）
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.tabs')).toBeHidden();
  await expect(page.locator('[data-testid=route-map-print]')).toBeHidden();
  await expect(map.locator('.map-no')).toHaveCount(2);
  await page.emulateMedia({ media: 'screen' });
  await page.click('[data-testid=route-map-close]');
  await expect(map).toHaveCount(0);
});
