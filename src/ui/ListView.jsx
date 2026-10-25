// 一覧画面：公園・路線を選び、木の一覧から入力する木を選ぶ
import { groupKey, groupKeys, groupLabel, treesOfGroup } from '../core/groups.js';
import { alertsOf } from '../core/rules.js';
import { monthDay, toHalf } from '../core/text.js';
import { useState } from 'react';
import { addTree } from '../store/actions.js';
import { REVIEW_LABEL, confirmable, initialRecordOf, reviewState, reviewStatesOf, setConfirm } from '../store/review.js';
import { INITIAL, simpleKey } from '../store/surveys.js';
import { photoPlan } from '../core/photo.js';
import { shotStatus } from '../core/photoShots.js';
import { prevOf } from '../store/previous.js';
import { INITIAL_STATUS_LABEL, initialStatus, isInitialTarget } from '../store/initial.js';
import { usePrevIndex } from './usePrevious.js';
import { matchTree } from '../core/search.js';
import InitialPrompt, { openInitialWith } from './InitialPrompt.jsx';
import RedateBox from './RedateBox.jsx';

const NO_AREA = '本区画';

// 木の状態：未入力 / 詳しい診断待ち / 台帳で入力済み / アプリで入力済み
export function treeState(t, cfg) {
  if (!t.done) return 'todo';
  if (t.initialNeeded === cfg.initial.yes) return 'wait';
  return t.source === 'ledger' ? 'ledger' : 'done';
}

// 「姓 名(資格)・姓 名(資格)」→「姓・姓」
const surnames = (s) =>
  String(s || '')
    .split(/[・･·、,]/)
    .map((x) => x.replace(/\(.*?\)|（.*?）/g, '').trim().split(/\s+/)[0])
    .filter(Boolean)
    .join('・');

// 確認の段階での絞り込み
const REVIEW_FILTERS = [
  ['asked', '付箋の返事待ち'],
  ['answered', '回答済み'],
  ['submitted', '未確定'],
  ['confirmed', '確定'],
  ['conflict', '食い違い'],
];

