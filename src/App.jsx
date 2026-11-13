// 画面の骨組み：上の調査情報バー、中の画面、下のタブ
import { useCallback, useEffect, useRef, useState } from 'react';
import { groupLabel } from './core/groups.js';
import FormView from './ui/FormView.jsx';
import InitialView from './surveys/initial/InitialView.jsx';
import ListView, { activeGroup } from './ui/ListView.jsx';
import OutView from './ui/OutView.jsx';
import PhotoView from './ui/PhotoView.jsx';
import SettingsView from './ui/SettingsView.jsx';
import { useAppState } from './ui/useAppState.js';
import { useTopHeight } from './ui/useTopHeight.js';
import { useDesktop } from './ui/useDesktop.js';
import OverviewTable from './ui/OverviewTable.jsx';
import { reviewStatesOf } from './store/review.js';
import { inBook, initialOf, isInitialTarget } from './store/initial.js';
import { APP_VERSION, BUILD_TIME } from './version.js';

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
  const desk = useDesktop();
  // デスクトップ表示：一覧（左）・簡易診断（中）・詳しい診断（右）を並べる。設定・出力の画面は今までどおり
  const split = desk.active && !!app.config && ['list', 'form', 'initial'].includes(state.view);
  // 並べている間は、簡易診断と詳しい診断で同じ木を見る（片方で木を変えたら、もう片方も合わせる）
  useEffect(() => {
    if (!split) return;
    if (state.view === 'initial' && state.initialTreeId && state.initialTreeId !== state.currentId) update((cur) => ({ ...cur, currentId: cur.initialTreeId }));
    else if (state.view === 'form' && state.currentId && state.currentId !== state.initialTreeId) update((cur) => ({ ...cur, initialTreeId: cur.currentId }));
  }, [split, state.view, state.currentId, state.initialTreeId]);
  useTopHeight(ready); // 上の帯の高さ（入力画面で、帯のすぐ下に樹木番号などを止めるため）
  // 横にしたスマホ（2列）で、左の一覧を隠して右の列を広げるか
  const [listHidden, setListHidden] = useState(false);

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
    <div className={`app${split ? ' desk' : ''}${split && desk.compact ? ' compact' : ''}`}>
      <header className="top">
        <div className="top-row">
          <h1>{app.config?.job?.title || '樹木点検 野帳'}</h1>
          {desk.wide && app.config && (
            <button type="button" className={`desk-btn${desk.on ? ' on' : ''}`} onClick={desk.toggle} aria-pressed={desk.on} data-testid="desktop-toggle">
              デスクトップ表示{desk.on ? '：オン' : ''}
            </button>
          )}
          {/* 本番の野帳アプリと見分けるための印（試作版） */}
          <span className="proto" data-testid="trial-mark">試作</span>
          <span className="proto" data-testid="app-version">v{APP_VERSION}{BUILD_TIME && `（${BUILD_TIME}）`}</span>
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

      {split ? (
        <main className={`split${desk.compact && listHidden && state.view !== 'list' && state.currentId ? ' list-hidden' : ''}`} data-testid="desktop-split">
          <section className="pane-l">
            <OverviewTable {...app} toast={toast} compact={desk.compact} />
          </section>
          <section className="pane-r">
            {state.view !== 'list' && state.currentId && desk.compact ? (
              // 横にしたスマホ：簡易診断と詳しい診断を上の切り替えで出す（詳しい診断は記録かブックの内容がある木だけ）
              (() => {
                const t = state.trees.find((x) => x.id === state.currentId);
                const cfg = app.config;
                const hasIni = !!(cfg.initialSurvey && t && isInitialTarget(t, cfg) && (initialOf(state, t, cfg) || inBook(state, t, cfg)));
                // 右の列に出すのは、今の画面（簡易診断／詳しい診断）。切り替えは画面を切り替える
                const tab = hasIni && state.view === 'initial' ? 'initial' : 'form';
                const setPaneTab = (v) => update((cur) => ({ ...cur, view: v, initialTreeId: v === 'initial' ? cur.currentId : cur.initialTreeId }));
                return (
                  <div className="pane-cols one">
                    <div className="pane-head">
                      {/* 一覧を隠すと、右の列を画面いっぱいに広げる */}
                      <button type="button" className="btn pane-list-btn" onClick={() => setListHidden((v) => !v)} aria-pressed={!listHidden} data-testid="pane-list-toggle">
                        {listHidden ? '一覧を出す' : '一覧を隠す'}
                      </button>
                      {hasIni && (
                        <div className="seg pane-tabs" role="tablist">
                          <button type="button" className={`seg-b${tab === 'form' ? ' on' : ''}`} onClick={() => setPaneTab('form')} data-pane-tab="form">
                            簡易診断
                          </button>
                          <button type="button" className={`seg-b${tab === 'initial' ? ' on' : ''}`} onClick={() => setPaneTab('initial')} data-pane-tab="initial">
                            {cfg.initialSurvey.label}
                          </button>
                        </div>
                      )}
                    </div>
                    {tab === 'form' ? (
                      <div className="pane-col" data-testid="pane-simple" key={`s-${state.currentId}`}>
                        <FormView key={state.currentId} {...app} toast={toast} />
                      </div>
                    ) : (
                      <div className="pane-col" data-testid="pane-initial" key={`i-${state.currentId}`}>
                        <InitialView key={state.currentId} {...app} toast={toast} pane />
                      </div>
                    )}
                  </div>
                );
              })()
            ) : state.view !== 'list' && state.currentId ? (
              <div className="pane-cols">
                <div className="pane-col" data-testid="pane-simple" key={`s-${state.currentId}`}>
                  <FormView key={state.currentId} {...app} toast={toast} />
                </div>
                <div className="pane-col" data-testid="pane-initial" key={`i-${state.currentId}`}>
                  <InitialView key={state.currentId} {...app} toast={toast} pane />
                </div>
              </div>
            ) : (
              <p className="pane-empty">左の一覧から木を選んでください</p>
            )}
          </section>
        </main>
      ) : (
      <main>
        {state.view === 'settings' && <SettingsView {...app} toast={toast} />}
        {state.view === 'list' && <ListView {...app} toast={toast} />}
        {state.view === 'form' && <FormView key={state.currentId} {...app} toast={toast} />}
        {state.view === 'initial' && <InitialView key={state.initialTreeId} {...app} toast={toast} />}
        {state.view === 'photo' && <PhotoView {...app} toast={toast} />}
        {state.view === 'out' && <OutView {...app} toast={toast} />}
      </main>
      )}
      <footer>© 2026– Koh Kitsukawa. All rights reserved.</footer>

      <nav className="tabs">
        <div className="tabs-in">
          {TABS.flatMap((x) => (x[0] === 'out' && app.config?.karte?.photos ? [['photo', '写真'], x] : [x])).map(([k, label]) => (
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
