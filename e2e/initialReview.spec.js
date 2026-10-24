// 詳しい診断の確認の流れ（画面で通し）：
//  スマホ（調査者）が詳しい診断を入力・送信 → PC（事務）が付箋で修正案（選択肢から）→ スマホが「採用」
//  → PC が確認済みにして確定 → 確定した記録だけがデータ入力用ブックに書き込まれる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import cfg from '../test/fixtures/sample-config.json' with { type: 'json' };
import { readInitialBook } from '../src/excel/initialBook.js';
import { makeFakeGas } from '../test/helpers/fakeGas.js';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

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

async function setServer(page, role, name) {
  await page.fill('#s-url', URL_);
  await page.fill('#s-pass', 'ひみつ');
  await page.click(`[data-testid=role-${role}]`);
  await page.fill('#s-user', name);
}

async function sync(page) {
  await page.click('.tab:has-text("出力")');
  await page.click('[data-testid=sync]');
  await expect(page.locator('.toast')).toContainText('送信');
}

test('詳しい診断：付箋 → 採用 → 確定 → 確定した記録だけブックに書き込む', async ({ browser }) => {
  const gas = makeFakeGas();

  // 事務の PC：設定・台帳・データ入力用ブックを置く
  const pc = await (await browser.newContext()).newPage();
  await connect(pc, gas);
  await pc.goto('./');
  await pc.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await pc.setInputFiles('[data-testid=ledger-file]', tmp('ir-ledger.xlsx', await makeLedger()));
  await expect(pc.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await pc.setInputFiles('[data-testid=initial-book-file]', tmp('ir-book.xlsx', await makeInitialBook()));
  await expect(pc.locator('[data-testid=initial-book-status] .ok')).toBeVisible();
  await setServer(pc, 'office', '事務 花子');
  await pc.click('[data-testid=role-office]'); // サーバーに置くのは事務の端末だけ
  await pc.click('[data-testid=server-put]');
  await pc.click('[data-testid=server-put-ok]');
  await expect(pc.locator('.toast')).toContainText('サーバーに置きました');

  // スマホ：受け取って、AB001（台帳で「必要」）の詳しい診断を入力・保存
  const phone = await (await browser.newContext()).newPage();
  await connect(phone, gas);
  await phone.goto('./');
  await phone.fill('#s-date', '2099-05-06');
  await phone.fill('#s-insp', '試験 二郎(資格)');
  await setServer(phone, 'surveyor', '試験 二郎');
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('受け取りました');
  await phone.click('.tab:has-text("一覧")');
  await phone.click('[data-tree=AB001]');
  await phone.click('[data-testid=open-initial]');
  await phone.click('[data-group=b4] [data-v="有（大）"]');
  await phone.click('[data-testid=save-initial]');
  const ask = phone.locator('text=未入力のまま保存する');
  if (await ask.isVisible()) await ask.click();
  await expect(phone.locator('.toast')).toContainText('保存しました');

  // 事務：受け取り、未確定で絞り込むと出る。詳しい診断を開いて、選択肢から修正案の付箋
  await expect.poll(async () => {
    await sync(pc);
    await pc.click('.tab:has-text("一覧")');
    await pc.click('[data-filter=submitted]');
    return pc.locator('[data-tree=AB001]').count();
  }).toBe(1);
  await pc.click('.tab:has-text("出力")');
  await expect(pc.locator('[data-testid=export-initial]')).toContainText('確定した0本'); // まだ確定していない
  await pc.click('.tab:has-text("一覧")');
  await pc.click('[data-tree=AB001]');
  await pc.click('[data-testid=open-initial]');
  await expect(pc.locator('[data-testid=review-initial] [data-testid=confirm]')).toBeEnabled();
  await pc.click('[data-testid=sticky-new]');
  await pc.selectOption('#st-field', 'b4');
  await pc.fill('#st-q', '小ではないか？');
  await pc.selectOption('#st-p', '有（小）');
  await pc.click('[data-testid=sticky-add]');
  await expect(pc.locator('[data-testid=review-initial] .rs')).toHaveText('確認依頼');
  await expect(pc.locator('[data-testid=review-initial] [data-testid=confirm]')).toBeDisabled();

  // スマホ：知らせから開いて「採用」
  await expect.poll(async () => {
    await sync(phone);
    return phone.locator('[data-testid=review-notice]').count();
  }).toBe(1);
  await phone.click('[data-testid=review-notice]');
  await expect(phone.locator('[data-tree=AB001] [data-initial-review=asked]')).toBeVisible();
  await phone.click('[data-tree=AB001]');
  await phone.click('[data-testid=open-initial]');
  await expect(phone.locator('.sticky-q')).toHaveText('小ではないか？');
  await phone.click('[data-act=adopt]');
  await expect(phone.locator('[data-group=b4] [data-v="有（小）"]')).toHaveAttribute('aria-pressed', 'true');

  // 事務：返事を受け取り、確認済みにして確定
  await expect.poll(async () => {
    await sync(pc);
    return pc.locator('[data-testid=review-notice]').count();
  }).toBe(1);
  await pc.click('[data-testid=review-notice]');
  await pc.click('[data-tree=AB001]');
  await pc.click('[data-testid=open-initial]');
  await pc.click('[data-act=close]');
  await pc.click('[data-testid=review-initial] [data-testid=confirm]');
  await expect(pc.locator('[data-testid=review-initial] .rs')).toHaveText('確定');

  // 確定した記録だけがブックに書き込まれる（採用した修正案が入っている）
  await pc.click('.tab:has-text("出力")');
  await expect(pc.locator('[data-testid=export-initial]')).toContainText('確定した1本');
  const [dl] = await Promise.all([pc.waitForEvent('download'), pc.click('[data-testid=export-initial]')]);
  await expect(pc.locator('.toast')).toContainText('検査OK');
  const r = await readInitialBook(fs.readFileSync(await dl.path()), cfg);
  expect(r.sheets[0].rows.find((x) => x.rowNumber === 7).values).toMatchObject({ treeNo: 'AB001', b4: '有（小）' });
});
