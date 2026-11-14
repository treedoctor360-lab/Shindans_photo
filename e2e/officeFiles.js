// 内勤の流れのテストで使う架空のファイル（設定・カルテの様式・入力表・写真）を test-results に作る
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

export async function files() {
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

