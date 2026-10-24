// 確認の流れ（画面で通し）：
//  スマホ（調査者）が入力・送信 → PC（事務）が付箋で修正案 → スマホが「採用」→ PC が確認済みにして確定
//  → スマホにも確定が届く。採用した修正案は、事務が書き直さなくても入力内容に入っている
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

// 出力タブの「やり取り」ボタンで、送って受け取る
async function sync(page) {
  await page.click('.tab:has-text("出力")');
  await page.click('[data-testid=sync]');
  await expect(page.locator('.toast')).toContainText('送信');
}

test('付箋 → 採用 → 確定（事務が書き直さずに、修正案が入力内容に入る）', async ({ browser }) => {
  const gas = makeFakeGas();

  // 事務の PC：設定・原本・台帳を置く
  const pc = await (await browser.newContext()).newPage();
  await connect(pc, gas);
  await pc.goto('./');
  await pc.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await expect(pc.locator('[data-testid=config-status] .ok')).toBeVisible();
  await pc.setInputFiles('[data-testid=template-file]', tmp('r-template.xlsx', await makeTemplate()));
  await pc.setInputFiles('[data-testid=ledger-file]', tmp('r-ledger.xlsx', await makeLedger()));
  await expect(pc.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await setServer(pc, 'office', '事務 花子');
  await pc.click('[data-testid=role-office]'); // サーバーに置くのは事務の端末だけ
  await pc.click('[data-testid=server-put]');
  await pc.click('[data-testid=server-put-ok]');
  await expect(pc.locator('.toast')).toContainText('サーバーに置きました');

  // スマホ（調査者）：受け取って1本入力・保存（自動で送信）
  const phone = await (await browser.newContext()).newPage();
  await connect(phone, gas);
  await phone.goto('./');
  await phone.fill('#s-date', '2099-05-06');
  await phone.fill('#s-insp', '試験 二郎(資格)');
  await setServer(phone, 'surveyor', '試験 二郎');
  await phone.click('[data-testid=server-get]');
  await expect(phone.locator('.toast')).toContainText('受け取りました');
  await phone.click('.tab:has-text("一覧")');
  await phone.click('[data-tree=AB002]');
  await phone.fill('#f-height', '10');
  await phone.fill('#f-girth0', '0.5');
  for (const [g, v] of [['vigor', '並'], ['lean', '無'], ['deadBranch', '無'], ['decay', '無'], ['fungus', '無'], ['initialNeeded', '否'], ['grade', 'B']])
    await phone.click(`[data-group=${g}] [data-v="${v}"]`);
  await phone.fill('#f-dbnote', 'クズ巻き付き有');
  await phone.click('text=保存して次の木へ');
  await expect(phone.locator('.toast')).toContainText('保存しました');
  await expect.poll(() => gas.sheets.get('records')?.cells.length || 0).toBe(2);

  // 事務：受け取って、一覧表用の特記に修正案の付箋を付ける。入力欄は直せない
  await sync(pc);
  await pc.click('.tab:has-text("一覧")');
  await pc.click('[data-filter=submitted]');
  await pc.click('[data-tree=AB002]');
  await expect(pc.locator('#f-height')).toBeDisabled();
  await expect(pc.locator('[data-testid=confirm]')).toBeEnabled();
  await pc.click('[data-testid=sticky-new]');
  await pc.selectOption('#st-field', 'dbNote');
  await pc.fill('#st-q', 'この書き方で良いか？');
  await pc.fill('#st-p', 'クズの巻き付きあり');
  await pc.click('[data-testid=sticky-add]');
  await expect(pc.locator('.review .rs')).toHaveText('確認依頼');
  await expect(pc.locator('[data-testid=confirm]')).toBeDisabled(); // 付箋が残っている間は確定できない
  await expect.poll(() => gas.sheets.get('records').cells.length).toBe(3);

  // スマホ：受け取ると知らせが出る → 開いて「採用」
  await sync(phone);
  await expect(phone.locator('.toast')).toContainText('新しい付箋1件');
  await phone.click('[data-testid=review-notice]');
  await expect(phone.locator('[data-filter=asked].on')).toBeVisible();
  await phone.click('[data-tree=AB002]');
  await expect(phone.locator('.sticky-q')).toHaveText('この書き方で良いか？');
  await phone.click('[data-act=adopt]');
  await expect(phone.locator('#f-dbnote')).toHaveValue('クズの巻き付きあり');
  await expect(phone.locator('.review .rs')).toHaveText('回答済み');

  // 事務：返事を受け取る → 確認済みにして確定
  await expect.poll(async () => {
    await sync(pc);
    return pc.locator('[data-testid=review-notice]').count();
  }).toBe(1);
  await pc.click('[data-testid=review-notice]');
  await pc.click('[data-tree=AB002]');
  await expect(pc.locator('#f-dbnote')).toHaveValue('クズの巻き付きあり'); // 事務は書き直していない
  await expect(pc.locator('.sticky-a')).toContainText('修正案を採用');
  await pc.click('[data-act=close]');
  await pc.click('[data-testid=confirm]');
  await expect(pc.locator('.review .rs')).toHaveText('確定');

  // 事務：確定した木だけが一覧表に書き込まれる（採用した修正案が入っている）
  await pc.click('.tab:has-text("出力")');
  await expect(pc.locator('[data-testid=export-db]')).toContainText('確定した1本');
  const [dl] = await Promise.all([pc.waitForEvent('download'), pc.click('[data-testid=export-db]')]);
  await expect(pc.locator('.toast')).toContainText('検査OK');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(await dl.path()));
  const row = wb.getWorksheet('公園').getRow(4).values.map((v) => (v && typeof v === 'object' ? v.richText?.map((x) => x.text).join('') ?? v.text : v));
  expect(row).toContain('ＡＢ００２'); // 台帳の書き方（全角）のまま
  expect(row).toContain('クズの巻き付きあり');

  // スマホにも確定が届く
  await expect.poll(async () => {
    await sync(phone);
    await phone.click('.tab:has-text("一覧")');
    await phone.click('[data-filter=confirmed]'); // 一覧は「返事待ち」で絞り込んだままなので、確定に切り替える
    return phone.locator('[data-tree=AB002] .tag.rs-confirmed').count();
  }).toBe(1);

  // サーバーには付箋・確定と、その履歴が残る
  const kinds = gas.sheets.get('records').cells.slice(1).map((r) => r[2]);
  expect(kinds.sort()).toEqual(['confirm', 'sticky', 'tree']);
  expect(gas.sheets.get('history').cells.length).toBeGreaterThanOrEqual(6);
});

