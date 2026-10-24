// 画面の骨組み：上の調査情報バー、中の画面、下のタブ
import { useCallback, useRef, useState } from 'react';
import { groupLabel } from './core/groups.js';
import FormView from './ui/FormView.jsx';
import InitialView from './surveys/initial/InitialView.jsx';
import ListView, { activeGroup } from './ui/ListView.jsx';
import OutView from './ui/OutView.jsx';
import SettingsView from './ui/SettingsView.jsx';
import { useAppState } from './ui/useAppState.js';
import { useTopHeight } from './ui/useTopHeight.js';
import { reviewStatesOf } from './store/review.js';
import { APP_VERSION } from './version.js';

const TABS = [
  ['list', '一覧'],
  ['form', '入力'],
  ['out', '出力'],
  ['settings', '設定'],
];

// 日付 "2099-04-05" → "2099/4/5"
const slashDate = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-');
  return y ? `${y}/${+m}/${+d}` : '';
};

export default function App() {
  const app = useAppState();
  const { state, update, ready, saveError } = app;
  useTopHeight(ready); // 上の帯の高さ（入力画面で、帯のすぐ下に樹木番号などを止めるため）

  // 画面下に短いお知らせを出す
  const [toastMsg, setToastMsg] = useState('');
  const timer = useRef(null);
  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(''), 4000);
  }, []);

  const go = (view) => {
    update((s) => ({ ...s, view }));
    window.scrollTo(0, 0);
  };

  if (!ready) return <div className="app"><p className="hint" style={{ padding: 16 }}>読み込み中…</p></div>;

  const s = state.session;
  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1>{app.config?.job?.title || '樹木点検 野帳'}</h1>
          {/* 本番の野帳アプリと見分けるための印（写真機能の試作版） */}
          <span className="proto" data-testid="photo-trial">写真試作 v{APP_VERSION}</span>
        </div>
        <div className="meta" data-testid="top-meta">
          {app.config && state.trees.length ? `${groupLabel(state.trees, activeGroup(state, app.config), app.config)}　` : ''}
          {slashDate(s.date)}　{s.inspector}
        </div>
      </header>

      {app.config && state.server?.url && app.sendStatus?.error && state.view !== 'out' && (
        <div className="alert warn" style={{ margin: '12px 16px 0' }}>
          未送信の入力があります（{app.sendStatus.error}）。端末には保存済みです。
        </div>
      )}
      {app.config && state.server?.url && (() => {
        // 気付いてほしいこと：調査者には返事待ちの付箋、事務には回答済みの付箋、どちらにも食い違い
        const role = state.user?.role || 'surveyor';
        //  詳しい診断の記録も、その木の分として数える
        const want = role === 'office' ? 'answered' : 'asked';
        const states = state.trees.map((t) => reviewStatesOf(t, state, app.config));
        const conflicts = states.filter((x) => x.includes('conflict')).length;
        const n = states.filter((x) => !x.includes('conflict') && x.includes(want)).length;
        if (!conflicts && !n) return null;
        const msg = [
          n ? (role === 'office' ? `調査者から返事が来た木が${n}本あります` : `事務から付箋が届いた木が${n}本あります`) : '',
          conflicts ? `別の端末と食い違っている木が${conflicts}本あります` : '',
        ]
          .filter(Boolean)
          .join('。');
        return (
          <button
            type="button"
            className="alert info notice"
            style={{ margin: '12px 16px 0' }}
            onClick={() => update((s2) => ({ ...s2, view: 'list', listFilter: conflicts ? 'conflict' : want }))}
            data-testid="review-notice"
          >
            {msg}（タップで一覧）
          </button>
        );
      })()}
      {saveError && (
        <div className="alert danger" role="alert" style={{ margin: '12px 16px 0' }}>
          {saveError}
        </div>
      )}

      <main>
        {state.view === 'settings' && <SettingsView {...app} toast={toast} />}
        {state.view === 'list' && <ListView {...app} toast={toast} />}
        {state.view === 'form' && <FormView key={state.currentId} {...app} toast={toast} />}
        {state.view === 'initial' && <InitialView key={state.initialTreeId} {...app} toast={toast} />}
        {state.view === 'out' && <OutView {...app} toast={toast} />}
      </main>
      <footer>© 2026– Koh Kitsukawa. All rights reserved.</footer>

      <nav className="tabs">
        <div className="tabs-in">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" className={`tab${state.view === k ? ' on' : ''}`} onClick={() => go(k)}>
              <b>{label}</b>
            </button>
          ))}
        </div>
      </nav>

      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
