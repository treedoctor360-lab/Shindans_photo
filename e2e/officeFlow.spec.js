// 内勤の流れ：入力表（Excel）を読み込む → 写真を入れて木ごとに区切り、貼る写真を選ぶ → 写真つきのカルテを出力する
//  （設定 entrySheet・karte.photos・karte.unconfirmedOk。架空の様式・架空の木・塗りつぶしただけの絵）
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { files } from './officeFiles.js';

test('入力表を読み込み、写真を木ごとに区切って選び、写真つきのカルテを出力できる', async ({ page }) => {
  const photos = await files();
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/office-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=karte-template-file]', 'test-results/office-template.xlsx');
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();

  // 入力表を読み込む：3本。読み取れない備考のある3番は入力中のまま
  await page.setInputFiles('[data-testid=entry-sheet-file]', 'test-results/office-entry.xlsx');
  await expect(page.locator('.toast')).toContainText('3本を読み込みました（うち1本は確かめてください）');
  await expect(page.locator('[data-testid=entry-sheet-result]')).toContainText('路線1 3：備考の読み取れなかった部分：なぞの書き込み');
  // 読み直し：今の設定では新しく読める所がない（読み方を足した設定で読み直すと読める。test/entrySheet.test.js）
  await expect(page.locator('[data-testid=reread-open]')).toContainText('（1本）');
  await page.click('[data-testid=reread-open]');
  await expect(page.locator('.toast')).toContainText('今の設定で新しく読める所はありませんでした');

  // 一覧の「入力表で止まった木」で3番だけが出る。開くと、読み取れなかった備考が出る。確かめて知らせを消す
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-filter=entry]');
  await expect(page.locator('[data-testid=tree-cards] .card')).toHaveCount(1);
  await expect(page.locator('[data-testid=tree-cards] .card[data-tree="3"] [data-testid=card-entry-stuck]')).toBeVisible();
  await page.locator('[data-testid=tree-cards] .card[data-tree="3"]').click();
  await expect(page.locator('[data-testid=entry-left]')).toContainText('なぞの書き込み');
  await page.click('[data-testid=entry-left-clear]');
  await expect(page.locator('[data-testid=entry-left]')).toHaveCount(0);

  // 写真：5枚を入れ、番号の写真を2枚選ぶ
  await page.click('.tab:has-text("写真")');
  await page.setInputFiles('[data-testid=kp-files]', photos);
  await expect(page.locator('.toast')).toContainText('5枚を入れました');
  await page.locator('[data-testid="kp-office-n1.png"] .kp-img').click();
  await page.locator('[data-testid="kp-office-n2.png"] .kp-img').click();
  await expect(page.locator('[data-testid="kp-office-n2.png"] .kp-badge')).toHaveText('No.2');
  // 貼る写真を選ぶ：1番は縦の写真（a1）が全景に入っている。横の写真（a2）を押すと写真1に入る
  await page.click('[data-testid=kp-mode-pick]');
  const t1 = page.locator('[data-testid=kp-tree-1]');
  await expect(t1.locator('[data-testid="kp-office-a1.png"] .kp-badge')).toHaveText('全景');
  await t1.locator('[data-testid="kp-office-a2.png"] .kp-img').click();
  await expect(t1.locator('[data-testid="kp-office-a2.png"] .kp-badge')).toHaveText('写真1');
  await page.fill('[data-testid=kp-caption-1-p1]', '架空の見出し');

  // 画面を読み込み直しても、選んだ内容は残る
  await page.reload();
  await page.click('.tab:has-text("写真")');
  await expect(page.locator('[data-testid=kp-tree-1] [data-testid="kp-office-a2.png"] .kp-badge')).toHaveText('写真1');

  // 出力：確定していなくても出せる。写真は1番に2枚（2番は横の写真だけなので、全景は入らない）
  //  3番は入力中なので、出力の前に番号を見せて聞く →「入力済みだけ出力」
  await page.click('.tab:has-text("出力")');
  await page.click('[data-testid=export-simple-karte]');
  await expect(page.locator('[data-testid=karte-todo]')).toContainText('3は入力中です（1本）。入力中の木も出力しますか？');
  await expect(page.locator('[data-testid=karte-todo-list]')).toContainText('3：');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=karte-done-only]')]);
  await expect(page.locator('.toast')).toContainText('写真2枚を1本に貼りました');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  expect(wb.worksheets.map((w) => w.name)).toEqual(['1', '2', '選択肢']);
  expect(wb.getWorksheet('1').getImages()).toHaveLength(2);
  expect(wb.getWorksheet('2').getImages()).toHaveLength(0);
  expect(wb.getWorksheet('1').getCell('A12').value).toBe('架空の見出し');
  expect(wb.getWorksheet('1').getCell('C9').value).toBe('根が幹を締め付けている。');
  expect(wb.getWorksheet('1').getCell('C2').value).toEqual(new Date(Date.UTC(2099, 4, 6)));

  // 「入力中の木も含めて出力」なら3番も入る
  await page.click('[data-testid=export-simple-karte]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=karte-with-todo]')]);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(await dl2.path());
  expect(wb2.worksheets.map((w) => w.name)).toEqual(['1', '2', '3', '選択肢']);
});
