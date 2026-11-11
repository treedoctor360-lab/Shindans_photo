// 野帳の並びに合わせる設定：入力画面の並びと、出力の一覧表形式の見出し
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

function configFile() {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  const keys = cfg.checks.map((c) => c.key);
  cfg.checks = cfg.checks.map((c, i) => (i === 0 ? { ...c, place: 'measure' } : i === keys.length - 1 ? { ...c, always: true } : c));
  cfg.initial = { ...cfg.initial, afterCheck: keys.at(-2) };
  cfg.noGrade = true;
  cfg.options.grade = [];
  cfg.treat = { ...cfg.treat, prune: [], other: [] };
  cfg.rules = cfg.rules.filter((r) => !['treatRequires', 'gradeNeedsTreat', 'ratioAtLeast', 'noteSuggestsTreat'].includes(r.type));
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }] };
  cfg.extraFields = [{ key: 'spread', label: '枝張り', unit: 'm', numeric: true }];
  cfg.dbFormat.columns = { ...cfg.dbFormat.columns, spread: '^W$', branchLen: '^枝長$', branchDia: '^枝径$' };
  cfg.dbFormat.writeKeys = [...cfg.dbFormat.writeKeys.filter((k) => !['grade', 'treat', 'fellingReason'].includes(k)), 'spread', 'branchLen', 'branchDia'];
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/field-order-config.json', JSON.stringify(cfg));
  return { path: 'test-results/field-order-config.json', cfg };
}

const top = async (loc) => (await loc.boundingBox()).y;

test('入力画面が設定の並び（計測の中の点検項目・要否の位置）になり、出力の見出しが日本語になる', async ({ page }) => {
  const { path, cfg } = configFile();
  const keys = cfg.checks.map((c) => c.key);
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', path);
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.fill('#ag-routeName', '試験の新しい通り');
  await page.click('[data-testid=add-group-submit]');

  // 並び：幹周 → 足した欄 → 計測の区切りの点検項目 → 枝長、要否は指定の項目と最後の項目の間
  const girth = await top(page.locator('#f-girth0'));
  const spread = await top(page.locator('#f-x-spread'));
  const measureCheck = await top(page.locator(`[data-group=${keys[0]}]`).first());
  const branch = await top(page.locator('#f-bl'));
  expect(girth < spread && spread < measureCheck && measureCheck < branch).toBe(true);
  const before = await top(page.locator(`[data-group=${keys.at(-2)}]`).first());
  const need = await top(page.locator('[data-group=initialNeeded]').first());
  const after = await top(page.locator(`[data-group=${keys.at(-1)}]`).first());
  expect(before < need && need < after).toBe(true);
  // 判定（健全度なし・要否は並びの中）と処置（選択肢なし）の区切りは出さない
  await expect(page.locator('h2', { hasText: '判定' })).toHaveCount(0);
  await expect(page.locator('h2', { hasText: '処置' })).toHaveCount(0);

  // 入力して保存 → 出力の一覧表形式
  await page.fill('#f-species', 'テストノキ');
  await page.fill('#f-height', '5');
  await page.fill('#f-girth0', '0.5');
  await page.fill('#f-x-spread', '3');
  await page.fill('#f-bl', '300');
  await page.fill('#f-bd', '8');
  await page.click(`[data-group=vigor] [data-v="${cfg.options.vigor[0]}"]`);
  await page.click('[data-testid=checks-none]');
  for (const k of keys) {
    const pressed = page.locator(`[data-group=${k}] [aria-pressed=true]`);
    if (!(await pressed.count())) await page.click(`[data-group=${k}] [data-v="${cfg.options[k][0]}"]`);
  }
  await page.click(`[data-group=initialNeeded] [data-v="${cfg.initial.no}"]`);
  await page.click('[data-testid=save-to-list]');
  await expect(page.locator('[data-testid=tree-cards]')).toBeVisible();
  await page.click('.tab:has-text("出力")');
  const heads = await page.locator('[data-testid=out-table] thead th').allInnerTexts();
  expect(heads).toEqual(expect.arrayContaining(['樹木番号', '枝張り(m)', '枝長(cm)', '枝径(cm)']));
  for (const h of heads) expect(h).not.toMatch(/^[A-Za-z]+$/); // 英字の名前を出さない
  expect(heads).not.toContain('通しNo.'); // 台帳がないので通し番号の列は出さない
  const row = await page.locator('[data-testid=out-table] tbody tr').first().innerText();
  expect(row).toContain('300');
  expect(row).toContain('3');
});
