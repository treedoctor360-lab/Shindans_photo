// 写真の画面：間違えて入れた写真をまとめて外す・選んでいる木の情報を横に出す（架空の設定・架空の木・塗りつぶしただけの絵）
import { expect, test } from '@playwright/test';
import { files } from './officeFiles.js';

async function setup(page) {
  const photos = await files();
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/office-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=karte-template-file]', 'test-results/office-template.xlsx');
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=entry-sheet-file]', 'test-results/office-entry.xlsx');
  await expect(page.locator('.toast')).toContainText('3本を読み込みました');
  await page.click('.tab:has-text("写真")');
  await page.setInputFiles('[data-testid=kp-files]', photos);
  await expect(page.locator('.toast')).toContainText('5枚を入れました');
  return photos;
}
const item = (page, name) => page.locator(`[data-testid="kp-office-${name}.png"]`);

test('写真を選んでまとめて外せる（Shift で範囲を選ぶ）', async ({ page }) => {
  const photos = await setup(page);
  await page.click('[data-testid=kp-sel-start]');
  await item(page, 'a1').locator('.kp-img').click();
  await item(page, 'n2').locator('.kp-img').click({ modifiers: ['Shift'] }); // a1 から n2 まで（a1・a2・n2）
  await expect(page.locator('[data-testid=kp-sel-remove]')).toHaveText('選んだ3枚を外す');
  // 選んでいる間は、押しても番号の写真にならない
  await expect(page.locator('.kp-item.on')).toHaveCount(0);
  page.once('dialog', (d) => d.accept());
  await page.click('[data-testid=kp-sel-remove]');
  await expect(page.locator('.toast')).toContainText('3枚を外しました');
  await expect(page.locator('.kp-item')).toHaveCount(2);
  await expect(item(page, 'n1')).toBeVisible();
  await expect(item(page, 'b1')).toBeVisible();
  await expect(page.locator('[data-testid=kp-selbar]')).toHaveCount(0);

  // すべて選ぶ → やめると何も外れない
  await page.click('[data-testid=kp-sel-start]');
  await page.click('[data-testid=kp-sel-all]');
  await expect(page.locator('[data-testid=kp-sel-remove]')).toHaveText('選んだ2枚を外す');
  await page.click('[data-testid=kp-sel-end]');
  await expect(page.locator('.kp-item')).toHaveCount(2);

  // 外した写真はもう一度入れられ、読み込み直しても外したまま
  await page.reload();
  await page.click('.tab:has-text("写真")');
  await expect(page.locator('.kp-item')).toHaveCount(2);
  await page.setInputFiles('[data-testid=kp-files]', photos);
  await expect(page.locator('.toast')).toContainText('3枚を入れました');
  await expect(page.locator('.kp-item')).toHaveCount(5);
});

test('貼る写真を選ぶとき、選んでいる木の入力内容とカルテを横に出せる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await item(page, 'n1').locator('.kp-img').click();
  await item(page, 'n2').locator('.kp-img').click();
  await page.click('[data-testid=kp-mode-pick]');
  await expect(page.locator('[data-testid=kp-info]')).toHaveCount(0);

  // 写真を押すと、その木の情報が横に出る
  await page.locator('[data-testid=kp-tree-1] [data-testid="kp-office-a2.png"] .kp-img').click();
  const info = page.locator('[data-testid=kp-info]');
  await expect(info).toContainText('No.1');
  await expect(info).toContainText('根が幹を締め付けている。');
  // 横に並ぶ（一覧の右）
  const l = await page.locator('[data-testid=kp-tree-1]').boundingBox();
  const r = await info.boundingBox();
  expect(r.x).toBeGreaterThan(l.x + l.width - 1);
  // 木の一覧を途中までスクロールしても、上の帯の下に見えている（上の帯に隠れない）・下のタブにも重ならない
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid=kp-tree-1]').getBoundingClientRect().top + window.scrollY - 60));
  await page.waitForTimeout(200);
  const top = await page.locator('.top').boundingBox();
  const r2 = await info.boundingBox();
  expect(r2.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
  expect(r2.y + r2.height).toBeLessThanOrEqual((await page.locator('.tabs').boundingBox()).y + 1);
  await page.setViewportSize({ width: 1280, height: 900 });

  // カルテの形でも見られる
  await page.click('[data-testid=kp-info-karte]');
  await expect(info.locator('[data-testid=kv-table]')).toBeVisible();
  await expect(info.locator('[data-testid=kv-close]')).toHaveCount(0);
  await expect(info.locator('[data-testid=kv-table]')).toContainText('根が幹を締め付けている。');

  // 別の木を押すと、その木に変わる（入力内容に戻る）
  await page.locator('[data-testid=kp-tree-2] [data-testid="kp-office-b1.png"] .kp-img').click();
  await expect(info).toContainText('No.2');
  await expect(info).not.toContainText('根が幹を締め付けている。');

  // 隠す → 「この木の情報」でまた出る
  await page.click('[data-testid=kp-info-close]');
  await expect(info).toHaveCount(0);
  await page.click('[data-testid=kp-info-1]');
  await expect(info).toContainText('No.1');
});

test('狭い画面では、木の情報を画面の下半分に出す', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await setup(page);
  await item(page, 'n1').locator('.kp-img').click();
  await page.click('[data-testid=kp-mode-pick]');
  await page.click('[data-testid=kp-info-1]');
  const r = await page.locator('[data-testid=kp-info]').boundingBox();
  expect(r.height).toBeGreaterThan(300);
  expect(r.y).toBeGreaterThan(300);
  // 下のタブは隠れない
  const tabs = await page.locator('.tabs').boundingBox();
  expect(r.y + r.height).toBeLessThanOrEqual(tabs.y + 1);
});
