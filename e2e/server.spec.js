// サーバーを通した流れ：事務所 PC が設定・原本・台帳を置く → スマホが受け取って入力・自動送信 → 事務所 PC が受け取って出力
// サーバーは「にせの Google」（test/helpers/fakeGas.js）で gas/Code.js をそのまま動かす
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { makeFakeGas } from '../test/helpers/fakeGas.js';
import { makeLedger } from '../test/helpers/makeLedger.js';
import { makeTemplate } from '../test/helpers/makeTemplate.js';

const URL_ = 'https://example.invalid/macros/s/xxx/exec';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

// ページからのサーバー宛ての通信を、にせの Google に回す。online=false の間は通信を失敗させる
async function connect(page, gas, net = { online: true }) {
  await page.route(`${URL_}*`, async (route) => {
    if (!net.online) return route.abort('internetdisconnected');
    const res = await gas.fetchFn(URL_, { body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await res.json()) });
  });
}

async function setServer(page) {
  await page.fill('#s-url', URL_);
  await page.fill('#s-pass', 'ひみつ');
}

test('事務所 → スマホ → 事務所（送信が一度失敗しても、電波が戻れば送り直す）', async ({ browser }) => {
  const gas = makeFakeGas();

  // 事務所の PC：読み込んでサーバーに置く
  const office = await (await browser.newContext()).newPage();
  await connect(office, gas);
  await office.goto('./');
  await office.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await expect(office.locator('[data-testid=config-status] .ok')).toBeVisible();
  await office.setInputFiles('[data-testid=template-file]', tmp('s-template.xlsx', await makeTemplate()));
  await office.setInputFiles('[data-testid=ledger-file]', tmp('s-ledger.xlsx', await makeLedger()));
  await expect(office.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await setServer(office);
  await office.click('[data-testid=role-office]'); // サーバーに置くのは事務の端末だけ
  await office.click('[data-testid=server-put]');
  await office.click('[data-testid=server-put-ok]');
  await expect(office.locator('.toast')).toContainText('サーバーに置きました（設定・原本・台帳）');

  // スマホ：受け取って入力（最初は電波なし）
  const net = { online: false };
  const phoneCtx = await browser.newContext();
  const phone = await phoneCtx.newPage();
  await connect(phone, gas, net);
  await phone.goto('./');
  await phone.fill('#s-date', '2099-05-06');
  await phone.fill('#s-insp', '試験 二郎(資格)');
  await setServer(phone);
  net.online = true;
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('受け取りました：設定・原本・台帳（5本）');
  net.online = false; // 現場で電波が切れた

  await phone.click('.tab:has-text("一覧")');
  await phone.click('[data-tree=AB002]');
  await phone.fill('#f-height', '10');
  await phone.fill('#f-girth0', '0.5');
  for (const [g, v] of [['vigor', '並'], ['lean', '無'], ['deadBranch', '無'], ['decay', '無'], ['fungus', '無'], ['initialNeeded', '否'], ['grade', 'B']])
    await phone.click(`[data-group=${g}] [data-v="${v}"]`);
  await phone.click('text=保存して次の木へ');
  await expect(phone.locator('.alert.warn')).toContainText('未送信の入力があります');

  // 電波が戻った → 自動で送り直す
  net.online = true;
  await phoneCtx.setOffline(true);
  await phoneCtx.setOffline(false); // ブラウザに「つながった（online）」を知らせる
  await phone.click('.tab:has-text("出力")');
  await expect(phone.locator('[data-testid=send-status]')).toContainText('未送信 0件');
  expect(gas.sheets.get('records').cells.length).toBe(2); // 見出し＋1本
  expect(gas.sheets.get('history').cells.length).toBe(2); // 履歴も残る

  // 事務所の PC：取得して一覧表を出力
  await office.click('.tab:has-text("出力")');
  await office.click('[data-testid=sync]');
  await expect(office.locator('.toast')).toContainText('他の端末で変わった木1本');
  await expect(office.locator('[data-testid=export-db]')).toBeDisabled(); // まだ確定していないので書き込めない
  await office.check('[data-testid=with-unconfirmed]'); // 途中経過として書き込む
  const [dl] = await Promise.all([office.waitForEvent('download'), office.click('[data-testid=export-db]')]);
  await expect(office.locator('.toast')).toContainText('検査OK');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(await dl.path()));
  const ws = wb.getWorksheet('公園');
  expect(ws.getCell('L4').value).toBe('並');
  expect(ws.getCell('G4').value).toBe('試験 二郎(資格)');
});

test('サーバーに置くのは事務の端末だけ。置く前に、何を置き換えるかを確かめる', async ({ page }) => {
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await setServer(page);
  await page.click('[data-testid=role-surveyor]');
  await expect(page.locator('[data-testid=server-put]')).toHaveCount(0);
  await expect(page.locator('[data-testid=server-put-office-only]')).toBeVisible();
  await page.click('[data-testid=role-office]');
  await page.click('[data-testid=server-put]');
  await expect(page.locator('[data-testid=server-put-ask]')).toContainText('設定ファイル');
  await page.click('[data-testid=server-put-ask] >> text=やめる'); // やめれば何も送らない
  await expect(page.locator('[data-testid=server-put-ask]')).toHaveCount(0);
  await expect(page.locator('[data-testid=server-put]')).toBeVisible();
});
