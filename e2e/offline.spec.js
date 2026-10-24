// 一度開いたアプリは、電波がなくても開ける（サービスワーカー）。入力も端末に残る
import { expect, test } from '@playwright/test';

test('一度開けば、電波なしでも開けて、入力した内容も残っている', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready; // オフライン用の準備が終わるまで待つ
  });
  await page.reload(); // 2回目からはサービスワーカーが部品を保存する
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.waitForTimeout(600); // 端末への保存を待つ

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#s-insp')).toHaveValue('試験 二郎(資格)');
  await expect(page.locator('footer')).toContainText('Koh Kitsukawa');
});

test('ホーム画面に追加するための情報（マニフェスト）がある', async ({ page }) => {
  const res = await page.request.get('./manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.length).toBeGreaterThan(0);
});

test('【再発防止】アプリを新しくしても、同じドメインの別のアプリの保存は消さない（このアプリの古い保存だけ消す）', async ({ page }) => {
  await page.goto('./');
  // サービスワーカーが動き出す前に、別のアプリの保存と、このアプリの古い版の保存を作っておく
  await page.evaluate(async () => {
    await caches.open('other-app-v3');
    await caches.open('shindansphoto-v0');
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toEqual(expect.arrayContaining(['other-app-v3']));
  await expect.poll(async () => (await page.evaluate(() => caches.keys())).includes('shindansphoto-v0')).toBe(false);
});
