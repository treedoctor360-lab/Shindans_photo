// 簡易診断の特記事項：数字を入れるだけで、寸法（腐朽・鋼棒貫入など）の1行を足す
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

test('寸法を入れる：部位・種類を選んで数字を入れ、特記事項に1行ずつ足す（2か所目も）', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/nm-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/nm-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  await page.click('[data-testid=note-chips] .chip:has-text("枝の偏り")');
  await page.click('[data-testid=measure-open]');
  const box = page.locator('[data-testid=measure]');
  // 種類・部位を選ぶまでは足せない
  await expect(box.locator('[data-testid=measure-add]')).toBeDisabled();
  await box.locator('[data-measure-kind=decay]').click();
  await box.locator('[data-measure-place="幹"]').click();
  // 数字の欄は数字のキーボード
  await expect(box.locator('[data-part="height.a"]')).toHaveAttribute('inputmode', 'decimal');
  await box.locator('[data-part="height.a"]').fill('２');
  await box.locator('[data-part="size.0.w"]').fill('20');
  await box.locator('[data-part="size.0.h"]').fill('50');
  await box.locator('[data-part="circ.a"]').fill('110');
  await box.locator('[data-part="circ.b"]').fill('150');
  await expect(box.locator('[data-auto=circ]')).toHaveText('計算では≧1/3'); // 周囲長比の目安
  await box.locator('[data-part=core]').click();
  await expect(box.locator('[data-testid=measure-preview]')).toHaveText('幹の腐朽：地上2m、20cm×50cm、110/150（芯達）');
  await box.locator('[data-testid=measure-add]').click();
  await expect(page.locator('#f-notes')).toHaveValue('・枝の偏り\n・幹の腐朽：地上2m、20cm×50cm、110/150（芯達）');

  // 続けて2つ目（数字は空に戻る。種類を変えると欄も変わる）
  await expect(box.locator('[data-part="height.a"]')).toHaveValue('');
  await box.locator('[data-measure-kind=rod]').click();
  await box.locator('[data-measure-place="根株"]').click();
  await box.locator('[data-part="rod.a"]').fill('29');
  // 周囲長を入れると直径を計算して入れる（157÷3.14＝50）。貫入深が半径以上なので芯達が自動で付く
  await box.locator('[data-part="rod.c"]').fill('157');
  await expect(box.locator('[data-part="rod.b"]')).toHaveValue('50');
  await expect(box.locator('[data-auto=core]')).toHaveText('計算では芯達');
  await expect(box.locator('[data-part=core]')).toHaveAttribute('aria-pressed', 'true');
  await box.locator('[data-testid=measure-add]').click();
  await expect(page.locator('#f-notes')).toHaveValue('・枝の偏り\n・幹の腐朽：地上2m、20cm×50cm、110/150（芯達）\n・根株の鋼棒貫入：29cm/50cm（芯達）');
  // 半径に届かなければ印は外れる。直径を手で入れても計算する
  await box.locator('[data-measure-kind=rod]').click();
  await box.locator('[data-part="rod.a"]').fill('10');
  await box.locator('[data-part="rod.b"]').fill('50');
  await expect(box.locator('[data-auto=core]')).toHaveText('計算では未達');
  await expect(box.locator('[data-testid=measure-preview]')).toHaveText('根株の鋼棒貫入：10cm/50cm');
  // 一覧表用の特記には入らない（寸法は入れない決まり）
  await expect(page.locator('#f-dbnote')).not.toHaveValue(/腐朽|鋼棒/);

  // 閉じて開き直しても、特記事項はそのまま
  await page.click('[data-testid=measure-close]');
  await expect(box).toHaveCount(0);
});

test('枯れ枝の本数の欄は、数字のキーボードを出す', async ({ page }) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/nm2-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/nm2-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');
  await page.locator('[data-group=deadBranch] [data-v="有"]').click();
  await expect(page.locator('#f-deadBranchCount')).toHaveAttribute('inputmode', 'numeric');
});