test('同じ木を2台で直したら、後の端末で食い違いとして出て、どちらを使うか選べる', async ({ browser }) => {
  const gas = makeFakeGas();
  const pc = await (await browser.newContext()).newPage();
  await connect(pc, gas);
  await pc.goto('./');
  await pc.setInputFiles('[data-testid=config-file]', 'test/fixtures/sample-config.json');
  await pc.setInputFiles('[data-testid=ledger-file]', tmp('c-ledger.xlsx', await makeLedger()));
  await expect(pc.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await setServer(pc, 'office', '事務');
  await pc.click('[data-testid=role-office]'); // サーバーに置くのは事務の端末だけ
  await pc.click('[data-testid=server-put]');
  await pc.click('[data-testid=server-put-ok]');
  await expect(pc.locator('.toast')).toContainText('サーバーに置きました');

  const open = async (name) => {
    const p = await (await browser.newContext()).newPage();
    await connect(p, gas);
    await p.goto('./');
    await setServer(p, 'surveyor', name);
    await p.click('[data-testid=server-get]');
    await expect(p.locator('.toast')).toContainText('受け取りました');
    return p;
  };
  const fill = async (p, h) => {
    await p.click('.tab:has-text("一覧")');
    await p.click('[data-tree=AB002]');
    await p.fill('#f-height', h);
    await p.fill('#f-girth0', '0.5');
    for (const [g, v] of [['vigor', '並'], ['lean', '無'], ['deadBranch', '無'], ['decay', '無'], ['fungus', '無'], ['initialNeeded', '否'], ['grade', 'B']])
      await p.click(`[data-group=${g}] [data-v="${v}"]`);
  };

  const a = await open('甲');
  const b = await open('乙');
  await fill(a, '10');
  await a.click('text=保存して次の木へ');
  await expect.poll(() => gas.sheets.get('records')?.cells.length || 0).toBe(2);
  await fill(b, '12'); // 乙は甲の入力を受け取る前に入力した
  await b.click('text=保存して次の木へ');

  await expect(b.locator('[data-testid=review-notice]')).toContainText('食い違っている木が1本');
  // 出力の画面で、未送信の記録が何か・なぜ送れていないかが分かり、そこから木を開ける
  await b.click('.tab:has-text("出力")');
  await expect(b.locator('[data-testid=unsent-list]')).toContainText('AB002');
  await expect(b.locator('[data-testid=unsent-list]')).toContainText('食い違っています');
  await b.click('[data-testid=unsent-list] [data-act=open-unsent]');
  await expect(b.locator('[data-testid=conflict]')).toBeVisible();
  await expect(b.locator('[data-testid=conflict] .diff')).toContainText('樹高');
  await b.click('[data-act=use-theirs]');
  await expect(b.locator('#f-height')).toHaveValue('10');
  await expect(b.locator('[data-testid=conflict]')).toHaveCount(0);
});
