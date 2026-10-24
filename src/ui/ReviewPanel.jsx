// 入力画面の上に出す「確認」の欄：付箋（事務の質問・修正案と調査者の返事）、確定、食い違いの解決
//
//  事務（role: office）… 付箋を付ける・書き直す・消す、返事を読んで「確認済み」にする、確定する
//  調査者（role: surveyor）… 付箋に答える（採用／このままで良い／自分で直す／返事だけ）
//  どちらも … 同じ木を2台で直したときの食い違いを、どちらの内容を使うか選んで解決する
//  survey（surveys.js の種類）で、簡易診断の木にも、詳しい診断の記録にも使う
import { useState } from 'react';
import {
  REVIEW_LABEL,
  addSticky,
  answerSticky,
  closeSticky,
  deleteSticky,
  editSticky,
  fieldLabel,
  fieldValue,
  reviewFields,
  reviewState,
  setConfirm,
  stickiesOf,
} from '../store/review.js';
import { resolveConflict } from '../store/sync.js';
import { SIMPLE, recordsOf } from '../store/surveys.js';

const ANSWER_LABEL = { adopt: '修正案を採用', keep: 'このままで良い', edit: '自分で直した', reply: '返事' };

// 食い違いのある項目（端末だけの印は比べない）
const SKIP = new Set(['id', 'sent', 'rev', 'conflict', 'order', 'updatedAt']);
// 食い違いの表に出す項目名（設定の点検項目・追加項目の名前も使う。分からなければ内部の名前のまま）
const BASE_LABELS = {
  treeNo: '樹木番号',
  species: '樹種',
  status: '状態',
  date: '調査日',
  inspector: '調査者',
  height: '樹高',
  girths: '幹周',
  branchLen: '枝長',
  branchDia: '枝径',
  vigor: '活力',
  notes: '特記事項',
  dbNote: '一覧表用の特記',
  initialNeeded: '詳しい診断',
  grade: '判定',
  treatSel: '処置',
  treatFree: '処置（追記）',
  photoOverride: '写真',
};
const labelOf = (k, cfg, survey = SIMPLE) =>
  (survey.id !== SIMPLE.id && reviewFields(cfg, survey).find((f) => f.key === k)?.label) ||
  cfg.checks?.find((c) => c.key === k)?.label ||
  cfg.details?.find((d) => d.field === k)?.label ||
  BASE_LABELS[k] ||
  k;
export function conflictDiff(t, cfg, survey = SIMPLE) {
  const theirs = t.conflict?.data || {};
  const keys = [...new Set([...Object.keys(t), ...Object.keys(theirs)])].filter((k) => !SKIP.has(k));
  const show = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return keys.filter((k) => show(t[k]) !== show(theirs[k])).map((k) => ({ key: k, label: labelOf(k, cfg, survey), mine: show(t[k]), theirs: show(theirs[k]) }));
}

