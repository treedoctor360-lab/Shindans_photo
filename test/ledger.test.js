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
    expect(stats).toEqual({ all: 5, done: 1, conflicts: 0, duplicates: ['AB001'], addedBound: [], speciesDiff: [], addedLeft: [], goneRemoved: [], goneKept: [], goneBlank: [], placeMoved: [] });

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

describe('【再現】一覧表から消えた木のうち、アプリで入力していない台帳の写しは外す（PI0385 の件）', () => {
  it('台帳で入力済みの写しは外し、台帳から作った木・アプリで入力した木・控えのある木は残して知らせる', async () => {
    const { rows } = await readLedger(await makeLedger(), cfg);
    const first = mergeLedger([], rows, cfg).trees;
    // 番号が書き換わって今の台帳にない、という状態を作る（行は同じ、番号だけ別）
    const gone = (t, extra) => ({ ...t, treeNo: `${t.treeNo}X`, ...extra });
    const [a, b, c, d] = first;
    const trees = [
      gone(a, { source: 'ledger', done: true }), // 台帳で入力済みの写し → 外す
      gone(b, { height: '5' }), // 台帳から作った木にアプリで何か書いた（入力中）→ 残す
      gone(c, { source: 'app', done: true, vigor: '1', rev: 2 }), // アプリで入力した → 残す
      gone(d, { source: 'ledger', done: true, appBackup: { vigor: '1' } }), // アプリの入力の控えがある → 残す
      ...first.slice(4),
    ];
    const { trees: out, stats } = mergeLedger(trees, rows, cfg);
    const ids = out.map((t) => t.id);
    expect(ids).not.toContain(a.id);
    for (const t of [b, c, d]) expect(out.find((x) => x.id === t.id).ledgerGone).toBe(true);
    expect(stats.goneRemoved).toEqual([`${a.treeNo}X`]);
  });
});

describe('一覧表の読み込み直しで、記録を迷子にしない・持ち越さない', () => {
  const load = async () => (await readLedger(await makeLedger(), cfg)).rows;
  const nk = (s) => String(s).normalize('NFKC');
  it('【再現】台帳の写しでも、詳しい診断の記録などがある木（keepIds）は、一覧表から消えても外さない', async () => {
    const rows = await load();
    const first = mergeLedger([], rows, cfg).trees;
    const copy = first.find((t) => t.source === 'ledger');
    const rest = rows.filter((r) => nk(r.values.treeNo) !== nk(copy.treeNo));
    const without = mergeLedger(first, rest, cfg);
    expect(without.stats.goneRemoved).toEqual([nk(copy.treeNo)]);
    const kept = mergeLedger(first, rest, cfg, { keepIds: new Set([copy.id]) });
    expect(kept.stats).toMatchObject({ goneRemoved: [], goneKept: [nk(copy.treeNo)] });
    expect(kept.trees.find((t) => t.id === copy.id)).toMatchObject({ ledgerGone: true });
  });
  it('一覧表から消えた空の木は外す（入力のある木は残す）', async () => {
    const rows = await load();
    const first = mergeLedger([], rows, cfg).trees;
    const blank = first.filter((t) => !t.done);
    const filled = { ...blank[1], done: true, source: 'app', vigor: '良' };
    const trees = first.map((t) => (t.id === filled.id ? filled : t));
    const gone = [blank[0], blank[1]].map((t) => nk(t.treeNo));
    const r = mergeLedger(trees, rows.filter((x) => !gone.includes(nk(x.values.treeNo))), cfg);
    expect(r.stats.goneBlank).toEqual([gone[0]]);
    expect(r.trees.some((t) => t.id === blank[0].id)).toBe(false);
    expect(r.trees.find((t) => t.id === filled.id)).toMatchObject({ ledgerGone: true, done: true });
  });
  it('【再現】同じ番号の行が別の場所で上に入ったとき、空の木は前の樹種を持ち越さない。台帳の写しの樹種は台帳に従う', async () => {
    const rows = await load();
    const first = mergeLedger([], rows, cfg).trees;
    const b = first.find((t) => !t.done);
    const src = rows.find((r) => nk(r.values.treeNo) === nk(b.treeNo));
    const done = rows.find((r) => String(r.values[cfg.dbFormat.doneKey] ?? '').trim());
    // 同じ番号で、別の場所・別の樹種・入力済みの行を、いちばん上に入れた一覧表
    const top = { ...done, rowNumber: 1, values: { ...done.values, treeNo: src.values.treeNo, parkName: '別の架空公園', species: 'ベツノキ' } };
    const r = mergeLedger(first, [top, ...rows], cfg);
    const t1 = r.trees.find((t) => nk(t.treeNo) === nk(b.treeNo) && t.dupIndex === 1);
    expect(t1).toMatchObject({ parkName: '別の架空公園', species: 'ベツノキ', source: 'ledger' });
    // 入力のある木が別の場所の行に当たったら知らせる
    const filled = first.map((t) => (t.id === b.id ? { ...t, done: true, source: 'app', vigor: '良' } : t));
    expect(mergeLedger(filled, [top, ...rows], cfg).stats.placeMoved.length).toBe(1);
    // 台帳の写しの樹種：台帳で直されたら従う
    const copy = first.find((t) => t.source === 'ledger');
    const fixed = rows.map((x) => (nk(x.values.treeNo) === nk(copy.treeNo) ? { ...x, values: { ...x.values, species: 'ナオシタキ' } } : x));
    expect(mergeLedger(first, fixed, cfg).trees.find((t) => t.id === copy.id).species).toBe('ナオシタキ');
  });
});
