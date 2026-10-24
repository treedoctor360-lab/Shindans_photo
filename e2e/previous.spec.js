// 前回の調査（カルテ）：事務所の PC でまとめて読み込み → サーバーに置く → スマホで受け取り、入力画面で弱点と写真を見る
// サーバーは「にせの Google」（test/helpers/fakeGas.js）。カルテは架空のもの
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeFakeGas } from '../test/helpers/fakeGas.js';
import { makeKarte } from '../test/helpers/makeKarte.js';
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
async function setServer(page) {
  await page.fill('#s-url', URL_);
  await page.fill('#s-pass', 'ひみつ');
}

test('PC でカルテをまとめて読み込み、スマホで前回の弱点と写真を見る', async ({ browser }) => {
  const gas = makeFakeGas();

  // 事務所の PC：設定・台帳・カルテ（2ファイル）を読み込んで、サーバーに置く
  const pc = await (await browser.newContext()).newPage();
  await connect(pc, gas);
  await pc.goto('./');
  await pc.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await pc.setInputFiles('[data-testid=ledger-file]', tmp('p-ledger.xlsx', await makeLedger()));
  await expect(pc.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await pc.setInputFiles('[data-testid=prev-files]', [
    tmp('p-karte1.xlsx', await makeKarte([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }, { no: 'AB002', species: 'ミホンカエデ', withPhoto: false }])),
    tmp('p-karte2.xlsx', await makeKarte([{ no: 'AB001', code: 'K09', place: '別の架空公園', species: 'ちがう木' }])),
  ]);
  await expect(pc.locator('.toast')).toContainText('2ファイルから読み込みました（前回の詳しい診断3本・周りの様子1本、写真7枚）。合わせて3本分');
  await expect(pc.locator('[data-testid=prev-status]')).toContainText('3本・2か所');
  // 分けて読み込める：同じファイルをもう一度読んでも、増えずに入れ替わる
  await pc.setInputFiles('[data-testid=prev-files]', [tmp('p-karte1.xlsx', await makeKarte([{ no: 'AB001' }, { no: 'AB001', kind: 'place' }, { no: 'AB002', species: 'ミホンカエデ', withPhoto: false }]))]);
  await expect(pc.locator('.toast')).toContainText('1ファイルから読み込みました');
  await expect(pc.locator('[data-testid=prev-status]')).toContainText('3本・2か所');
  await setServer(pc);
  await pc.click('[data-testid=role-office]'); // サーバーに置くのは事務の端末だけ
  await pc.click('[data-testid=server-put]');
  await pc.click('[data-testid=server-put-ok]');
  await expect(pc.locator('.toast')).toContainText('前回の調査3本');

  // スマホ：受け取る（写真はまだ入らない）
  const phone = await (await browser.newContext()).newPage();
  await connect(phone, gas);
  await phone.goto('./');
  await setServer(phone);
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('前回の調査（3本）');

  // 一覧に印が出る。開くと弱点と評価が見える
  await phone.click('.tab:has-text("一覧")');
  await expect(phone.locator('[data-tree=AB001] .tag.prev')).toBeVisible();
  await expect(phone.locator('[data-tree=AB003] .tag.prev')).toHaveCount(0);
  await phone.click('[data-tree=AB001]');
  // 閉じたままでも、どの種類のカルテがあるか分かる
  await expect(phone.locator('[data-testid=prev-open]')).toContainText('前回の詳しい診断 2090/09/01');
  await expect(phone.locator('[data-testid=prev-open]')).toContainText('周りの様子 2021/10/13');
  await expect(phone.locator('[data-testid=prev-open]')).toContainText('弱点など4・写真5枚');
  await phone.click('[data-testid=prev-open]');
  const detail = phone.locator('.prev-karte[data-kind=detail]');
  await expect(detail.locator('[data-testid=prev-items] li')).toHaveCount(3);
  await expect(detail).toContainText('幹 ①うろ 有（大）');
  await expect(detail).toContainText('危険度 E うろ・根の傷み');
  await expect(detail.locator('[data-testid=prev-info]')).toContainText('調べた日2090/09/01');
  await expect(detail.locator('[data-testid=prev-info]')).toContainText('植えた年1990');
  await expect(phone.locator('.prev-karte[data-kind=place]')).toContainText('人の通行 有');

  // 写真・図：この場所の分を端末に入れると見られる（周りの様子の配置の図も）。タップで大きく
  await phone.click('[data-testid=prev-get-photos]');
  await expect(detail.locator('[data-testid=prev-photos] img')).toHaveCount(2);
  await expect(phone.locator('.prev-karte[data-kind=place] .prev-photo small')).toHaveText(['配置の図', '周りの写真', '根元の様子']);
  await phone.locator('.prev-photo').first().click();
  await expect(phone.locator('.photo-big img')).toBeVisible();
  await phone.click('.photo-big');
  await expect(phone.locator('.photo-big')).toHaveCount(0);

  // 樹種が違う木は、中身を隠して知らせる（番号の付け替えで別の木かもしれないので）
  await phone.click('.tab:has-text("一覧")');
  const other = await phone.locator('#s-group option', { hasText: '別の架空公園' }).getAttribute('value');
  await phone.selectOption('#s-group', other);
  await phone.click('[data-tree=AB001]');
  await phone.click('[data-testid=prev-open]');
  await expect(phone.locator('[data-testid=prev-mismatch]')).toBeVisible();
  await expect(phone.locator('[data-testid=prev-items]')).toHaveCount(0);
  await phone.click('text=それでも表示する');
  await expect(phone.locator('[data-testid=prev-items]')).toBeVisible();
});

test('PC でカルテの PDF（Excel から作ったもの）も読み込める', async ({ browser }) => {
  const pc = await (await browser.newContext()).newPage();
  await pc.goto('./');
  await pc.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await pc.setInputFiles('[data-testid=prev-files]', 'test/fixtures/karte-sample.pdf');
  // 初めは PDF を読む仕組みの読み込みがあるので、少し長めに待つ
  await pc.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('ファイルから'), null, { timeout: 20000 });
  console.log('TOAST', await pc.locator('.toast').innerText());
  await expect(pc.locator('.toast')).toContainText('1ファイルから読み込みました（前回の詳しい診断1本・周りの様子1本、写真4枚）', { timeout: 20000 });
  await expect(pc.locator('[data-testid=prev-status]')).toContainText('1本・1か所');
});
