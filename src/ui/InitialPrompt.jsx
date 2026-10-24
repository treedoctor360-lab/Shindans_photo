// 保存した木が詳しい診断の対象なら「続けて入力する？」と聞く欄と、詳しい診断の画面を開く操作
//  簡易診断の画面（次の木の画面の上）と、一覧の画面（「保存して一覧へ」で戻ったとき）の両方で使う
import { toHalf } from '../core/text.js';
import { inBook, initialOf, startInitial } from '../store/initial.js';

// 詳しい診断の画面を開く操作を作る（記録がなければ作る。ブックで入力済みの木は force を付けたときだけ）
//  返す関数：(tree, force, viewOnly)。viewOnly は記録を作らずに開く（ブックに入力済みの木の内容を見るとき）
export const openInitialWith = (update, cfg, toast) => (tree, force = false, viewOnly = false) => {
  if (viewOnly) {
    update((s) => ({ ...s, view: 'initial', initialTreeId: tree.id, initialPrompt: '' }));
    window.scrollTo(0, 0);
    return;
  }
  try {
    update(
      (s) => {
        const r = startInitial(s, s.trees.find((x) => x.id === tree.id) || tree, cfg, { force });
        return { ...r.state, view: 'initial', initialTreeId: tree.id, initialPrompt: '' };
      },
      { now: true },
    );
    window.scrollTo(0, 0);
  } catch (e) {
    toast(e.message);
  }
};

export default function InitialPrompt({ state, update, cfg, openInitial }) {
  const tree = state.initialPrompt && state.trees.find((x) => x.id === state.initialPrompt);
  if (!tree || !cfg?.initialSurvey || state.user?.role === 'office') return null;
  return (
    <div className="alert info" data-testid="initial-prompt">
      <span>
        {toHalf(tree.treeNo) || '(番号なし)'} {tree.species} は{cfg.initialSurvey.label}が必要です。続けて入力しますか。
      </span>
      <div className="acts">
        <button type="button" className="btn fill" onClick={() => openInitial(tree, false, !initialOf(state, tree, cfg) && inBook(state, tree, cfg))} data-testid="initial-prompt-go">
          続けて{cfg.initialSurvey.label}を入力
        </button>
        <button type="button" className="btn" onClick={() => update((s) => ({ ...s, initialPrompt: '' }))}>
          あとで
        </button>
      </div>
    </div>
  );
}
