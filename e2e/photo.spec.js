// 写真（試作）：スマホで撮る → 端末に残る（開き直しても）→ 撮り直し → サーバーへ → 事務所の PC で ZIP（フォルダ分け・検査つき）
// サーバーは「にせの Google」（test/helpers/fakeGas.js）で gas/Code.js をそのまま動かす。写真は単色の PNG で代わりにする
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import JSZip from 'jszip';
import { makeFakeGas } from '../test/helpers/fakeGas.js';
import { makeLedger } from '../test/helpers/makeLedger.js';
import { makeTemplate } from '../test/helpers/makeTemplate.js';
import { makePng } from '../test/helpers/makePng.js';

const URL_ = 'https://example.invalid/macros/s/xxx/exec';
const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};
async function connect(page, gas, net = { online: true }) {
  await page.route(`${URL_}*`, async (route) => {
    if (!net.online) return route.abort('internetdisconnected');
    const res = await gas.fetchFn(URL_, { body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await res.json()) });
  });
}
const png = (name, w, h, color) => ({ name, mimeType: 'image/png', buffer: makePng(w, h, color) });

test('撮った写真は端末に残り、撮り直しても前の写真を消さず、サーバーを通して事務所で ZIP に出せる', async ({ browser }) => {
  const gas = makeFakeGas();
  const office = await (await browser.newContext()).newPage();
  await connect(office, gas);
  await office.goto('./');
  await office.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await office.setInputFiles('[data-testid=template-file]', tmp('p-template.xlsx', await makeTemplate()));
  await office.setInputFiles('[data-testid=ledger-file]', tmp('p-ledger.xlsx', await makeLedger()));
  await expect(office.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await office.fill('#s-url', URL_);
  await office.fill('#s-pass', 'ひみつ');
  await office.click('[data-testid=role-office]');
  await office.click('[data-testid=server-put]');
  await office.click('[data-testid=server-put-ok]');
  await expect(office.locator('.toast')).toContainText('サーバーに置きました');

  // スマホ：受け取って入力（電波なし）
  const net = { online: true };
  const phone = await (await browser.newContext()).newPage();
  await connect(phone, gas, net);
  await phone.goto('./');
  await phone.fill('#s-date', '2099-05-06');
  await phone.fill('#s-insp', '試験 二郎(資格)');
  await phone.fill('#s-url', URL_);
  await phone.fill('#s-pass', 'ひみつ');
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('受け取りました');
  net.online = false;

  await phone.click('.tab:has-text("一覧")');
  await phone.click('[data-tree=AB002]');
  await phone.fill('#f-height', '10');
  await phone.fill('#f-girth0', '0.5');
  for (const [g, v] of [['vigor', '並'], ['lean', '無'], ['deadBranch', '有'], ['decay', '無'], ['fungus', '無'], ['initialNeeded', '否'], ['grade', 'B']])
    await phone.click(`[data-group=${g}] [data-v="${v}"]`);
  await phone.fill('#f-deadBranchCount', '2');

  // 撮る写真の枠：全景（縦）・枯れ枝（横）
  await expect(phone.locator('[data-testid=photo-shots] .shot')).toHaveCount(2);
  await expect(phone.locator('[data-testid=shot-progress]')).toContainText('0／2');
  await phone.setInputFiles('[data-shot=full]', png('a.png', 900, 1200, [20, 120, 40]));
  await expect(phone.locator('.toast')).toContainText('全景を保存しました');
  await expect(phone.locator('[data-slot=full] [data-testid=shot-thumb]')).toBeVisible();
  await expect(phone.locator('[data-slot=full] .shot-name')).toHaveText('AB002全景990506.jpg');
  // 枯れ枝を縦で撮った → 向きの知らせ（保存はする）
  await phone.setInputFiles('[data-shot="w:枯れ枝"]', png('b.png', 900, 1200, [120, 60, 20]));
  await expect(phone.locator('.toast')).toContainText('横向きの決まり');
  // 撮り直し（横）
  await phone.setInputFiles('[data-shot="w:枯れ枝"]', png('c.png', 1600, 1200, [200, 60, 20]));
  await expect(phone.locator('[data-testid=shot-progress]')).toContainText('2／2');
  await expect(phone.locator('[data-slot="w:枯れ枝"] [data-testid=shot-send]')).toHaveText('未送信');
  await phone.click('text=保存して次の木へ');

  // 開き直しても写真は残っている（端末に保存済み）
  await phone.reload();
  await phone.click('.tab:has-text("一覧")');
  await expect(phone.locator('[data-tree=AB002] [data-testid=card-photo]')).toHaveText('写真 2/2');
  await phone.click('[data-tree=AB002]');
  await expect(phone.locator('[data-slot=full] [data-testid=shot-thumb] img')).toBeVisible();
  // 大きく見る：決まりの大きさ（縦 480×640）
  await phone.click('[data-slot=full] [data-testid=shot-thumb]');
  await expect(phone.locator('[data-testid=shot-view]')).toContainText('480×640');
  await phone.click('[data-testid=shot-view]');

  // 電波が戻った → 入力と写真を送る（撮り直す前の写真も送る。消さない）
  net.online = true;
  await phone.click('.tab:has-text("出力")');
  await phone.click('[data-testid=sync]');
  await expect(phone.locator('[data-testid=photo-status]')).toContainText('未送信 0枚');
  const rows = gas.sheets.get('photos').cells.slice(1);
  expect(rows).toHaveLength(3);
  expect(rows.filter((r) => r[5] === '1')).toHaveLength(1);
  // 送った後も、端末に本体が残っている（空きが足りなくなるまで外さない）
  await phone.click('.tab:has-text("一覧")');
  await phone.click('[data-tree=AB002]');
  await expect(phone.locator('[data-slot=full] [data-testid=shot-send]')).toHaveText('送信済み');

  // 事務所の PC：受け取って、写真を見て、ZIP に出す
  await office.click('.tab:has-text("出力")');
  await office.click('[data-testid=sync]');
  await expect(office.locator('[data-testid=photo-status]')).toContainText('撮った写真 2枚');
  await office.click('.tab:has-text("一覧")');
  await office.click('[data-tree=AB002]');
  await office.click('[data-slot=full] [data-testid=shot-remote]'); // この端末にはないのでサーバーから
  await expect(office.locator('[data-testid=shot-view]')).toBeVisible();
  await office.click('[data-testid=shot-view]');
  await expect(office.locator('[data-shot=full]')).toHaveCount(0); // 事務の端末では撮れない
  await office.click('.tab:has-text("出力")');
  const [dl] = await Promise.all([office.waitForEvent('download'), office.click('[data-testid=photo-zip]')]);
  await expect(office.locator('[data-testid=photo-report]')).toContainText('検査して保存しました');
  const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  expect(names).toHaveLength(2);
  expect(names.every((n) => /^写真\/[^/]+\/AB002(全景|枯れ枝)990506\.jpg$/.test(n))).toBe(true);
  expect(dl.suggestedFilename()).toMatch(/^写真_.+\.zip$/);
});
