// 記入済みのカルテ（Excel）を読み込む：木（入力済み）と写真（小さくして「写真」に、元の枠と見出しのまま）
//  （架空の様式・架空の木・塗りつぶしただけの絵。カルテはアプリの書き出しで作る）
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { files, png } from './officeFiles.js';
import { blankTree } from '../src/core/tree.js';
import { photoCaptionKey, simpleKarteRecord } from '../src/core/simpleKarte.js';
import { exportKarte } from '../src/excel/karteExport.js';
import { addKartePhotos } from '../src/excel/kartePhotos.js';
import { makeSimpleKarteTemplate } from '../test/helpers/makeSimpleKarte.js';

async function karteFile() {
  await files();
  const cfg = JSON.parse(fs.readFileSync('test-results/office-config.json', 'utf8'));
  // 路線番号の欄と、路線の一覧（架空）を足す
  cfg.karte.sheets[0].cells.push({ cell: 'D3', key: 'routeNo' });
  cfg.addGroups.fields.push({ key: 'routeNo', label: '路線番号' });
  cfg.addGroups.presets = [{ label: '試験の並木通り(テ9)', values: { routeName: '試験の並木通り(テ9)', routeNo: 'テ9' }, tree: { species: 'テストノキ' } }];
  fs.writeFileSync('test-results/karte-import-config.json', JSON.stringify(cfg));
  const base = { siteType: 'street', routeName: '試験の並木通り(テ9)', routeNo: 'テ9', species: 'テストノキ', done: true, date: '2099-11-10', measuresV: 2, measures: [] };
  const v = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  const trees = [
    blankTree({ ...base, id: 'a', treeNo: '1', girths: ['0.9'], lean: '無', decay: '無', notes: '枝の偏りが見られる。', initialNeeded: v.initial.no }),
    blankTree({ ...base, id: 'b', treeNo: '2', girths: ['1.1'], lean: '有', decay: '有', initialNeeded: v.initial.yes }),
  ];
  const recs = trees.map((t) => simpleKarteRecord(t, cfg));
  recs[1][photoCaptionKey(1)] = '試験の見出し';
  const r = await exportKarte(await makeSimpleKarteTemplate(), recs, cfg, cfg.karte, { submit: true });
  const p = await addKartePhotos(r.buffer, [{ sheet: '2', pics: [{ slot: 'full', data: png(30, 40, [20, 140, 60]), w: 30, h: 40 }, { slot: 'p1', data: png(40, 30, [150, 90, 30]), w: 40, h: 30 }] }], cfg.karte.photos);
  fs.writeFileSync('test-results/karte-filled.xlsx', Buffer.from(p.buffer));
}

test('記入済みのカルテを読み込むと、木と写真が入り、そのままカルテを出し直せる', async ({ page }) => {
  await karteFile();
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/karte-import-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=karte-template-file]', 'test-results/office-template.xlsx');
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();

  await page.setInputFiles('[data-testid=karte-import-file]', 'test-results/karte-filled.xlsx');
  await expect(page.locator('[data-testid=karte-import-plan]')).toContainText('karte-filled.xlsx：カルテ 2本・写真 2枚');
  await expect(page.locator('[data-testid=karte-import-group]')).not.toHaveValue(''); // 路線番号で一覧の路線が選ばれている
  await page.click('[data-testid=karte-import-run]');
  await expect(page.locator('[data-testid=karte-import-result]')).toContainText('読み込んだ木：2本・写真 2枚');

  // 一覧：2本とも入力済み
  await page.click('.tab:has-text("一覧")');
  await expect(page.locator('[data-testid=tree-cards] .card')).toHaveCount(2);
  await expect(page.locator('.view')).toContainText('2本中 2本 入力済み');

  // 写真：2番の札（No.2）と2枚。全景と写真1に入り、見出しもそのまま
  await page.click('.tab:has-text("写真")');
  await expect(page.locator('[data-testid=kp-tree-2] [data-testid="kp-2_full.jpeg"]')).toBeVisible();
  await page.click('[data-testid=kp-mode-pick]');
  await expect(page.locator('[data-testid=kp-tree-2]')).toContainText('全景・写真1');
  await expect(page.locator('[data-testid=kp-caption-2-p1]')).toHaveValue('試験の見出し');

  // 出し直したカルテにも写真が入る
  await page.click('.tab:has-text("出力")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-simple-karte]')]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  expect(wb.getWorksheet('2').getImages()).toHaveLength(2);
  expect(wb.getWorksheet('1').getImages()).toHaveLength(0);
  expect(wb.getWorksheet('2').getCell('A12').value).toBe('試験の見出し');
});
