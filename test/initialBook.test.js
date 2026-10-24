// 詳しい診断のデータ入力用ブックの読み込みと、その設定（initialSurvey）の検証のテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { emptyRowCount, filledIndex, readInitialBook } from '../src/excel/initialBook.js';
import { makeInitialBook } from './helpers/makeInitialBook.js';

const cfg = structuredClone(cfgJson);
const clone = () => structuredClone(cfgJson);

describe('設定 initialSurvey の検証', () => {
  it('見本の設定は通る。initialSurvey は省略してもよい', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const c = clone();
    delete c.initialSurvey;
    expect(validateConfig(c).ok).toBe(true);
  });

  it('形の違いを知らせる', () => {
    const bad = (fn) => {
      const c = clone();
      fn(c.initialSurvey);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((s) => delete s.label)).toContain('initialSurvey.label');
    expect(bad((s) => (s.book.sheets[0].form = 'other'))).toContain('form は');
    expect(bad((s) => (s.book.sheets[0].siteType = 'river'))).toContain('siteType は');
    expect(bad((s) => (s.book.sheets[0].name = '('))).toContain('シート名の正規表現');
    expect(bad((s) => (s.book.sheets[0].dataRow = 3))).toContain('dataRow');
    expect(bad((s) => delete s.book.sheets[0].columns.treeNo)).toContain('columns に treeNo');
    expect(bad((s) => (s.book.sheets[0].columns.b4.col = 'a1'))).toContain('columns.b4');
    expect(bad((s) => (s.book.sheets[0].columns.b4Grade.col = 'I'))).toContain('列が重複');
    expect(bad((s) => (s.book.sheets[0].columns.b4.header = '['))).toContain('header が正規表現');
    expect(bad((s) => s.book.sheets.push({ ...s.book.sheets[0] }))).toContain('同じ form・siteType');
  });
});

describe('データ入力用ブックの読み込み', () => {
  it('設定の列で読み、見出しが合っているか確かめる。入力済みの行と空き行を分ける', async () => {
    const r = await readInitialBook(await makeInitialBook(), cfg);
    expect(r.errors).toEqual([]);
    expect(r.sheets.map((s) => [s.name, s.spec.form])).toEqual([
      ['公園_詳しい診断', 'initial'],
      ['公園_周りの環境', 'environment'],
    ]);
    expect(r.missing.map((s) => `${s.form}|${s.siteType}`)).toEqual(['initial|street']); // 道路のシートはないが、誤りにはしない

    const [main, env] = r.sheets;
    expect(main.rows.map((x) => [x.rowNumber, x.filled])).toEqual([
      [5, true],
      [6, true],
      [7, false], // 通し番号だけ入っている行は空き行
      [8, false],
      [9, false],
    ]);
    expect(main.rows[0].values).toMatchObject({ serial: 1, year: 2099, month: 4, day: 5, treeNo: 'AB009', parkCode: 'K01', b4: '有（小）', b4Grade: '', b4Detail: '1本、地上2m' });
    expect(emptyRowCount(main)).toBe(3);
    expect(env.rows.filter((x) => x.filled).map((x) => x.values)).toEqual([{ treeNo: 'AB009', parkCode: 'K01', weather: '無', stake: '支柱なし' }]);
    expect(emptyRowCount(env)).toBe(3); // 「無」が先に入っていても、番号がなければ空き行
  });

  it('入力規則（ドロップダウン）の選択肢を読む', async () => {
    const r = await readInitialBook(await makeInitialBook(), cfg);
    expect(r.sheets[0].options).toEqual({ b4: ['無', '有（小）', '有（大）'], branchRatio: ['40≦'] });
    // 選択肢にない値を入れられない入力規則か（候補を出すだけのものは入らない）
    expect([...r.sheets[0].strict]).toEqual(['b4']);
    expect(r.sheets[1].options).toEqual({ stake: ['支柱なし', '無', '有'] });
  });

  it('入力済みの木の一覧（場所のコードと番号で見分ける。全角の番号も半角で数える）', async () => {
    const r = await readInitialBook(await makeInitialBook(), cfg);
    const idx = filledIndex(r, cfg);
    // 同じ番号でも場所のコードが違えば別の木
    expect(idx.get('initial|park|K01|AB009')).toEqual([{ sheet: '公園_詳しい診断', rowNumber: 5 }]);
    expect(idx.get('initial|park|K09|AB009')).toEqual([{ sheet: '公園_詳しい診断', rowNumber: 6 }]);
    expect(idx.get('environment|park|K01|AB009')).toHaveLength(1);
  });

  it('見出しが設定と違えば（列がずれているなど）知らせる', async () => {
    const r = await readInitialBook(await makeInitialBook({ envHeader: '台風の影響' }), cfg);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('公園_周りの環境');
    expect(r.errors[0]).toContain('C列（weather）');
    expect(r.errors[0]).toContain('台風の影響');
  });

  it('設定に initialSurvey がなければ読まない', async () => {
    const c = clone();
    delete c.initialSurvey;
    await expect(readInitialBook(await makeInitialBook(), c)).rejects.toThrow('initialSurvey');
  });
});