export default function ListView({ state, update, config: cfg, send, toast }) {
  const [askBulk, setAskBulk] = useState(false);
  const prevIndex = usePrevIndex();
  if (!cfg || !state.trees.length) {
    return (
      <section className="view">
        <div className="sec">
          <h2>一覧</h2>
          <p className="hint">「設定」で設定ファイルと台帳を読み込むと、ここに木の一覧が出ます。</p>
          <button type="button" className="btn big" onClick={() => update((s) => ({ ...s, view: 'settings' }))}>
            設定を開く
          </button>
        </div>
      </section>
    );
  }

  const keys = groupKeys(state.trees, cfg);
  const group = keys.includes(state.group) ? state.group : keys[0];
  // 削除した木は「削除した木」の絞り込みでだけ出す（本数にも数えない）
  const inGroup = treesOfGroup(state.trees, group, cfg);
  const deleted = inGroup.filter((t) => t.deleted);
  const all = inGroup.filter((t) => !t.deleted);
  const areas = [...new Set(all.map((t) => t.area || NO_AREA))];
  const area = areas.includes(state.area) ? state.area : '';
  const filter = state.listFilter === 'deleted' && !deleted.length ? 'all' : state.listFilter || 'all';
  const inArea = (t) => !area || (t.area || NO_AREA) === area;
  const rsOf = (t) => (t.conflict ? 'conflict' : reviewState(t, state, cfg));
  // 確認の段階での絞り込みは、木と、その木の詳しい診断の記録のどちらかが当てはまれば出す
  const rsHas = (t, k) => reviewStatesOf(t, state, cfg).includes(k);
  const iniRs = (t) => {
    const r = initialRecordOf(state, t, cfg);
    return r ? (r.conflict ? 'conflict' : reviewState(r, state, cfg, INITIAL)) : null;
  };
  // 検索：言葉があるときは、区画・状態の絞り込みを外して、この公園・路線のすべての木から探す
  const query = String(state.listQuery || '').trim();
  const searching = !!query;
  // ほかの公園・路線で見つかった木（押すとその公園・路線に切り替えて開く）
  const elsewhere = searching ? state.trees.filter((t) => !t.deleted && groupKey(t, cfg) !== group && matchTree(t, query)) : [];
  // 探す範囲：'group'（この公園・路線。ほかで見つかった木は下に出す）/ 'all'（すべての公園・路線をまとめて上に出す）
  const scopeAll = searching && state.listScope === 'all';
  const filtered = (filter === 'deleted' ? deleted : all)
    .filter(inArea)
    .filter(
      (t) =>
        filter === 'deleted' ||
        filter === 'all' ||
        (filter === 'todo' && !t.done) ||
        (filter === 'wait' && treeState(t, cfg) === 'wait') ||
        rsHas(t, filter),
    );
  const hereHits = searching ? all.filter((t) => matchTree(t, query)) : [];
  const list = scopeAll ? [...hereHits, ...elsewhere] : searching ? hereHits : filtered;
  const useReview = !!state.server?.url;
  const role = state.user?.role || 'surveyor';
  const bulk = role === 'office' ? confirmable(all.filter(inArea), state, cfg) : [];
  // 詳しい診断の記録も、付箋のない提出済みのものはまとめて確定できる
  const bulkIni =
    role === 'office'
      ? confirmable(
          all
            .filter(inArea)
            .map((t) => initialRecordOf(state, t, cfg))
            .filter(Boolean),
          state,
          cfg,
          INITIAL,
        )
      : [];
  const iniLabel = cfg.initialSurvey?.label || '詳しい診断';
  const bulkText = [bulk.length ? `${bulk.length}本` : '', bulkIni.length ? `${iniLabel}${bulkIni.length}件` : ''].filter(Boolean).join('・');
  const onBulk = () => {
    const ids = new Set(bulk.map((t) => t.id));
    const iniIds = new Set(bulkIni.map((r) => r.id));
    update(
      (s) => {
        let next = s;
        for (const t of s.trees.filter((x) => ids.has(x.id))) next = setConfirm(next, t, true, cfg);
        for (const r of (s.initials || []).filter((x) => iniIds.has(x.id))) next = setConfirm(next, r, true, cfg, INITIAL);
        return next;
      },
      { now: true },
    ).then(() => send?.());
    toast?.(`${bulkText}を確定しました`);
    setAskBulk(false);
  };
  const done = all.filter((t) => t.done).length;
  const wait = all.filter((t) => treeState(t, cfg) === 'wait').length;
  const ledgerDone = all.filter((t) => t.source === 'ledger').length;
  const waitLabel = cfg.initial.waitLabel || '診断待ち';
  const statusLabel = (v) => cfg.statusOptions?.find((o) => o.v === v)?.label ?? v;

  const set = (patch) => update((s) => ({ ...s, ...patch }));
  const open = (id, g = group) => {
    // 印（id）のない木は開けない（別の木を開いてしまわないように）。端末の状態を読み込むときに直すので、通常は起きない
    if (!id) return toast?.('この木は開けません。「設定」の「調べるためのデータを書き出す」で書き出して、開発の担当に送ってください');
    update((s) => ({ ...s, group: g, ...(g !== group ? { area: '' } : {}), currentId: id, view: 'form' }));
  };

  return (
    <section className="view">
      {/* 「保存して一覧へ」で戻ったとき、保存した木が詳しい診断の対象なら続けて入力するか聞く */}
      <InitialPrompt state={state} update={update} cfg={cfg} openInitial={openInitialWith(update, cfg, toast)} />
      <div className="row">
        <label className="lbl" htmlFor="s-group">
          公園・路線
        </label>
        <select
          id="s-group"
          value={group}
          onChange={(e) => set({ group: e.target.value, area: '' })}
          style={{ minHeight: 44, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--sunk)', padding: '0 8px' }}
        >
          {keys.map((k) => {
            const ts = treesOfGroup(state.trees, k, cfg).filter((t) => !t.deleted);
            return (
              <option key={k} value={k}>
                {groupLabel(state.trees, k, cfg)}（{ts.filter((t) => t.done).length}/{ts.length}）
              </option>
            );
          })}
        </select>
      </div>

      <div className="prog">
        <div className="lbl">
          {all.length}本中 {done}本 入力済み{' '}
          <small>
            うち台帳で入力済み {ledgerDone}本・{waitLabel} {wait}本
          </small>
        </div>
        <div className="bar">
          <i style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="row search">
        <input
          type="search"
          value={state.listQuery || ''}
          onChange={(e) => set({ listQuery: e.target.value })}
          placeholder="樹木番号・樹種で探す（例：830、くすのき）"
          aria-label="樹木番号・樹種で探す"
          data-testid="list-search"
        />
        {searching && (
          <button type="button" className="btn" onClick={() => set({ listQuery: '' })} data-testid="list-search-clear">
            消す
          </button>
        )}
      </div>
      {searching && (
        <>
          {/* 探す範囲を選ぶ（どの公園・路線の木か分からないときは「すべて」） */}
          <div className="filters" data-testid="search-scope">
            <button type="button" className={`chip${scopeAll ? '' : ' on'}`} onClick={() => set({ listScope: 'group' })} data-scope="group">
              この公園・路線（{hereHits.length}本）
            </button>
            <button type="button" className={`chip${scopeAll ? ' on' : ''}`} onClick={() => set({ listScope: 'all' })} data-scope="all">
              すべての公園・路線（{hereHits.length + elsewhere.length}本）
            </button>
          </div>
          <p className="hint" data-testid="search-note">
            「{query}」で探しています：{scopeAll ? `すべての公園・路線で${list.length}本` : `この公園・路線で${list.length}本`}（区画・状態の絞り込みは外しています）
          </p>
        </>
      )}

      {!searching && areas.length > 1 && (
        <div className="filters">
          {[['', '全区画'], ...areas.map((a) => [a, a])].map(([k, l]) => (
            <button key={k || 'all'} type="button" className={`chip${area === k ? ' on' : ''}`} onClick={() => set({ area: k })}>
              {l}（{k ? all.filter((t) => (t.area || NO_AREA) === k).length : all.length}）
            </button>
          ))}
        </div>
      )}
      {!searching && (
        <div className="filters">
          {[
            ['all', 'すべて'],
            ['todo', '未入力'],
            ['wait', waitLabel],
            ...(deleted.length ? [['deleted', `削除した木（${deleted.length}）`]] : []),
          ].map(([k, l]) => (
            <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => set({ listFilter: k })} data-filter={k}>
              {l}
            </button>
          ))}
        </div>
      )}
      {!searching && useReview && (
        <div className="filters" data-testid="review-filters">
          {REVIEW_FILTERS.map(([k, l]) => {
            const n = all.filter(inArea).filter((t) => rsHas(t, k)).length;
            return (
              <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => set({ listFilter: k })} data-filter={k}>
                {l}（{n}）
              </button>
            );
          })}
        </div>
      )}
      {bulk.length + bulkIni.length > 0 &&
        (askBulk ? (
          <div className="alert info">
            <span>付箋のない提出済みの{bulkText}を確定します（{area || 'すべての区画'}）。</span>
            <div className="acts">
              <button type="button" className="btn fill" onClick={onBulk} data-testid="bulk-confirm-ok">
                確定する
              </button>
              <button type="button" className="btn" onClick={() => setAskBulk(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAskBulk(true)} data-testid="bulk-confirm">
            付箋のない提出済みの{bulkText}をまとめて確定
          </button>
        ))}

      <div className="cards" data-testid="tree-cards">
        {list.map((t) => {
          const st = treeState(t, cfg);
          const nWarn = t.done && t.source !== 'ledger' ? alertsOf(t, cfg).filter((a) => a.lv !== 'info').length : 0;
          return (
            <button key={t.id} type="button" className="card" onClick={() => open(t.id, groupKey(t, cfg))} data-tree={toHalf(t.treeNo)}>
              {st === 'todo' ? (
                <span className="pill none">未</span>
              ) : st === 'wait' ? (
                <span className="pill wait">{cfg.initial.pill || '待ち'}</span>
              ) : (
                <span className={`pill ${t.grade}`} style={st === 'ledger' ? { opacity: 0.55 } : undefined}>
                  {t.grade || '?'}
                </span>
              )}
              <span style={{ minWidth: 0 }}>
                <span className="no">{t.treeNo || '(番号なし)'}</span>
                <br />
                <span className="sp">{t.species || '樹種未入力'}</span>
                {/* すべての公園・路線で探したときは、どの公園・路線の木かを樹種の下に出す */}
                {scopeAll && (
                  <>
                    <br />
                    <small className="hint" data-testid="card-group">
                      {groupLabel(state.trees, groupKey(t, cfg), cfg)}
                    </small>
                  </>
                )}
              </span>
              <span className="tags">
                {t.area && <span className="tag">{t.area}</span>}
                {t.source === 'ledger' && (
                  <span className="tag">
                    台帳 {monthDay(t.ledgerDate)} {surnames(t.ledgerInspector)}
                  </span>
                )}
                {/* アプリで入力した木は、調査日と調査者（姓） */}
                {t.source !== 'ledger' && t.done && (t.date || t.inspector) && (
                  <span className="tag" data-testid="card-stamp">
                    {monthDay(t.date)} {surnames(t.inspector)}
                  </span>
                )}
                {/* 写真：撮った枚数／撮る枚数（足りなければ色を付ける） */}
                {t.source !== 'ledger' && t.done && !t.deleted && (() => {
                  const ps = shotStatus(photoPlan(t, cfg), state.photos, simpleKey(t, cfg));
                  return ps.need > 0 ? (
                    <span className={`tag${ps.taken < ps.need ? ' w' : ''}`} data-testid="card-photo">
                      写真 {ps.taken}/{ps.need}
                    </span>
                  ) : null;
                })()}
                {t.appBackup && <span className="tag w">アプリ入力の控えあり</span>}
                {t.ledgerDuplicate > 0 && <span className="tag w">番号重複</span>}
                {t.deleted && <span className="tag w">削除</span>}
                {t.status && <span className="tag new">{statusLabel(t.status)}</span>}
                {t.planInitial && <span className="tag w">{cfg.initial.pill || '診断'}予定</span>}
                {isInitialTarget(t, cfg) && (
                  <span className={`tag${['both'].includes(initialStatus(t, state, cfg)) ? ' w' : ''}`} data-initial={initialStatus(t, state, cfg)}>
                    {cfg.initial.pill || '診断'}：{INITIAL_STATUS_LABEL[initialStatus(t, state, cfg)]}
                  </span>
                )}
                {useReview && ['asked', 'answered', 'confirmed', 'conflict'].includes(iniRs(t)) && (
                  <span className={`tag rs-${iniRs(t)}`} data-initial-review={iniRs(t)}>
                    {cfg.initial.pill || '診断'}：{iniRs(t) === 'conflict' ? '食い違い' : REVIEW_LABEL[iniRs(t)]}
                  </span>
                )}
                {nWarn > 0 && <span className="tag w">要確認{nWarn}</span>}
                {prevOf(t, prevIndex, cfg) && <span className="tag prev">{cfg.previous?.label || '前回'}カルテ</span>}
                {useReview && ['asked', 'answered', 'confirmed', 'conflict'].includes(rsOf(t)) && (
                  <span className={`tag rs-${rsOf(t)}`}>{rsOf(t) === 'conflict' ? '食い違い' : REVIEW_LABEL[rsOf(t)]}</span>
                )}
              </span>
            </button>
          );
        })}
        {!list.length && <p className="hint">該当する木はありません。</p>}
      </div>
      {!scopeAll && elsewhere.length > 0 && (
        <div className="sec" data-testid="search-elsewhere">
          <h2>ほかの公園・路線で見つかった木（{elsewhere.length}本）</h2>
          <div className="cards">
            {elsewhere.slice(0, 30).map((t) => (
              <button key={t.id} type="button" className="card" onClick={() => open(t.id, groupKey(t, cfg))} data-tree={toHalf(t.treeNo)}>
                <span className={`pill ${t.done ? t.grade || '' : 'none'}`}>{t.done ? t.grade || '?' : '未'}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="no">{t.treeNo || '(番号なし)'}</span>
                  <br />
                  <span className="sp">{t.species || '樹種未入力'}</span>
                </span>
                <span className="tags">
                  <span className="tag">{groupLabel(state.trees, groupKey(t, cfg), cfg)}</span>
                </span>
              </button>
            ))}
          </div>
          {elsewhere.length > 30 && <p className="hint">ほか{elsewhere.length - 30}本。言葉を足して絞り込んでください。</p>}
        </div>
      )}
      <button
        type="button"
        className="btn big"
        onClick={() => update((s) => addTree({ ...s, group }, cfg, { area: area && area !== NO_AREA ? area : '' }))}
      >
        ＋ 一覧にない木を追加
      </button>
      {/* 調査日を間違えて保存した木を、この公園・路線でまとめて直す（入力内容を直すのは調査者だけ） */}
      {role === 'surveyor' && (
        <RedateBox key={group} state={state} update={update} cfg={cfg} trees={all} groupName={groupLabel(state.trees, group, cfg)} send={send} toast={toast} />
      )}
    </section>
  );
}

// 一覧で選んでいるまとまりの鍵（ほかの画面でも使う）
export const activeGroup = (state, cfg) => {
  const keys = groupKeys(state.trees, cfg);
  return keys.includes(state.group) ? state.group : keys[0] || '';
};
export { groupKey };
