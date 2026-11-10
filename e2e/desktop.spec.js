// デスクトップ表示：広い画面だけ上の帯にボタンを出し、押すと一覧・簡易診断・詳しい診断を横に並べる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeInitialBook } from '../test/helpers/makeInitialBook.js';
import { makeLedger } from '../test/helpers/makeLedger.js';

const tmp = (name, bytes) => {
  fs.mkdirSync('test-results', { recursive: true });
  const p = `test-results/${name}`;
  fs.writeFileSync(p, typeof bytes === 'string' ? bytes : Buffer.from(bytes));
  return p;
};

const setup = async (page) => {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.initialSurvey.noteCheck = [{ notes: ['根元の割れ'], items: ['b4'] }];
  await page.goto('./');
  await page.fill('#s-date', '2099-05-06');
  await page.fill('#s-insp', '試験 二郎(資格)');
  await page.setInputFiles('[data-testid=config-file]', tmp('dk-config.json', JSON.stringify(cfg)));
  await page.setInputFiles('[data-testid=ledger-file]', tmp('dk-ledger.xlsx', await makeLedger()));
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=initial-book-file]', tmp('dk-book.xlsx', await makeInitialBook()));
  await expect(page.locator('[data-testid=initial-book-status] .ok')).toBeVisible();
};

test('スマホの幅ではボタンを出さない', async ({ page }) => {
  await setup(page);
  await expect(page.locator('[data-testid=desktop-toggle]')).toHaveCount(0);
});

test.describe('広い画面', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('ボタンで切り替え、簡易診断と詳しい診断を並べる。端末に覚え、狭くすると今までの表示に戻る', async ({ page }) => {
    await setup(page);
    const toggle = page.locator('[data-testid=desktop-toggle]');
    await expect(toggle).toBeVisible();
    await page.click('.tab:has-text("一覧")');
    // 初めはオフ（今までの表示）
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const split = page.locator('[data-testid=desktop-split]');
    await expect(split.locator('.pane-empty')).toBeVisible();

    // 左の一覧から木を選ぶと、中に簡易診断
    await split.locator('.pane-l [data-tree=AB002]').click();
    const simple = split.locator('[data-testid=pane-simple]');
    await expect(simple.locator('#f-height')).toBeVisible();
    await expect(split.locator('.pane-l [data-tree=AB002]')).toHaveClass(/sel/);
    await simple.locator('#f-height').fill('10');
    await simple.locator('#f-girth0').fill('0.5');
    await simple.locator('[data-testid=note-chips] >> text=根元の割れ').click();
    await simple.locator('[data-group=initialNeeded] [data-v="要"]').click();
    await simple.locator('text=保存して次の木へ').click();
    await page.click('text=未入力のまま保存する');
    await page.click('[data-testid=initial-prompt-go]');
    // 右に詳しい診断、中は同じ木の簡易診断
    const initial = split.locator('[data-testid=pane-initial]');
    await expect(initial.locator('[data-testid=simple-notes]')).toContainText('根元の割れ');
    await expect(initial.locator('[data-testid=tree-bar-no]')).toHaveText('AB002');
    await expect(simple.locator('#f-height')).toHaveValue('10');
    // 簡易と詳しい診断は、それぞれの列の中でスクロールする（片方を動かしても、もう片方は動かない）
    const scrollTop = (loc) => loc.evaluate((el) => el.scrollTop);
    expect(await initial.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await initial.evaluate((el) => el.scrollTo(0, 400));
    expect(await scrollTop(initial)).toBeGreaterThan(0);
    expect(await scrollTop(simple)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // 列の中でも、樹木番号の帯は列の上端に止まる
    const barTop = await initial.locator('[data-testid=tree-bar]').evaluate((el) => el.getBoundingClientRect().top - el.closest('.pane-col').getBoundingClientRect().top);
    expect(Math.abs(barTop)).toBeLessThan(3);
    // 区切りの見出しは、帯のすぐ下に止まる（間から下の文字が見えない）
    const gap = await initial.evaluate((el) => {
      const bar = el.querySelector('[data-testid=tree-bar]').getBoundingClientRect();
      const top = Math.min(...[...el.querySelectorAll('.form-body .sec>h2')].map((h) => h.getBoundingClientRect().top).filter((t) => t >= bar.top));
      return top - bar.bottom;
    });
    expect(Math.abs(gap)).toBeLessThan(3);

    // 左の一覧表：有の項目・未選択・注意の印
    const row = split.locator('.pane-l tr[data-tree=AB002]');
    await expect(row.locator('[data-testid=ov-yes]')).toContainText('未選択');
    await expect(row.locator('[data-testid=ov-flags]')).toContainText('未反映1');
    await expect(row.locator('[data-testid=ov-flags]')).toContainText('初期未完了');
    // 注意のある木だけ
    const all = await split.locator('.pane-l tr[data-tree]').count();
    await split.locator('[data-testid=ov-only-flagged]').check();
    await expect(split.locator('.pane-l tr[data-tree=AB002]')).toBeVisible();
    expect(await split.locator('.pane-l tr[data-tree]').count()).toBeLessThan(all);
    await split.locator('[data-testid=ov-only-flagged]').uncheck();
    // カードに切り替えると今までの一覧、一覧表に戻せる
    await split.locator('[data-ov-mode=cards]').click();
    await expect(split.locator('.pane-l .card[data-tree=AB002]')).toBeVisible();
    await split.locator('[data-ov-mode=table]').click();
    await expect(split.locator('[data-testid=ov-table]')).toBeVisible();

    // 詳しい診断の記録がない木では、右の列を出さない
    await split.locator('.pane-l [data-tree=AB003]').click();
    await expect(simple.locator('#f-height')).toBeVisible();
    await expect(initial.locator('[data-testid=initial-view]')).toHaveCount(0);
    await split.locator('.pane-l [data-tree=AB002]').click();
    await expect(initial.locator('[data-testid=initial-view]')).toBeVisible();

    // 開き直してもオンのまま
    await page.reload();
    await expect(page.locator('[data-testid=desktop-toggle]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid=desktop-split]')).toBeVisible();

    // 狭くすると今までの表示（ボタンも出さない）、広げると戻る
    await page.setViewportSize({ width: 800, height: 1000 });
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
    await expect(page.locator('[data-testid=desktop-toggle]')).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.locator('[data-testid=desktop-split]')).toBeVisible();

    // オフに戻す
    await page.locator('[data-testid=desktop-toggle]').click();
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
  });
});

