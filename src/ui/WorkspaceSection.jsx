// 業務の切り替え（この端末の中で、業務ごとに入力内容・設定・台帳を分けて持つ。src/store/workspace.js）
//  業務が2つ以上あるときだけ出す。切り替えると画面を読み込み直す（その前に、今の入力内容を保存し切る）
import { useEffect, useState } from 'react';
import { loadWorkspaces, switchWorkspace } from '../store/workspace.js';

export const workspaceName = (w) => w.title || '（名前なし）';

export default function WorkspaceSection({ flush, toast }) {
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorkspaces()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  if (!meta || meta.list.length < 2) return null;

  const go = async (id) => {
    setBusy(true);
    try {
      await flush(); // 待っている保存を、今の業務の置き場所に書き切ってから切り替える
      await switchWorkspace(id);
      window.location.reload();
    } catch (e) {
      setBusy(false);
      toast(e.message || '切り替えられませんでした');
    }
  };

  return (
    <div className="sec" data-testid="workspaces">
      <h2>業務（この端末の置き場所）</h2>
      <p className="hint">
        業務ごとに、入力内容・設定・台帳・サーバーの設定を分けて持っています。切り替えても、ほかの業務の入力内容は消えません。
      </p>
      {meta.list.map((w) => (
        <div className="row" key={w.id || 'first'}>
          <span className="lbl">{workspaceName(w)}</span>
          {w.id === meta.current ? (
            <span className="ok" data-testid="workspace-current">
              使用中
            </span>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={() => go(w.id)} data-testid="workspace-switch">
              この業務に切り替える
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