// 付箋1枚
function Sticky({ s, t, cfg, role, act, survey, options }) {
  const [mode, setMode] = useState(''); // 'edit' 自分で直す / 'reply' 返事だけ / 'rewrite' 事務が書き直す
  const [text, setText] = useState('');
  const [q, setQ] = useState(s.question);
  const [prop, setProp] = useState(s.proposal ?? '');
  const now = s.field ? fieldValue(t, s.field, cfg) : '';
  const answered = !!s.answer;
  const cls = answered ? (s.closed ? 'sticky done' : 'sticky answered') : 'sticky';

  return (
    <div className={cls} data-sticky={s.id}>
      <div className="sticky-head">
        <b>{fieldLabel(s.field, cfg, survey)}</b>
        <small>
          {s.by || '事務'}　{s.at?.slice(5, 16).replace('T', ' ')}
        </small>
      </div>
      {s.question && <p className="sticky-q">{s.question}</p>}
      {s.proposal != null && s.field && (
        <div className="sticky-prop">
          <div>
            <small>今</small>
            <span>{now || '（空）'}</span>
          </div>
          <div>
            <small>修正案</small>
            <span>{s.proposal || '（空）'}</span>
          </div>
        </div>
      )}
      {answered && (
        <p className="sticky-a">
          <small>{s.answer.by || '調査者'}：</small>
          {ANSWER_LABEL[s.answer.type] || '返事'}
          {s.answer.text && s.answer.type !== 'adopt' ? `「${s.answer.text}」` : ''}
          {s.closed && <span className="tag">確認済み</span>}
        </p>
      )}

      {/* 調査者：返事をする（返事の後も、事務が確認済みにするまでは答え直せる） */}
      {role === 'surveyor' && !s.closed && (
        <>
          {!mode && (
            <div className="acts">
              {s.field && s.proposal != null && (
                <button type="button" className="btn fill" onClick={() => act((st) => answerSticky(st, s.id, { type: 'adopt' }, cfg))} data-act="adopt">
                  修正案を採用
                </button>
              )}
              <button type="button" className="btn" onClick={() => act((st) => answerSticky(st, s.id, { type: 'keep' }, cfg))} data-act="keep">
                このままで良い
              </button>
              {s.field && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setText(s.proposal ?? now);
                    setMode('edit');
                  }}
                  data-act="edit"
                >
                  自分で直す
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setText('');
                  setMode('reply');
                }}
                data-act="reply"
              >
                返事を書く
              </button>
            </div>
          )}
          {mode && (
            <div className="row">
              {mode === 'edit' && options?.length ? (
                // 選択肢の項目は、選択肢から選ぶ
                <select value={text} onChange={(e) => setText(e.target.value)} aria-label="直した値">
                  <option value="">（空）</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea rows={mode === 'edit' && s.field === 'notes' ? 4 : 2} value={text} onChange={(e) => setText(e.target.value)} aria-label={mode === 'edit' ? '直した値' : '返事'} />
              )}
              <div className="acts">
                <button
                  type="button"
                  className="btn fill"
                  disabled={mode === 'reply' && !text.trim()}
                  onClick={() => {
                    act((st) => answerSticky(st, s.id, { type: mode, text }, cfg));
                    setMode('');
                  }}
                  data-act="send-answer"
                >
                  {mode === 'edit' ? 'この値にする' : '返事する'}
                </button>
                <button type="button" className="btn" onClick={() => setMode('')}>
                  やめる
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 事務：返事を読んで確認済みにする・書き直す・消す */}
      {role === 'office' && !s.closed && (
        <>
          {mode !== 'rewrite' && (
            <div className="acts">
              {answered && (
                <button type="button" className="btn fill" onClick={() => act((st) => closeSticky(st, s.id))} data-act="close">
                  確認済みにする
                </button>
              )}
              {!answered && (
                <button type="button" className="btn" onClick={() => setMode('rewrite')} data-act="rewrite">
                  書き直す
                </button>
              )}
              {!answered && (
                <button type="button" className="btn" onClick={() => act((st) => deleteSticky(st, s.id))} data-act="delete">
                  取り下げる
                </button>
              )}
            </div>
          )}
          {mode === 'rewrite' && (
            <div className="row">
              <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} aria-label="質問" />
              {s.field && <textarea rows={2} value={prop} onChange={(e) => setProp(e.target.value)} aria-label="修正案" />}
              <div className="acts">
                <button
                  type="button"
                  className="btn fill"
                  onClick={() => {
                    act((st) => editSticky(st, s.id, { question: q.trim(), proposal: s.field ? prop : null }));
                    setMode('');
                  }}
                >
                  書き直す
                </button>
                <button type="button" className="btn" onClick={() => setMode('')}>
                  やめる
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 事務：新しい付箋を書く
function NewSticky({ t, cfg, act, survey, optionsFor }) {
  const fields = reviewFields(cfg, survey);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(fields[0]?.key || '');
  const [question, setQuestion] = useState('');
  const [proposal, setProposal] = useState(fieldValue(t, fields[0]?.key, cfg));
  const [withProposal, setWithProposal] = useState(true);
  const pick = (k) => {
    setField(k);
    setProposal(fieldValue(t, k, cfg));
  };
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)} data-testid="sticky-new">
        ＋ 付箋を付ける
      </button>
    );
  return (
    <div className="sticky new" data-testid="sticky-form">
      <div className="row">
        <label className="lbl" htmlFor="st-field">
          どの項目について
        </label>
        <select id="st-field" value={field} onChange={(e) => pick(e.target.value)}>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
          <option value="">木全体</option>
        </select>
      </div>
      <div className="row">
        <label className="lbl" htmlFor="st-q">
          質問・メモ
        </label>
        <textarea id="st-q" rows={2} value={question} placeholder="例：この書き方で良いか？" onChange={(e) => setQuestion(e.target.value)} />
      </div>
      {field && (
        <div className="row">
          <label className="lbl" htmlFor="st-p">
            <input type="checkbox" checked={withProposal} onChange={(e) => setWithProposal(e.target.checked)} /> 修正案{' '}
            <small>調査者が「採用」すると、この値がそのまま入ります</small>
          </label>
          {withProposal &&
            (optionsFor?.(field)?.length ? (
              // 選択肢の項目は、修正案も選択肢から選ぶ（ブックの入力規則にない値にならないように）
              <select id="st-p" value={proposal} onChange={(e) => setProposal(e.target.value)}>
                <option value="">（空）</option>
                {optionsFor(field).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <textarea id="st-p" rows={field === 'notes' ? 4 : 2} value={proposal} onChange={(e) => setProposal(e.target.value)} />
            ))}
        </div>
      )}
      <div className="acts">
        <button
          type="button"
          className="btn fill"
          disabled={!question.trim() && !(field && withProposal)}
          onClick={() => {
            act((st) => addSticky(st, t, { field: field || null, question, proposal: field && withProposal ? proposal : null }, cfg, survey).state);
            setOpen(false);
            setQuestion('');
          }}
          data-testid="sticky-add"
        >
          付箋を付ける
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          やめる
        </button>
      </div>
    </div>
  );
}

//  survey：簡易診断の木（省略時）か、詳しい診断の記録か。optionsFor：項目の選択肢（詳しい診断の記録のとき）
export default function ReviewPanel({ t, state, update, config: cfg, toast, send, survey = SIMPLE, optionsFor }) {
  const role = state.user?.role || 'surveyor';
  if (t.source !== 'app' || !t.done) return null;
  const key = survey.keyOf(t, cfg);
  const list = stickiesOf(state, key).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const rs = reviewState(t, state, cfg, survey);
  const what = survey.id === SIMPLE.id ? 'この木' : `この${cfg.initialSurvey?.label || '記録'}`;
  const confirm = state.confirms?.[key];

  // 操作して、すぐ端末に保存し、サーバーへ送る
  const act = (fn) => {
    try {
      update((s) => fn(s), { now: true }).then(() => send?.());
    } catch (e) {
      toast(e.message);
    }
  };
  // 確定は、その時点の最新の状態に対して行う（画面の表示が古くても、送受信の結果を消さないように）
  const onConfirm = (value) => {
    try {
      update((s) => setConfirm(s, recordsOf(s, survey).find((x) => x.id === t.id), value, cfg, survey), { now: true }).then(() => send?.());
      toast(value ? '確定しました' : '確定を外しました');
    } catch (e) {
      toast(e.message);
    }
  };

  // 付箋も確定もなく、事務でもなければ、出さない（調査者の画面を邪魔しない）
  if (!list.length && !t.conflict && role !== 'office' && rs !== 'confirmed') return null;

  return (
    <div className="sec review" data-testid={survey.id === SIMPLE.id ? 'review' : `review-${survey.id}`}>
      <h2>
        確認 <span className={`rs rs-${rs}`}>{REVIEW_LABEL[rs]}</span>
      </h2>

      {t.conflict && (
        <div className="alert danger" data-testid="conflict">
          <span>
            {what}は、別の端末でも直されています（{t.conflict.by || '別の端末'}　{String(t.conflict.updatedAt || '').slice(5, 16).replace('T', ' ')}）。どちらの内容を使うか選んでください。選ぶまでは送信しません。
          </span>
          <table className="diff">
            <thead>
              <tr>
                <th>項目</th>
                <th>この端末</th>
                <th>相手</th>
              </tr>
            </thead>
            <tbody>
              {conflictDiff(t, cfg, survey).map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td>{d.mine}</td>
                  <td>{d.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acts">
            <button type="button" className="btn" onClick={() => act((s) => resolveConflict(s, t.id, 'server'))} data-act="use-theirs">
              相手の内容を使う
            </button>
            <button type="button" className="btn" onClick={() => act((s) => resolveConflict(s, t.id, 'mine'))} data-act="use-mine">
              この端末の内容を使う
            </button>
          </div>
        </div>
      )}

      {list.map((s) => (
        <Sticky key={s.id} s={s} t={t} cfg={cfg} role={role} act={act} survey={survey} options={s.field ? optionsFor?.(s.field) : null} />
      ))}

      {role === 'office' && <NewSticky key={t.id} t={t} cfg={cfg} act={act} survey={survey} optionsFor={optionsFor} />}

      {role === 'office' &&
        (rs === 'confirmed' ? (
          <button type="button" className="btn" onClick={() => onConfirm(false)} data-testid="unconfirm">
            確定を外す
          </button>
        ) : (
          <button
            type="button"
            className="btn fill big"
            disabled={rs === 'asked' || rs === 'answered' || !t.sent || !!t.conflict}
            onClick={() => onConfirm(true)}
            data-testid="confirm"
          >
            {what}を確定する
          </button>
        ))}
      {role === 'office' && (rs === 'asked' || rs === 'answered') && <p className="hint">付箋がすべて「確認済み」になると確定できます。</p>}
      {role === 'office' && !t.sent && <p className="hint">まだサーバーに届いていない入力があります。届いてから確定できます。</p>}
      {role === 'surveyor' && rs === 'confirmed' && <p className="hint">事務で確定済みです。入力を直すと確定が外れ、もう一度確認してもらうことになります。</p>}
      {role === 'surveyor' && confirm?.value && rs !== 'confirmed' && <p className="hint">確定の後に入力が変わったため、確定は外れています。</p>}
    </div>
  );
}