test.describe('スマホを横にしたとき', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('ボタンを出し、一覧と、簡易診断／詳しい診断を切り替える2列にする。縦に戻すと今までの表示', async ({ page }) => {
    await setup(page);
    const toggle = page.locator('[data-testid=desktop-toggle]');
    await expect(toggle).toBeVisible();
    await page.click('.tab:has-text("一覧")');
    await toggle.click();
    const split = page.locator('[data-testid=desktop-split]');
    await expect(split).toBeVisible();
    // 幅が足りないので、一覧表は欄を減らす
    await expect(split.locator('.ov-t th')).toHaveText(['番号', '樹種', '有の項目', '特記事項', '注意']);

    await split.locator('.pane-l [data-tree=AB002]').click();
    const simple = split.locator('[data-testid=pane-simple]');
    await simple.locator('#f-height').fill('10');
    await simple.locator('#f-girth0').fill('0.5');
    await simple.locator('[data-group=initialNeeded] [data-v="要"]').click();
    await simple.locator('text=保存して次の木へ').click();
    await page.click('text=未入力のまま保存する');
    await page.click('[data-testid=initial-prompt-go]');
    // 「詳しい診断へ」で右の列が詳しい診断になる
    await expect(split.locator('[data-testid=pane-initial] [data-testid=initial-tree]')).toContainText('AB002');
    await expect(split.locator('[data-pane-tab=initial]')).toHaveClass(/on/);
    // 右の列は1つ。一覧から選ぶと簡易診断。詳しい診断の記録がある木は、上の切り替えで出す
    await split.locator('.pane-l [data-tree=AB002]').click();
    await expect(split.locator('[data-pane-tab]')).toHaveCount(2);
    await expect(split.locator('[data-testid=pane-initial]')).toHaveCount(0);
    await split.locator('[data-pane-tab=initial]').click();
    await expect(split.locator('[data-testid=pane-initial] [data-testid=initial-tree]')).toContainText('AB002');
    await expect(split.locator('[data-testid=pane-simple]')).toHaveCount(0);
    // 詳しい診断の記録がない木は切り替えを出さない
    await split.locator('.pane-l [data-tree=AB001]').click();
    await expect(split.locator('[data-pane-tab]')).toHaveCount(0);
    await expect(split.locator('[data-testid=pane-simple] #f-height')).toBeVisible();

    // 画面全体は動かない（左の一覧・右の列がそれぞれの中でスクロールする）
    const pageScroll = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
    expect(pageScroll).toBeLessThanOrEqual(1);
    const inner = await split.locator('[data-testid=pane-simple]').evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(inner).toBe(true);
    await expect(page.locator('footer')).toBeHidden();
    // 一覧を隠すと右の列が広がる。もう一度押すと戻る
    const w0 = await split.locator('.pane-r').evaluate((el) => el.clientWidth);
    await page.click('[data-testid=pane-list-toggle]');
    await expect(split.locator('.pane-l')).toBeHidden();
    const w1 = await split.locator('.pane-r').evaluate((el) => el.clientWidth);
    expect(w1).toBeGreaterThan(w0 + 200);
    await page.click('[data-testid=pane-list-toggle]');
    await expect(split.locator('.pane-l')).toBeVisible();

    // 縦に戻すと今までの表示
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-testid=desktop-split]')).toHaveCount(0);
    await expect(page.locator('[data-testid=desktop-toggle]')).toHaveCount(0);
  });
});
