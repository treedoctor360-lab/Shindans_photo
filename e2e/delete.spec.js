// 木の削除・入力の取り消しを、実際の画面で確かめる（サーバーは「にせの Google」）
//  スマホで番号なしの木を2本追加 → 2本ともサーバーに届く → 1本削除 → 事務所の PC でも消える → 元に戻せる
//  台帳の木は「入力を取り消す」で未入力に戻る
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
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

async function connect(page, gas) {
  await page.route(`${URL_}*`, async (route) => {
    const res = await gas.fetchFn(URL_, { body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await res.json()) });
  });
}

async function open(browser, gas) {
  const page = await (await browser.newContext()).newPage();
  await connect(page, gas);
  await page.goto('./');
  await page.fill('#s-url', URL_);
  await page.fill('#s-pass', 'ひみつ');
  return page;
}

// 番号なしの木を追加して保存する
async function addNoNumber(page, height) {
  await page.click('.tab:has-text("一覧")');
  await page.click('text=一覧にない木を追加');
  await page.fill('#f-species', 'テストノキ');
  await page.fill('#f-height', height);
  await page.click('[data-testid=save-to-list]');
  await page.click('text=未入力のまま保存する');
}

test('追加した木を削除すると他の端末でも消え、元に戻せる。台帳の木は入力を取り消せる', async ({ browser }) => {
  const gas = makeFakeGas();

  const office = await open(browser, gas);
  await office.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await expect(office.locator('[data-testid=config-status] .ok')).toBeVisible();
  await office.setInputFiles('[data-testid=template-file]', tmp('d-template.xlsx', await makeTemplate()));
  await office.setInputFiles('[data-testid=ledger-file]', tmp('d-ledger.xlsx', await makeLedger()));
  await expect(office.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await office.click('[data-testid=role-office]'); // サーバーに置くのは事務の端末だけ
  await office.click('[data-testid=server-put]');
  await office.click('[data-testid=server-put-ok]');
  await expect(office.locator('.toast')).toContainText('サーバーに置きました');

  const phone = await open(browser, gas);
  await phone.fill('#s-date', '2099-05-06');
  await phone.fill('#s-insp', '試験 二郎(資格)');
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('受け取りました');

  // 番号なしの木を2本 → 2本ともサーバーに届く（ぶつからない）
  await addNoNumber(phone, '3');
  await addNoNumber(phone, '4');
  await phone.click('.tab:has-text("出力")');
  await expect(phone.locator('[data-testid=send-status]')).toContainText('未送信 0件');
  expect(gas.sheets.get('records').cells.length).toBe(3); // 見出し＋2本

  // 事務所が受け取る：番号なしの木が2本
  await office.click('.tab:has-text("出力")');
  await office.click('[data-testid=sync]');
  await office.click('.tab:has-text("一覧")');
  await expect(office.locator('.card:has-text("(番号なし)")')).toHaveCount(2);

  // スマホで1本削除（確かめてから）
  await phone.click('.tab:has-text("一覧")');
  await phone.locator('.card:has-text("(番号なし)")').first().click();
  await phone.click('[data-testid=remove-tree]');
  await expect(phone.locator('[data-testid=remove-ask]')).toContainText('他の端末でも削除になります');
  await phone.click('[data-testid=remove-ok]');
  await phone.click('.tab:has-text("一覧")');
  await expect(phone.locator('.card:has-text("(番号なし)")')).toHaveCount(1);
  await phone.click('[data-filter=deleted]');
  await expect(phone.locator('.card:has-text("(番号なし)")')).toHaveCount(1);

  // 事務所でも消える。事務の端末には削除・元に戻すのボタンは出ない
  await office.click('.tab:has-text("出力")');
  await office.click('[data-testid=sync]');
  await office.click('.tab:has-text("一覧")');
  await expect(office.locator('.card:has-text("(番号なし)")')).toHaveCount(1);
  await office.click('[data-filter=deleted]');
  await office.locator('.card:has-text("(番号なし)")').click();
  await expect(office.locator('[data-testid=deleted-note]')).toBeVisible();

  // スマホで元に戻す
  await phone.locator('.card:has-text("(番号なし)")').click();
  await phone.click('[data-testid=restore-tree]');
  await phone.click('.tab:has-text("一覧")');
  await expect(phone.locator('[data-filter=deleted]')).toHaveCount(0);
  await expect(phone.locator('.card:has-text("(番号なし)")')).toHaveCount(2);

  // 台帳の木：入力して保存 → 入力を取り消す → 未入力に戻る（値は下書きとして残る）
  await phone.click('[data-tree=AB002]');
  await phone.fill('#f-height', '10');
  await phone.click('text=保存して次の木へ');
  await phone.click('text=未入力のまま保存する');
  await phone.click('.tab:has-text("一覧")');
  await phone.click('[data-tree=AB002]');
  await phone.click('[data-testid=remove-tree]');
  await phone.click('[data-testid=remove-ok]');
  await expect(phone.locator('#f-height')).toHaveValue('10');
  await phone.click('.tab:has-text("一覧")');
  await phone.click('.chip:has-text("未入力")');
  await expect(phone.locator('[data-tree=AB002]')).toBeVisible();
});
