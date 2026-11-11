// 業務ごとの置き場所（src/store/workspace.js）
//  別の業務の設定を使っても、前の業務の入力内容は消えず、切り替えれば戻れる
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { idbGetRaw, idbPut, idbReset } from '../src/store/idb.js';
import { initialState, loadAll, saveState } from '../src/store/state.js';
import { blankTree } from '../src/core/tree.js';
import { loadWorkspaces, needsNewWorkspace, putConfigInWorkspace, rememberTitle, switchWorkspace } from '../src/store/workspace.js';

const cfgA = structuredClone(cfgJson);
const cfgB = { ...structuredClone(cfgJson), job: { title: '架空の別業務', year: 2099 } };
const tree = (no) => blankTree({ id: no, treeNo: no, species: 'テストノキ' });

// 画面を読み込み直したときと同じ：データベースを開き直して読み込む
const restart = async () => {
  await idbReset();
  return loadAll();
};

beforeEach(async () => {
  await idbReset();
  indexedDB.deleteDatabase('shindans_photo');
});

describe('業務ごとの置き場所', () => {
  it('前からある入力内容は、最初の業務としてそのまま読める（鍵は今までどおり）', async () => {
    await idbPut('state', { ...initialState(), trees: [tree('A1')] });
    await idbPut('config', cfgA);
    const { state, config } = await restart();
    expect(state.trees.map((t) => t.treeNo)).toEqual(['A1']);
    expect(config.job.title).toBe(cfgA.job.title);
    expect(await idbGetRaw('state')).toBeTruthy(); // 頭に印の付かない鍵のまま
    expect((await loadWorkspaces()).list.map((w) => w.id)).toEqual(['']);
  });

  it('名前の違う設定を、別の業務として使う → 空から始まり、前の業務は消えずに切り替えで戻れる', async () => {
    await saveState({ ...initialState(), trees: [tree('A1'), tree('A2')], server: { ...initialState().server, url: 'https://example.invalid/a' } });
    await idbPut('config', cfgA);
    await rememberTitle(cfgA.job.title);

    const r = await putConfigInWorkspace(cfgB, 1000);
    expect(r.created).toBe(true);
    let got = await restart();
    expect(got.config.job.title).toBe('架空の別業務');
    expect(got.state.trees).toEqual([]);
    expect(got.state.server.url).toBe(''); // サーバーの設定も業務ごと
    await saveState({ ...got.state, trees: [tree('1')] });

    // 前の業務へ戻る
    const meta = await loadWorkspaces();
    expect(meta.list.map((w) => w.title)).toEqual([cfgA.job.title, '架空の別業務']);
    await switchWorkspace('');
    got = await restart();
    expect(got.state.trees.map((t) => t.treeNo)).toEqual(['A1', 'A2']);
    expect(got.state.server.url).toBe('https://example.invalid/a');
    expect(got.config.job.title).toBe(cfgA.job.title);

    // また別の業務へ（同じ名前の業務があれば、新しく作らずそこへ）
    const again = await putConfigInWorkspace(cfgB, 2000);
    expect([again.created, again.id]).toEqual([false, r.id]);
    got = await restart();
    expect(got.state.trees.map((t) => t.treeNo)).toEqual(['1']);
  });

  it('新しい業務として聞くのは、今の業務に木があり、名前が違うときだけ', () => {
    const s = { trees: [tree('A1')] };
    expect(needsNewWorkspace(s, cfgA, cfgB)).toBe(true);
    expect(needsNewWorkspace(s, cfgA, cfgA)).toBe(false); // 同じ業務の設定の入れ替え
    expect(needsNewWorkspace({ trees: [] }, cfgA, cfgB)).toBe(false); // 何も入っていない
    expect(needsNewWorkspace(s, null, cfgB)).toBe(false); // 設定がまだない
  });

  it('ない業務には切り替えない', async () => {
    await expect(switchWorkspace('nowhere')).rejects.toThrow('その業務はこの端末にありません');
  });
});
