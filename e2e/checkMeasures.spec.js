// 点検項目の下の部位・寸法（checks の measure）：その項目が当てはまるときに、その種類だけの寸法を入れる
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { makeLedger } from '../test/helpers/makeLedger.js';

function configFile() {
  const cfg = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  cfg.checks = cfg.checks.map((c) =>
    c.key === 'decay' ? { ...c, measure: { kinds: ['decay', 'rod'], eq: ['小', '有'] } } : c.key === 'deadBranch' ? { ...c, measure: { kinds: ['deadBranch'], eq: '有' } } : c,
  );
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/check-measures-config.json', JSON.stringify(cfg));
  return 'test-results/check-measures-config.json';
}

test('点検項目の下に、その項目の種類だけの部位・寸法を入れる（特記事項の下には残りの種類だけ）', async ({ page }) => {
  fs.writeFileSync('test-results/cm-ledger.xlsx', Buffer.from(await makeLedger()));
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', configFile());
  await page.setInputFiles('[data-testid=ledger-file]', 'test-results/cm-ledger.xlsx');
  await expect(page.locator('[data-testid=ledger-status] .ok')).toBeVisible();
  await page.click('.tab:has-text("一覧")');
  await page.click('[data-tree=AB002]');

  const decay = page.locator('[data-testid=check-measures][data-kinds="decay rod"]');
  const dead = page.locator('[data-testid=check-measures][data-kinds="deadBranch"]');
  // 当てはまらないうちは入れるボタンを出さない
  await page.click('[data-group=decay] [data-v="無"]');
  await expect(decay.locator('[data-testid=measure-open]')).toHaveCount(0);

  // 腐朽「小」→ 種類（腐朽・鋼棒貫入）を選んで入れる
  await page.click('[data-group=decay] [data-v="小"]');
  await decay.locator('[data-testid=measure-open]').click();
  const box = decay.locator('[data-testid=measure]');
  await expect(box.locator('[data-measure-kind]')).toHaveCount(2);
  await box.locator('[data-measure-kind=decay]').click();
  await box.locator('[data-measure-place="幹"]').click();
  await box.locator('[data-part="height.a"]').fill('1');
  await box.locator('[data-part="size.0.w"]').fill('10');
  await box.locator('[data-part="size.0.h"]').fill('20');
  await box.locator('[data-testid=measure-add]').click();
  await box.locator('[data-testid=measure-close]').click();
  await expect(decay.locator('[data-testid=measure-line]')).toHaveText(['幹の腐朽：地上1m、10cm×20cm']);

  // 枯れ枝「有」→ 種類が1つなので選ばずに開く（部位のない種類は、すぐ数字）
  await page.click('[data-group=deadBranch] [data-v="有"]');
  await dead.locator('[data-testid=measure-open]').click();
  const box2 = dead.locator('[data-testid=measure]');
  await expect(box2.locator('[data-measure-kind]')).toHaveCount(0);
  await box2.locator('[data-part=count]').fill('3');
  await box2.locator('[data-testid=measure-add]').click();
  await box2.locator('[data-testid=measure-close]').click();
  await expect(dead.locator('[data-testid=measure-line]')).toHaveText([/^枯れ枝：3本/]);

  // 特記事項の下には、点検項目に出していない種類（打診音異常・はみ出し）だけ。点検項目の下で入れた行は出さない
  const general = page.locator('[data-testid=measures]');
  await expect(general.locator('[data-testid=measure-line]')).toHaveCount(0);
  await expect(general.locator('[data-testid=measure-open]')).toHaveText('＋ 寸法を入れる（打診音異常・はみ出し）');

  // 「無」に戻しても入れた行は残る（消すかは人が決める）。入れるボタンは出さない
  await page.click('[data-group=deadBranch] [data-v="無"]');
  await expect(dead.locator('[data-testid=measure-line]')).toHaveCount(1);
  await expect(dead.locator('[data-testid=measure-open]')).toHaveCount(0);
});
