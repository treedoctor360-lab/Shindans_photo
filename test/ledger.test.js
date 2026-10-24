// 台帳の読み込みと取り込みのテスト
// 台帳は実物を使わず、テストの中で ExcelJS を使って架空の台帳を作る
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { alertsOf } from '../src/core/rules.js';
import { blankTree } from '../src/core/tree.js';
import { mergeLedger, readLedger } from '../src/excel/ledger.js';
import { isAddedTree } from '../src/store/actions.js';
import { makeLedger } from './helpers/makeLedger.js';

const cfg = structuredClone(cfgJson);

describe('台帳の読み込み', () => {
  it('見本の設定（台帳の書式を含む）は正しい', () => expect(validateConfig(cfg)).toEqual({ ok: true, errors: [] }));

  it('見出しの文字で列を探し、対象のシートだけを読む', async () => {
    const { rows, sheets } = await readLedger(await makeLedger(), cfg);
    expect(sheets.map((s) => [s.name, s.type])).toEqual([['公園', 'park'], ['道路', 'street']]);
    expect(rows.map((r) => `${r.sheetType}:${r.values.treeNo}`)).toEqual(['park:AB001', 'park:ＡＢ００２', 'park:AB003', 'park:AB001', 'street:AB001']);
    const v = rows[0].values;
    expect(v.heightRatio).toBe(53); // 式は計算結果を読む
    expect(v.note).toBe('枝の偏りあり。支柱は不要。'); // リッチテキストは文字だけ
    expect(v.date).toBeInstanceOf(Date);
  });
});

describe('台帳の取り込み', () => {
  it('入力済みの木は台帳の値で読み取り専用にし、未入力の木は情報だけ入れる', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const { trees, stats } = mergeLedger([], rows, cfg);
    expect(stats).toEqual({ all: 5, done: 1, conflicts: 0, duplicates: ['AB001'] });

    const t1 = trees.find((t) => t.siteType === 'park' && t.treeNo === 'AB001');
    expect(t1).toMatchObject({
      source: 'ledger', done: true, species: 'テストノキ', parkCode: 'K01', parkName: '架空公園',
      ledgerDate: '2099-04-05', ledgerInspector: '試験 一郎', height: '8.5', girths: ['0.5'], ledgerBranchRatio: '12.35',
      vigor: '良', lean: '無', deadBranch: '有', deadBranchCount: '3', decay: '無', fungus: '有', fungusName: 'ツヨイタケ',
      notes: '・枝の偏りあり。\n・支柱は不要。', dbNote: '枝の偏りあり。支柱は不要。', dbNoteManual: true,
      initialNeeded: '要', grade: '', treatFree: '枯れ枝剪定', photoOverride: '有',
    });

    const t2 = trees.find((t) => t.treeNo === 'AB002'); // 全角の番号は半角にする
    expect(t2).toMatchObject({ source: 'app', done: false, species: 'ミホンカエデ' });
    expect(trees.find((t) => t.treeNo === 'AB003').status).toBe('残存');
    // 同じ番号でも道路のシートの木は別の木
    expect(trees.find((t) => t.siteType === 'street')).toMatchObject({ treeNo: 'AB001', routeName: '架空通り', place: '北側', source: 'app' });
  });

  it('アプリでも入力済みだった木は、台帳を正とし、アプリの入力を控えに残す', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const mine = blankTree({ id: 'a1', siteType: 'park', treeNo: 'AB001', done: true, height: '9.9', notes: '・アプリの特記' });
    const before = structuredClone(mine);
    const { trees, stats } = mergeLedger([mine], rows, cfg);
    const t = trees.find((x) => x.id === 'a1');
    expect(stats.conflicts).toBe(1);
    expect(t.height).toBe('8.5');
    expect(t.appBackup).toMatchObject({ height: '9.9', notes: '・アプリの特記', source: 'app' });
    expect(t.appBackup.appBackup).toBeUndefined();
    expect(mine).toEqual(before); // 元のデータは書き換えない
  });

  it('2回読み込んでも、控えが上書きされたり増えたりしない', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const mine = blankTree({ id: 'a1', siteType: 'park', treeNo: 'AB001', done: true, height: '9.9' });
    const once = mergeLedger([mine], rows, cfg).trees;
    const twice = mergeLedger(once, rows, cfg);
    expect(twice.stats.conflicts).toBe(0);
    expect(twice.trees.find((x) => x.id === 'a1').appBackup.height).toBe('9.9');
    expect(twice.trees.filter((x) => x.treeNo === 'AB001' && x.siteType === 'park')).toHaveLength(2); // 台帳の2行分のまま
  });

  it('台帳の順に並べ、台帳にないアプリの木は後ろに残す', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const extra = blankTree({ id: 'new1', siteType: 'park', treeNo: 'ZZ900', done: true });
    const { trees } = mergeLedger([extra], rows, cfg);
    expect(trees.map((t) => `${t.siteType}:${t.treeNo}`)).toEqual(['park:AB001', 'park:AB002', 'park:AB003', 'park:AB001', 'street:AB001', 'park:ZZ900']);
    expect(trees.at(-1)).toMatchObject({ id: 'new1', source: 'app', done: true });
  });

  it('台帳で番号が重複していても行を捨てず、別の木として注意を出す（再読み込みでも増えない）', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const once = mergeLedger([], rows, cfg).trees;
    const { trees } = mergeLedger(once, rows, cfg);
    const dups = trees.filter((t) => t.siteType === 'park' && t.treeNo === 'AB001');
    expect(dups.map((t) => [t.dupIndex, t.parkName, t.species, t.ledgerDuplicate])).toEqual([
      [1, '架空公園', 'テストノキ', 2],
      [2, '別の架空公園', '別の樹種', 2],
    ]);
    expect(dups[1].ledgerRow).toEqual({ sheet: '公園', row: 6 });
    expect(alertsOf(dups[1], cfg).map((a) => a.id)).toContain('ledgerDuplicate');
    // 重複していない木には出さない
    expect(trees.find((t) => t.siteType === 'street').ledgerDuplicate).toBe(0);
  });

  it('台帳の書式が不正なら設定の検証で止める', () => {
    const bad = structuredClone(cfg);
    bad.dbFormat.doneKey = 'ないキー';
    bad.dbFormat.columns.vigor = '(';
    const r = validateConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/doneKey/);
    expect(r.errors.join('\n')).toMatch(/columns.vigor/);
  });
});

describe('【再発防止】台帳の木の番号が書き換えられた後に、台帳を読み込み直す', () => {
  it('台帳の木を作り直しても、印（id）がほかの木と重ならない。台帳にない木からは台帳の行の印を外す', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const first = mergeLedger([], rows, cfg).trees;
    // 台帳の木 AB002 の番号を消して、別の木（追加した木のつもり）に書き換えてしまった
    const broken = first.map((t) => (t.treeNo === 'AB002' ? { ...t, treeNo: '', species: '別の木', status: '追加' } : t));
    const { trees } = mergeLedger(broken, rows, cfg);
    const ids = trees.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // 印が重ならない
    const again = trees.filter((t) => t.treeNo === 'AB002');
    expect(again).toHaveLength(1); // 台帳の AB002 は作り直される
    const other = trees.find((t) => t.species === '別の木');
    expect(other.ledgerGone).toBe(true); // 今の台帳にない木に印 → 追加した木と同じく削除できる
    expect(isAddedTree(other)).toBe(true);
    expect(isAddedTree(again[0])).toBe(false);
    expect(again[0].ledgerGone).toBeUndefined();
  });
});
