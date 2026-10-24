// 入力画面：1本ずつ、紙の野帳と同じ順に入力する
import { useState } from 'react';
import { branchRatioRaw, branchRatioText, girthOf, heightRatioOf } from '../core/calc.js';
import { groupLabel, treesOfGroup } from '../core/groups.js';
import { dbNoteOf, freeNoteLines, isChipLine, noteLines, toggleChip } from '../core/notes.js';
import { appendNoteLine } from '../core/noteMeasures.js';
import NoteMeasures from './NoteMeasures.jsx';
import SessionStamp from './SessionStamp.jsx';
import { photoFlag, photoPlan } from '../core/photo.js';
import { alertsOf, missingFields } from '../core/rules.js';
import { num, toHalf } from '../core/text.js';
import { composeTreat } from '../core/treat.js';
import { isDead, isLocked } from '../core/tree.js';
import {
  deleteTree,
  fillChecksNone,
  isAddedTree,
  normalizeField,
  pressAlertAction,
  pressOption,
  restoreTree,
  saveTree,
  toggleTreat,
  touched,
  updateTree,
  withdrawTree,
} from '../store/actions.js';
import { activeGroup } from './ListView.jsx';
import { INITIAL_STATUS_LABEL, inBook, initialOf, initialStatus, isInitialTarget } from '../store/initial.js';
import InitialPrompt, { openInitialWith } from './InitialPrompt.jsx';
import PrevPanel from './PrevPanel.jsx';
import PhotoShots from './PhotoShots.jsx';
import ReviewPanel from './ReviewPanel.jsx';

const MODE_TEXT = { 'full+weak': '全景＋弱点写真', shared: '全景と共用', fullOnly: '全景だけ（写真で見えない弱点のみ）' };

