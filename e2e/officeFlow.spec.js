// 内勤の流れ：入力表（Excel）を読み込む → 写真を入れて木ごとに区切り、貼る写真を選ぶ → 写真つきのカルテを出力する
//  （設定 entrySheet・karte.photos・karte.unconfirmedOk。架空の様式・架空の木・塗りつぶしただけの絵）
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { makeSimpleKarteTemplate, simpleKarteConfig } from '../test/helpers/makeSimpleKarte.js';

// 1色で塗った PNG を作る（写真の代わり）
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function files() {
  const base = JSON.parse(fs.readFileSync('test/fixtures/sample-config.json', 'utf8'));
  const cfg = simpleKarteConfig(base);
  cfg.karte.sheets[0].siteType = 'street';
  cfg.karte.sheets[0].cells.push({ cell: 'A12', key: '@photoCaption1' });
  cfg.karte.unconfirmedOk = true;
  cfg.karte.photos = {
    slots: [
      { key: 'full', label: '全景', range: 'H2:I10', full: true },
      { key: 'p1', label: '写真1', range: 'A13:C18', caption: 1 },
    ],
    captions: ['架空の見出し'],
  };
  cfg.noGrade = true;
  cfg.numbering = { start: 1, carry: ['species'] };
  cfg.addGroups = { siteType: 'street', label: '路線', fields: [{ key: 'routeName', label: '路線名' }] };
  cfg.entrySheet = {
    info: { routeName: 'C1' },
    date: 'M1',
    inspector: 'M2',
    dataRow: 4,
    columns: { treeNo: 'A', species: 'B', height: 'C', girth: 'D', lean: 'E', vigor: 'F', deadBranch: 'G', decay: 'H', fungus: 'I', initialNeeded: 'J', remarks: 'K' },
    values: { '－': '無' },
    same: ['〃'],
    remarks: [{ re: '根の締め付け', note: '根が幹を締め付けている。' }],
  };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/office-config.json', JSON.stringify(cfg));
  fs.writeFileSync('test-results/office-template.xlsx', Buffer.from(await makeSimpleKarteTemplate()));
  // 入力表（架空）
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('路線1');
  ws.getCell('C1').value = '試験の並木通り';
  ws.getCell('M1').value = new Date(Date.UTC(2099, 4, 6));
  ws.getCell('M2').value = '試験 二郎';
  const v = base.options;
  const rows = [
    [1, 'テストノキ', 6.5, 0.68, '－', v.vigor[0], '－', '－', '－', base.initial.no, '根の締め付け'],
    [2, '〃', 7, 0.8, '－', v.vigor[0], '－', '－', '－', base.initial.no, ''],
    [3, '〃', 7, 0.8, '－', v.vigor[0], '－', '－', '－', base.initial.no, 'なぞの書き込み'],
  ];
  rows.forEach((r, i) => r.forEach((x, c) => (ws.getCell(4 + i, c + 1).value = x)));
  await wb.xlsx.writeFile('test-results/office-entry.xlsx');
  // 写真（撮った順は、ファイルの更新日時で決まる）
  const shots = [['n1', 40, 30], ['a1', 30, 40], ['a2', 40, 30], ['n2', 40, 30], ['b1', 40, 30]];
  return shots.map(([name, w, h], i) => {
    const p = `test-results/office-${name}.png`;
    fs.writeFileSync(p, png(w, h, [40 * i, 120, 200 - 30 * i]));
    const t = new Date(2099, 4, 6, 10, i, 0);
    fs.utimesSync(p, t, t);
    return p;
  });
}

test('入力表を読み込み、写真を木ごとに区切って選び、写真つきのカルテを出力できる', async ({ page }) => {
  const photos = await files();
  await page.goto('./');
  await page.setInputFiles('[data-testid=config-file]', 'test-results/office-config.json');
  await expect(page.locator('[data-testid=config-status] .ok')).toBeVisible();
  await page.setInputFiles('[data-testid=karte-template-file]', 'test-results/office-template.xlsx');
  await expect(page.locator('[data-testid=karte-template-status] .ok')).toBeVisible();

  // 入力表を読み込む：3本。読み取れない備考のある3番は入力中のまま
  await page.setInputFiles('[data-testid=entry-sheet-file]', 'test-results/office-entry.xlsx');
  await expect(page.locator('.toast')).toContainText('3本を読み込みました（うち1本は確かめてください）');
  await expect(page.locator('[data-testid=entry-sheet-result]')).toContainText('路線1 3：備考の読み取れなかった部分：なぞの書き込み');

  // 3番を開くと、読み取れなかった備考が出る。確かめて保存する
  await page.click('.tab:has-text("一覧")');
  await page.locator('[data-testid=tree-cards] .card[data-tree="3"]').click();
  await expect(page.locator('[data-testid=entry-left]')).toContainText('なぞの書き込み');
  await page.click('[data-testid=entry-left-clear]');
  await expect(page.locator('[data-testid=entry-left]')).toHaveCount(0);

  // 写真：5枚を入れ、番号の写真を2枚選ぶ
  await page.click('.tab:has-text("写真")');
  await page.setInputFiles('[data-testid=kp-files]', photos);
  await expect(page.locator('.toast')).toContainText('5枚を入れました');
  await page.locator('[data-testid="kp-office-n1.png"] .kp-img').click();
  await page.locator('[data-testid="kp-office-n2.png"] .kp-img').click();
  await expect(page.locator('[data-testid="kp-office-n2.png"] .kp-badge')).toHaveText('No.2');
  // 貼る写真を選ぶ：1番は縦の写真（a1）が全景に入っている。横の写真（a2）を押すと写真1に入る
  await page.click('[data-testid=kp-mode-pick]');
  const t1 = page.locator('[data-testid=kp-tree-1]');
  await expect(t1.locator('[data-testid="kp-office-a1.png"] .kp-badge')).toHaveText('全景');
  await t1.locator('[data-testid="kp-office-a2.png"] .kp-img').click();
  await expect(t1.locator('[data-testid="kp-office-a2.png"] .kp-badge')).toHaveText('写真1');
  await page.fill('[data-testid=kp-caption-1-p1]', '架空の見出し');

  // 画面を読み込み直しても、選んだ内容は残る
  await page.reload();
  await page.click('.tab:has-text("写真")');
  await expect(page.locator('[data-testid=kp-tree-1] [data-testid="kp-office-a2.png"] .kp-badge')).toHaveText('写真1');

  // 出力：確定していなくても出せる。写真は1番に2枚（2番は横の写真だけなので、全景は入らない）
  await page.click('.tab:has-text("出力")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-simple-karte]')]);
  await expect(page.locator('.toast')).toContainText('写真2枚を1本に貼りました');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  expect(wb.worksheets.map((w) => w.name)).toEqual(['1', '2', '選択肢']);
  expect(wb.getWorksheet('1').getImages()).toHaveLength(2);
  expect(wb.getWorksheet('2').getImages()).toHaveLength(0);
  expect(wb.getWorksheet('1').getCell('A12').value).toBe('架空の見出し');
  expect(wb.getWorksheet('1').getCell('C9').value).toBe('根が幹を締め付けている。');
  expect(wb.getWorksheet('1').getCell('C2').value).toEqual(new Date(Date.UTC(2099, 4, 6)));
});