// 選択ボタンの並び
function Seg({ field, opts, value, onPress, disabled, className = '', labels }) {
  return (
    <div className={`seg ${className}`} role="group" data-group={field}>
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          className={`seg-b${value === o ? ' on' : ''}`}
          data-v={o}
          aria-pressed={value === o}
          disabled={disabled}
          onClick={() => onPress(field, o)}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

// 押す前に確かめるボタン（取り消しにくい操作）と、そのときの説明
const CONFIRM = {
  resurvey: '台帳の値を下書きにして、この木をアプリで入力し直します。保存すると、一覧表にはアプリで入力した値が書き込まれます（元の台帳のファイルは変わりません）。',
  useApp: '台帳の値の代わりに、アプリで入力した内容を使います。一覧表にはアプリで入力した値が書き込まれます（元の台帳のファイルは変わりません）。',
};

// 注意・提案の一覧。asking：確かめ中のボタン { alertId, act }
function Alerts({ list, onAct, asking, onAsk, onCancel }) {
  return (
    <div className="alerts">
      {list.map((a) => (
        <div key={a.id} className={`alert ${a.lv}`} data-alert={a.id}>
          <span>{a.msg}</span>
          {asking?.alertId === a.id ? (
            <div className="confirm" data-testid="confirm-act">
              <b>{CONFIRM[asking.act.type]}よろしいですか？</b>
              <div className="acts">
                <button type="button" className="btn fill" onClick={() => onAct(a, asking.act)} data-testid="confirm-yes">
                  {asking.act.label}
                </button>
                <button type="button" className="btn" onClick={onCancel} data-testid="confirm-no">
                  やめる
                </button>
              </div>
            </div>
          ) : (
            a.acts?.length > 0 && (
            <div className="acts">
              {a.acts.map((act) => (
                <button key={act.label} type="button" className="btn" onClick={() => (CONFIRM[act.type] ? onAsk(a, act) : onAct(a, act))}>
                  {act.label}
                </button>
              ))}
            </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}

// 簡易診断の画面の中の、詳しい診断の欄（進み具合と、入力の画面を開くボタン）
function InitialBlock({ t, state, cfg, openInitial }) {
  const status = initialStatus(t, state, cfg);
  const book = inBook(state, t, cfg);
  const office = state.user?.role === 'office';
  const label = cfg.initialSurvey.label;
  return (
    <div className="sec" data-testid="initial-block">
      <h2>{label}</h2>
      <span className="hint" data-initial={status}>
        {INITIAL_STATUS_LABEL[status]}
        {book && status === 'book' ? '（データ入力用ブックに手で入力済み。アプリで入力すると二重になります）' : ''}
      </span>
      {initialOf(state, t, cfg) || !book ? (
        <button type="button" className="btn" onClick={() => openInitial(t)} data-testid="open-initial" disabled={office && !initialOf(state, t, cfg)}>
          {office ? `${label}を見る` : `${label}を入力`}
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => openInitial(t, false, true)} data-testid="open-initial-book">
          ブックの内容を見る
        </button>
      )}
    </div>
  );
}

export default function FormView({ state, update, config: cfg, toast, send, getState }) {
  const [showAllChips, setShowAllChips] = useState(false);
  const [missingAsk, setMissingAsk] = useState(null); // 保存しようとしたときの未入力の一覧
  const [asking, setAsking] = useState(null); // 確かめ中のボタン { alertId, act }
  const [undo, setUndo] = useState(null); // 直前の操作を取り消すための、押す前の木 { treeId, before, label }
  const [askRemove, setAskRemove] = useState(''); // 削除・入力の取り消しを確かめ中の木の id
  const [askAfter, setAskAfter] = useState('next'); // 未入力を確かめ中の保存の行き先

  if (!cfg || !state.trees.length) {
    return (
      <section className="view">
        <p className="hint">「設定」で設定ファイルと台帳を読み込んでください。</p>
      </section>
    );
  }
  const group = activeGroup(state, cfg);
  // 削除した木は前後の移動に出さない（削除した木を開いているときだけ、その木を含める）
  const ts = treesOfGroup(state.trees, group, cfg).filter((x) => !x.deleted || x.id === state.currentId);
  let t = ts.find((x) => x.id === state.currentId);
  // 選んだ木がどこにもないときは、別の木を黙って開かない（別の木を書き換えてしまう事故を防ぐ）
  //  公園・路線を切り替えた後など、選んだ木が別のまとまりにあるだけなら、今までどおり今のまとまりの未入力の木を開く
  if (!t && state.currentId && !state.trees.some((x) => x.id === state.currentId)) {
    return (
      <section className="view">
        <div className="alert danger" data-testid="tree-missing">
          <span>選んだ木を開けませんでした。別の木を書き換えないよう、ここで止めています。</span>
          <span>
            「設定」の一番下の「調べるためのデータを書き出す」で書き出したファイルを、開発の担当に送ってください。
          </span>
          <div className="acts">
            <button type="button" className="btn" onClick={() => update((s) => ({ ...s, currentId: '', view: 'list' }))} data-testid="back-to-list">
              一覧に戻る
            </button>
          </div>
        </div>
      </section>
    );
  }
  if (!t) t = ts.find((x) => !x.done) || ts[0]; // 木を選んでいないとき・別のまとまりに切り替えたときは、未入力の木から
  if (!t) return <section className="view"><p className="hint">木がありません。</p></section>;

  const idx = ts.indexOf(t);
  // 台帳で入力済みの木は直せない。事務の端末では、提出された木は直さず付箋で修正案を出す
  const officeView = state.user?.role === 'office' && t.source === 'app' && t.done;
  const readOnly = t.source === 'ledger' || officeView || !!t.deleted;
  const surveyor = (state.user?.role || 'surveyor') !== 'office';
  const locked = isLocked(t, cfg);
  // 入力済みの木を直したら、送り直しの印を付ける
  const change = (fn, opt) => update((s) => updateTree({ ...s, currentId: t.id, group }, t.id, (x) => touched(fn(x))), opt);
  const setField = (k, v) => change((x) => ({ ...x, [k]: v, ...(k === 'dbNote' ? { dbNoteManual: true } : {}) }));
  const blurField = (k) => change((x) => normalizeField(x, k, cfg));
  const press = (field, v) => change((x) => pressOption(x, field, v, cfg));
  const go = (id) => {
    setMissingAsk(null);
    update((s) => ({ ...s, currentId: id, group }));
    window.scrollTo(0, 0);
  };

  const onAct = (a, act) => {
    setAsking(null);
    if (CONFIRM[act.type]) setUndo({ treeId: t.id, before: t, label: act.label });
    update((s) => pressAlertAction({ ...s, currentId: t.id }, t.id, act, a.id, cfg), { now: true });
    if (act.type === 'addNote') toast('特記事項に理由を入れました。必要なら書き換えてください');
    if (act.type === 'resurvey') toast('再調査として入力できるようにしました（台帳の値を下書きにしています）');
    if (act.type === 'useApp') toast('アプリの入力に戻しました');
    if (act.type === 'fixWording') toast('表記を直しました（定型文のボタンの行はそのままです）');
  };

  // 詳しい診断の画面を開く（InitialPrompt.jsx の openInitialWith）
  const openInitial = openInitialWith(update, cfg, toast);

  // 保存。after：保存の後に 'next'（次の未入力の木）/ 'list'（一覧へ）/ 'add'（もう1本追加）/ 'stay'（同じ木のまま）
  const onSave = (force = false, after = 'next') => {
    const r = saveTree({ ...state, currentId: t.id, group }, cfg, { force, after });
    if (!r.saved) {
      setMissingAsk(r.missing);
      setAskAfter(after); // 「未入力のまま保存する」を押したときも、同じ行き先にする
      return;
    }
    setMissingAsk(null);
    // 詳しい診断が必要な木なら、次の木の画面で「続けて入力」を聞く（同じ木のままなら、画面の「詳しい診断を入力」から開ける）
    const prompt = after !== 'stay' && cfg.initialSurvey?.forms && isInitialTarget(r.state.trees.find((x) => x.id === t.id) || t, cfg) ? t.id : '';
    // 保存は「その時点の最新の状態」に対して行う（画面を描いた後に送受信で届いた変更を、古い状態で上書きしないように）
    update((cur) => ({ ...saveTree({ ...cur, currentId: t.id, group }, cfg, { force: true, after }).state, initialPrompt: prompt }), { now: true }).then(() => send?.()); // 端末に保存してから、裏でサーバーへ送る
    toast(`${toHalf(t.treeNo) || 'この木'} を保存しました`);
    if (after !== 'stay') window.scrollTo(0, 0); // 同じ木のままなら、見ていた所から続けて直せるよう動かさない
  };

  // 削除（追加した木）・入力の取り消し（台帳の木）・元に戻す
  const name = `${toHalf(t.treeNo) || '(番号なし)'} ${t.species || ''}`.trim();
  const removeAct = isAddedTree(t)
    ? {
        label: 'この木を削除',
        ok: '削除する',
        text:
          t.rev > 0
            ? `「${name}」を削除します。一覧・一覧表・野帳に出なくなり、他の端末でも削除になります（「削除した木」から元に戻せます）。`
            : `「${name}」を削除します。まだサーバーに送っていない木なので、この端末から消えます（元に戻せません）。`,
        fn: deleteTree,
        done: '削除しました',
      }
    : { label: '入力を取り消す（未入力に戻す）', ok: '取り消す', text: `「${name}」の入力を取り消して未入力に戻します（入力した値は下書きとして残ります）。`, fn: withdrawTree, done: '未入力に戻しました' };
  const canRemove = surveyor && !t.deleted && (isAddedTree(t) || (t.source === 'app' && t.done));
  const onRemove = () => {
    setAskRemove('');
    try {
      const next = removeAct.fn({ ...state, currentId: t.id, group }, t.id); // できないときはここで止まる（知らせを出す）
      const gone = !next.trees.some((x) => x.id === t.id); // サーバーに届いていない木は端末から消える
      // 実際の変更は、その時点の最新の状態に対して行う（送受信で届いた変更を上書きしないように）
      update(
        (cur) => {
          const n = removeAct.fn({ ...cur, currentId: t.id, group }, t.id);
          return gone ? { ...n, view: 'list' } : n;
        },
        { now: true },
      ).then(() => send?.());
      toast(removeAct.done);
    } catch (e) {
      toast(e.message);
    }
  };
  const onRestore = () => {
    update((s) => restoreTree(s, t.id), { now: true }).then(() => send?.());
    toast('元に戻しました');
  };

  // 表示する値
  const sheet = cfg.dbFormat.sheets.find((s) => s.type === t.siteType);
  const place = [groupLabel(state.trees, group, cfg), t.place].filter(Boolean).join('　');
  const g = girthOf(t, cfg);
  const hd = heightRatioOf(t, cfg);
  const blr = isDead(t, cfg) ? null : branchRatioRaw(t);
  const bl = branchRatioText(t, cfg);
  const gv = (t.girths || []).map(num).filter(Boolean);
  const ratioRule = cfg.rules.find((r) => r.type === 'ratioAtLeast');
  const limit = (kind) => ratioRule?.items.find((i) => i.ratio === kind)?.threshold ?? Infinity;
  const treat = composeTreat(t, cfg);
  const plan = photoPlan(t, cfg);
  const autoPhoto = plan.weakPhoto ? cfg.photo.flagYes : cfg.photo.flagNo;
  const alerts = alertsOf(t, cfg);
  const topAlerts = alerts.filter((a) => a.acts?.some((x) => ['resurvey', 'useApp'].includes(x.type)));
  const otherAlerts = alerts.filter((a) => !topAlerts.includes(a));
  const chipsShow = cfg.noteChipsShow ?? 10;
  const lines = noteLines(t.notes);
  const free = freeNoteLines(t.notes, cfg);
  const strongWords = cfg.rules.filter((r) => r.type === 'contains').flatMap((r) => r.anyOf);
  const treeNoRule = cfg.rules.find((r) => r.type === 'treeNoPattern');
  const badNo = !!t.treeNo && treeNoRule && !new RegExp(treeNoRule.pattern).test(toHalf(t.treeNo));
  const gradeLocked = t.initialNeeded === cfg.initial.yes;
  const missing = readOnly ? [] : missingFields(t, cfg);
  const isOn = (k, v) => t[k] === v;
  const felling = cfg.rules.filter((r) => r.type === 'treatRequires').filter((r) => new RegExp(r.pattern).test(treat));

  return (
    <section className="view" data-testid="form">
      {/* 前後の木の帯は画面の上に残す（スクロールしても、いまどの木を入力しているか分かるように） */}
      <div className="sub tree-bar" style={{ justifyContent: 'space-between' }} data-testid="tree-bar">
        <button type="button" className="btn nav-tree" disabled={idx <= 0} onClick={() => go(ts[idx - 1].id)} data-testid="prev-tree">
          ← 前の木
          {idx > 0 && <small className="nav-no">{toHalf(ts[idx - 1].treeNo) || '(番号なし)'}</small>}
        </button>
        <span className="tree-bar-name">
          <b className="no" data-testid="tree-bar-no">{toHalf(t.treeNo) || '(番号なし)'}</b>{' '}
          <span data-testid="tree-bar-species">{t.species}</span>
          <small className="hint">
            {idx + 1} / {ts.length}
          </small>
        </span>
        <button type="button" className="btn nav-tree" disabled={idx >= ts.length - 1} onClick={() => go(ts[idx + 1].id)} data-testid="next-tree">
          次の木 →
          {idx < ts.length - 1 && <small className="nav-no">{toHalf(ts[idx + 1].treeNo) || '(番号なし)'}</small>}
        </button>
      </div>

      <InitialPrompt state={state} update={update} cfg={cfg} openInitial={openInitial} />
      <ReviewPanel t={t} state={state} update={update} config={cfg} toast={toast} send={send} />
      {cfg.initialSurvey?.forms && isInitialTarget(t, cfg) && (
        <InitialBlock t={t} state={state} cfg={cfg} openInitial={openInitial} />
      )}
      <PrevPanel t={t} state={state} config={cfg} toast={toast} />
      {t.deleted && (
        <div className="alert warn" data-testid="deleted-note">
          <span>この木は削除しました。一覧・一覧表・野帳には出ません。</span>
          {surveyor && (
            <div className="acts">
              <button type="button" className="btn" onClick={onRestore} data-testid="restore-tree">
                元に戻す
              </button>
            </div>
          )}
        </div>
      )}
      {officeView && (
        <div className="readonly-note" data-testid="readonly-note">
          表示のみ：事務の端末では入力内容を直せません。直してほしいところは付箋の修正案で伝えます。
        </div>
      )}
      {t.source === 'ledger' && (
        <div className="readonly-note" data-testid="readonly-note">
          表示のみ：台帳で調査済みの木です（{t.ledgerDate ? `${t.ledgerDate.replace(/-/g, '/')} ` : ''}
          {t.ledgerInspector || ''}）。調べ直すときは、下の「調べ直す」を押します。
        </div>
      )}

      <fieldset disabled={readOnly} className="form-body">
        <div className="sec">
          <h2>樹木</h2>
          <div className="hint">{place}</div>
          <div className="grid2">
            <div className="row">
              <label className="lbl" htmlFor="f-treeNo">
                樹木番号
              </label>
              <input
                type="text"
                id="f-treeNo"
                className={`num${badNo ? ' bad' : ''}`}
                value={t.treeNo}
                readOnly={!isAddedTree(t)} // 台帳の木の番号は変えない（別の木なら「一覧にない木を追加」）
                autoCapitalize="characters"
                placeholder={cfg.treeNoPlaceholder || ''}
                onChange={(e) => setField('treeNo', e.target.value)}
                onBlur={() => blurField('treeNo')}
              />
              {!isAddedTree(t) && (
                <small className="hint" data-testid="treeno-locked">
                  台帳の木の番号は変えられません。別の木を入れるときは、一覧の「一覧にない木を追加」を使います。
                </small>
              )}
            </div>
            <div className="row">
              <label className="lbl" htmlFor="f-species">
                樹種
              </label>
              <input
                type="text"
                id="f-species"
                list="spList"
                value={t.species}
                onChange={(e) => setField('species', e.target.value)}
                onBlur={() => {
                  const after = normalizeField(t, 'species', cfg).species;
                  if (after !== t.species.trim()) toast(`${t.species.trim()} → ${after} に置き換えました`);
                  blurField('species');
                }}
              />
            </div>
          </div>
          <datalist id="spList">
            {cfg.species.list.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {cfg.statusOptions && (
            <div className="row">
              <span className="lbl">状態</span>
              <div className="seg" role="group">
                {cfg.statusOptions.map((o) => (
                  <button
                    key={o.v || 'none'}
                    type="button"
                    className={`seg-b${(t.status || '') === o.v ? ' on' : ''}`}
                    onClick={() => setField('status', o.v)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="row">
            <label className="lbl" htmlFor="f-prev">
              前回の特記 <small>野帳では樹木番号の横に出ます</small>
            </label>
            <input type="text" id="f-prev" value={t.prevNote || ''} onChange={(e) => setField('prevNote', e.target.value)} />
          </div>
        </div>

        <div className="sec">
          <h2>計測</h2>
          <div className="grid2">
            <div className="row">
              <label className="lbl" htmlFor="f-height">
                樹高
              </label>
              <div className="unit">
                <input type="text" inputMode="decimal" id="f-height" className="num" value={t.height} onChange={(e) => setField('height', e.target.value)} onBlur={() => blurField('height')} />
                <span>m</span>
              </div>
            </div>
            <div className="row">
              <span className="lbl">
                幹周 <small>株立は幹ごとに</small>
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(t.girths || ['']).map((gi, i) => (
                  <div className="unit" key={i}>
                    <input
                      type="text"
                      inputMode="decimal"
                      id={`f-girth${i}`}
                      className="num"
                      aria-label={`幹周${i + 1}`}
                      value={gi}
                      onChange={(e) => change((x) => ({ ...x, girths: x.girths.map((v, j) => (j === i ? e.target.value : v)) }))}
                      onBlur={() => change((x) => ({ ...x, girths: x.girths.map((v) => toHalf(v).trim()) }))}
                    />
                    <span>m</span>
                  </div>
                ))}
              </div>
              <div className="sub">
                <button type="button" className="more" onClick={() => change((x) => ({ ...x, girths: [...x.girths, ''] }))}>
                  ＋ 幹を追加
                </button>
                {t.girths.length > 1 && (
                  <button type="button" className="more" onClick={() => change((x) => ({ ...x, girths: x.girths.slice(0, -1) }))}>
                    − 1本減らす
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="grid2">
            <div className="row">
              <label className="lbl" htmlFor="f-bl">
                枝長
              </label>
              <div className="unit">
                <input type="text" inputMode="decimal" id="f-bl" className="num" value={t.branchLen} onChange={(e) => setField('branchLen', e.target.value)} onBlur={() => blurField('branchLen')} />
                <span>cm</span>
              </div>
            </div>
            <div className="row">
              <label className="lbl" htmlFor="f-bd">
                枝径
              </label>
              <div className="unit">
                <input type="text" inputMode="decimal" id="f-bd" className="num" value={t.branchDia} onChange={(e) => setField('branchDia', e.target.value)} onBlur={() => blurField('branchDia')} />
                <span>cm</span>
              </div>
            </div>
          </div>
          <dl className="calc" data-testid="calc">
            <div>
              <dt>幹周(記録値)</dt>
              <dd>{g != null ? `${g.toFixed(2)}m` : '—'}</dd>
            </div>
            <div>
              <dt>樹高/幹径</dt>
              <dd className={(hd ?? 0) >= limit('height') ? 'hit' : ''}>{hd ?? '—'}</dd>
            </div>
            <div>
              <dt>枝長/枝径</dt>
              <dd className={(blr ?? 0) >= limit('branch') ? 'hit' : ''}>{bl === '' ? (t.ledgerBranchRatio || '—') : bl}</dd>
            </div>
          </dl>
          {gv.length > 1 && (
            <div className="calc-note">
              株立：({gv.map((v) => v.toFixed(2)).join('+')})×{cfg.calc.multiStemFactor} = {g.toFixed(2)}m
            </div>
          )}
        </div>

        <div className="sec">
          <h2>点検</h2>
          <div className="row">
            <span className="lbl">{cfg.vigorLabel}</span>
            <Seg field="vigor" opts={cfg.options.vigor} value={t.vigor} onPress={press} />
          </div>
          <fieldset disabled={locked}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const r = fillChecksNone(t, cfg);
                if (!r.keys.length) return toast('まだ選んでいない点検項目はありません');
                change((x) => fillChecksNone(x, cfg).tree); // その時点の最新の木に対して行う
                toast(`まだ選んでいなかった${r.keys.length}項目を「${cfg.noneValue || '無'}」にしました`);
              }}
              data-testid="checks-none"
            >
              まだ選んでいない点検項目をすべて「{cfg.noneValue || '無'}」にする
            </button>
            {cfg.checks.map((c) => {
              const details = cfg.details.filter((d) => d.when.field === c.key);
              return (
                <div key={c.key}>
                  <div className="check">
                    <span className="lbl">{c.label}</span>
                    <Seg field={c.key} opts={cfg.options[c.key]} value={t[c.key]} onPress={press} />
                  </div>
                  {details
                    .filter((d) => isOn(c.key, d.when.eq))
                    .map((d) => (
                      <div className="row" key={d.field} style={{ padding: '6px 0' }}>
                        <label className="lbl" htmlFor={`f-${d.field}`}>
                          {d.label}
                        </label>
                        {d.chips && (
                          <div className="chips">
                            {d.chips.map((w) => (
                              <button
                                key={w}
                                type="button"
                                className={`chip${strongWords.includes(w) ? ' strong' : ''}${t[d.field] === w ? ' on' : ''}`}
                                onClick={() => change((x) => ({ ...x, [d.field]: x[d.field] === w ? '' : w }))}
                              >
                                {w}
                              </button>
                            ))}
                          </div>
                        )}
                        <input
                          type="text"
                          inputMode={d.numeric ? 'numeric' : undefined} // 数の欄（例：枯れ枝の本数）は数字のキーボードを出す
                          id={`f-${d.field}`}
                          className="num"
                          value={t[d.field] || ''}
                          onChange={(e) => setField(d.field, e.target.value)}
                          onBlur={() => blurField(d.field)}
                        />
                      </div>
                    ))}
                </div>
              );
            })}
          </fieldset>
          {/* 特記事項は枯死の木でも書ける（点検項目だけを原則空欄にする） */}
          <div className="row" style={{ paddingTop: 8 }}>
            <label className="lbl" htmlFor="f-notes">
              特記事項（野帳） <small>タップで追加・もう一度で削除。寸法なども書く</small>
            </label>
            <div className="chips" data-testid="note-chips">
              {cfg.noteChips.map((c, i) =>
                !showAllChips && i >= chipsShow ? null : (
                  <button
                    key={c.t}
                    type="button"
                    className={`chip${lines.some((l) => isChipLine(c, l)) ? ' on' : ''}`}
                    onClick={() => change((x) => ({ ...x, notes: toggleChip(x.notes, c) }))}
                  >
                    {c.t}
                  </button>
                ),
              )}
            </div>
            {!showAllChips && cfg.noteChips.length > chipsShow && (
              <button type="button" className="more" onClick={() => setShowAllChips(true)}>
                定型文をもっと見る（{cfg.noteChips.length - chipsShow}件）
              </button>
            )}
            <textarea id="f-notes" rows={4} value={t.notes} placeholder="1行に1項目（音声入力も可）" onChange={(e) => setField('notes', e.target.value)} />
            <NoteMeasures cfg={cfg} tree={t} onAdd={(line, m) => change((x) => ({ ...x, notes: appendNoteLine(x.notes, line), measures: [...(x.measures || []), m] }))} />
            <label className="lbl" htmlFor="f-dbnote" style={{ marginTop: 6 }}>
              一覧表用の特記 <small>{t.dbNoteManual ? '手入力' : '定型文から自動で作成'}</small>
            </label>
            <textarea id="f-dbnote" rows={2} value={dbNoteOf(t, cfg)} onChange={(e) => setField('dbNote', e.target.value)} />
            <div className="sub">
              {free.length > 0 && !t.dbNoteManual && (
                <span className="hint">自由記述（{free.length}行）は一覧表に入りません。必要なら手で追記してください</span>
              )}
              {t.dbNoteManual && (
                <button type="button" className="more" onClick={() => change((x) => ({ ...x, dbNoteManual: false }))}>
                  自動に戻す
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="sec">
          <h2>判定</h2>
          <div className="row">
            <span className="lbl">{cfg.initial.label}</span>
            <Seg field="initialNeeded" opts={cfg.options.initialNeeded} value={t.initialNeeded} onPress={press} />
          </div>
          <div className="row">
            <span className="lbl">{cfg.gradeLabel}</span>
            <Seg field="grade" opts={cfg.options.grade} value={t.grade} onPress={press} disabled={gradeLocked} className="grade" />
            <div className="hint">{t.grade ? `${t.grade}：${cfg.gradeText?.[t.grade] || ''}` : cfg.gradeHint || ''}</div>
            {gradeLocked && <div className="lock">{cfg.initial.label}が「{cfg.initial.yes}」なので、{cfg.gradeLabel}は空欄にします。</div>}
          </div>
        </div>

        <div className="sec">
          <h2>処置</h2>
          {[
            ['剪定', cfg.treat.prune],
            ['その他', cfg.treat.other],
          ].map(([label, items]) => (
            <div className="row" key={label}>
              <span className="lbl">{label}</span>
              <div className="chips">
                {items.map((c) => (
                  <button key={c} type="button" className={`chip${(t.treatSel || []).includes(c) ? ' on' : ''}`} onClick={() => change((x) => toggleTreat(x, c))}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="row">
            <label className="lbl" htmlFor="f-treat">
              追記 <small>部位など</small>
            </label>
            <input type="text" id="f-treat" value={t.treatFree} onChange={(e) => setField('treatFree', e.target.value)} />
          </div>
          <div className="plan">
            処置：<b data-testid="treat-out">{treat || '（なし）'}</b>
          </div>
          {felling.map((r) => (
            <div className="row" key={r.id}>
              <label className="lbl" htmlFor={`f-${r.field}`}>
                {r.label}
              </label>
              <textarea id={`f-${r.field}`} value={t[r.field] || ''} onChange={(e) => setField(r.field, e.target.value)} />
            </div>
          ))}
        </div>

        <Alerts list={otherAlerts} onAct={onAct} asking={asking} onAsk={(a, act) => setAsking({ alertId: a.id, act })} onCancel={() => setAsking(null)} />

        <div className="sec">
          <h2>写真</h2>
          <div className="plan" data-testid="photo-plan">
            {plan.mode === 'pending'
              ? `${cfg.vigorLabel}などを入力すると、必要な写真を判定します`
              : plan.slots.length
                ? (
                    <>
                      撮る写真：<b>{MODE_TEXT[plan.mode]}</b>
                      <br />
                      {plan.slots.map((x) => `${x.name}（${x.orient}向き）`).join('、')}
                    </>
                  )
                : '写真不要です'}
          </div>
          <div className="row">
            <span className="lbl">
              写真の有無 <small>{t.photoOverride ? `手入力（自動判定は「${autoPhoto}」）` : '自動判定。違う場合はタップで変更'}</small>
            </span>
            <Seg field="photoOverride" opts={[cfg.photo.flagNo, cfg.photo.flagYes]} value={photoFlag(t, cfg)} onPress={press} />
          </div>
        </div>
      </fieldset>

      {/* 写真を撮る・見る（入力の欄の外に置く：事務の端末でも見られるように。撮るのは入力できる木だけ） */}
      <div className="sec">
        <PhotoShots t={t} plan={plan} state={state} update={update} getState={getState} config={cfg} toast={toast} send={send} canShoot={!readOnly} />
      </div>

      {undo?.treeId === t.id && (
        <div className="alert info" data-testid="undo">
          <span>「{undo.label}」を行いました。</span>
          <div className="acts">
            <button
              type="button"
              className="btn"
              onClick={() => {
                update((s) => updateTree(s, undo.treeId, () => undo.before), { now: true });
                setUndo(null);
                toast('取り消しました（押す前の状態に戻しました）');
              }}
              data-testid="undo-btn"
            >
              取り消す（押す前に戻す）
            </button>
          </div>
        </div>
      )}
      <Alerts list={topAlerts} onAct={onAct} asking={asking} onAsk={(a, act) => setAsking({ alertId: a.id, act })} onCancel={() => setAsking(null)} />
      <div className="savebar">
        {missingAsk && missing.length > 0 ? (
          <div className="alert warn" role="alert">
            <span>未入力があります：{missing.join('、')}</span>
            <div className="acts">
              <button type="button" className="btn" onClick={() => onSave(true, askAfter)}>
                未入力のまま保存する
              </button>
            </div>
          </div>
        ) : (
          missing.length > 0 && (
            <div className="alert info">
              <span>未入力：{missing.join('、')}</span>
            </div>
          )
        )}
        {!readOnly && <SessionStamp state={state} update={update} />}
        {/* 追加した木は台帳の並びの外にあるので、「次の木」に進まない（台帳の別の木を開いてしまわないように） */}
        {!readOnly && !isAddedTree(t) && (
          <button type="button" className="btn fill big" onClick={() => onSave(false)}>
            保存して次の木へ
          </button>
        )}
        {/* 保存だけ：同じ木のまま続けて直せる */}
        {!readOnly && (
          <button type="button" className="btn big" onClick={() => onSave(false, 'stay')} data-testid="save-stay">
            保存（この木のまま）
          </button>
        )}
        {!readOnly && isAddedTree(t) && (
          <>
            <button type="button" className="btn fill big" onClick={() => onSave(false, 'list')} data-testid="save-to-list">
              保存して一覧へ
            </button>
            <button type="button" className="btn big" onClick={() => onSave(false, 'add')} data-testid="save-and-add">
              保存してもう1本追加
            </button>
          </>
        )}
        {sheet && <span className="hint" style={{ textAlign: 'center' }}>{sheet.label}</span>}
      </div>

      {canRemove &&
        (askRemove === t.id ? (
          <div className="alert danger" data-testid="remove-ask">
            <span>{removeAct.text}</span>
            <div className="acts">
              <button type="button" className="btn fill" onClick={onRemove} data-testid="remove-ok">
                {removeAct.ok}
              </button>
              <button type="button" className="btn" onClick={() => setAskRemove('')}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAskRemove(t.id)} data-testid="remove-tree">
            {removeAct.label}
          </button>
        ))}
    </section>
  );
}
