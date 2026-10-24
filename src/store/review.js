// 確認の流れ（事務と調査者のやり取り）
//
//  提出   … 調査者が入力・保存した木（サーバーへ自動送信）
//  確認依頼 … 事務が付箋（質問・修正案）を付け、調査者の返事を待っている
//  回答済み … 調査者が返事をした。事務が読んで「確認済み」にするのを待っている
//  確定   … 事務が確定した。確定した後で入力内容が変わったら、確定は外れる
//           ただし調査日・調査者だけをまとめて直したとき（redate.js）は外さない（dateFix の印と中身の写しで確かめる）
//
// 入力内容を直すのは調査者だけ。事務の修正案は、調査者が「採用」したときに入力内容へ反映する。
// 付箋の持ち主：質問・修正案は書いた人（事務）、返事は調査者。両方が同時に書いても消し合わないよう、
// 送るときに「どちらを書いたか（edited）」を覚えておく。
//
// 調査の種類（surveys.js の一覧）ごとに記録の鍵が違うので、記録を受け取る関数は最後の引数で種類を選べる。
// 省略すると簡易診断の木として扱う。

import { dbNoteOf } from '../core/notes.js';
import { toHalf } from '../core/text.js';
import { manualKeyOf, partsKeyOf } from '../core/detailParts.js';
import { touched } from './actions.js';
import { INITIAL, SIMPLE, findByKey, recordsOf, simpleKey, updateRecord } from './surveys.js';

// 木の鍵（年度・シートの種類・番号・何本目）。端末とサーバーで共通
export const treeKey = simpleKey;

// 詳しい診断の、付箋を付けられる項目：入力画面（設定 initialSurvey.forms）のすべての項目。
//  弱点の項目（weak）は、詳細の欄も別の項目として付けられる。返す形：[{ key, label, options? }]
function initialReviewFields(cfg) {
  const out = [];
  for (const form of Object.values(cfg.initialSurvey?.forms || {}))
    for (const sec of form.sections)
      for (const it of sec.items) {
        out.push({ key: it.key, label: it.label, ...(it.options?.length ? { options: it.options } : {}), type: it.type });
        if (it.type === 'weak') out.push({ key: it.detailKey || `${it.key}Detail`, label: `${it.label}（詳細）` });
      }
  return out;
}

// 付箋を付けられる項目（設定 review.fields があればそれ、なければ一般的な文字の項目）
//  詳しい診断の記録では、入力画面のすべての項目
export function reviewFields(cfg, survey = SIMPLE) {
  if (survey.id === INITIAL.id) return initialReviewFields(cfg);
  const base = cfg.review?.fields || [
    { key: 'dbNote', label: '一覧表用の特記' },
    { key: 'notes', label: '特記事項（野帳）' },
    { key: 'species', label: '樹種' },
    { key: 'treatFree', label: '処置（追記）' },
  ];
  return base;
}

// 項目の名前（null は木全体）
export const fieldLabel = (key, cfg, survey = SIMPLE) => (key ? reviewFields(cfg, survey).find((f) => f.key === key)?.label || key : survey.id === INITIAL.id ? '記録全体' : '木全体');

// 項目の今の値（一覧表用の特記は、自動で作った文も含める）
export const fieldValue = (tree, key, cfg) => (key === 'dbNote' ? dbNoteOf(tree, cfg) : String(tree?.[key] ?? ''));

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

// その木の付箋（消したものは除く）
export const stickiesOf = (state, key) => Object.values(state.stickies || {}).filter((s) => s.treeId === key && !s.deleted);

// 付箋の鍵から、どの調査の種類の付箋かを返す
export const surveyOfSticky = (s) => (String(s?.treeId || '').startsWith('initial|') ? INITIAL : SIMPLE);

// その木の詳しい診断の記録（なければ null）
export function initialRecordOf(state, tree, cfg) {
  const key = INITIAL.keyOf(tree, cfg);
  return recordsOf(state, INITIAL).find((r) => INITIAL.keyOf(r, cfg) === key) || null;
}

// 一覧の絞り込み用：木と、その木の詳しい診断の記録の、確認の段階（食い違いは 'conflict'）。
//  返す形：[簡易診断の段階, 詳しい診断の段階（記録がなければ入れない）]
export function reviewStatesOf(tree, state, cfg) {
  const one = (r, survey) => (r.conflict ? 'conflict' : reviewState(r, state, cfg, survey));
  const rec = initialRecordOf(state, tree, cfg);
  return [one(tree, SIMPLE), ...(rec ? [one(rec, INITIAL)] : [])];
}

// 木の確認の段階
export function reviewState(tree, state, cfg, survey = SIMPLE) {
  if (tree.deleted) return 'deleted';
  if (!tree.done || tree.source !== 'app') return tree.source === 'ledger' ? 'ledger' : 'draft';
  const key = survey.keyOf(tree, cfg);
  const st = stickiesOf(state, key);
  if (st.some((s) => !s.answer)) return 'asked';
  if (st.some((s) => s.answer && !s.closed)) return 'answered';
  const c = state.confirms?.[key];
  if (c?.value && tree.sent && (c.treeRev === (tree.rev || 0) || onlyDateFixed(tree, c, cfg, survey))) return 'confirmed';
  return 'submitted';
}

// ---------- 調査日・調査者だけを直した記録 ----------
// 調査日・調査者をまとめて直すと版が変わるが、確定は外さない。そのため直したときに
//  dateFix = { fromRev（確定したときの版）, sig（調査日・調査者以外の中身の写し）, v: 2 } を記録に付けておき、
//  確定の版が fromRev で、調査日・調査者以外の中身が sig と同じなら、確定のままとする（ほかを直せば sig が変わり、確定は外れる）
//  v のない dateFix は前の版（調査日だけを除いた写し）。前の版で直した記録も、確定のままに見えるように読み分ける

// 調査日の項目（簡易診断は date、詳しい診断は設定 initialSurvey.stamp.date の年・月・日）
export const dateKeysOf = (cfg, survey = SIMPLE) => (survey.id === INITIAL.id ? cfg.initialSurvey?.stamp?.date || [] : ['date']);
// 調査者の項目（簡易診断は inspector、詳しい診断は設定 initialSurvey.stamp.inspector）
export const inspectorKeyOf = (cfg, survey = SIMPLE) => (survey.id === INITIAL.id ? cfg.initialSurvey?.stamp?.inspector || null : 'inspector');

// 中身の写し（項目の並び順は問わない）。端末だけの項目・送った時刻・調査日（v2 は調査者も）・印そのものは除く
const SIG_SKIP = ['id', 'sent', 'rev', 'conflict', 'order', 'updatedAt', 'dateFix'];
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
export function dateFixSig(record, cfg, survey = SIMPLE, v = 2) {
  const d = { ...record };
  const ik = inspectorKeyOf(cfg, survey);
  for (const k of [...SIG_SKIP, ...dateKeysOf(cfg, survey), ...(v >= 2 && ik ? [ik] : [])]) delete d[k];
  return JSON.stringify(canon(d));
}
function onlyDateFixed(record, c, cfg, survey) {
  const f = record.dateFix;
  return !!f && c.treeRev === f.fromRev && f.sig === dateFixSig(record, cfg, survey, f.v || 1);
}

export const REVIEW_LABEL = { deleted: '削除', draft: '未入力', ledger: '台帳で入力済み', submitted: '提出済み', asked: '確認依頼', answered: '回答済み', confirmed: '確定' };

// ---------- 事務の操作 ----------

// 付箋を付ける。field を null にすると木全体へのメモ
export function addSticky(state, tree, { field = null, question = '', proposal = null }, cfg, survey = SIMPLE) {
  const id = newId();
  const s = {
    id,
    treeId: survey.keyOf(tree, cfg),
    field,
    question: String(question || '').trim(),
    proposal: proposal == null ? null : String(proposal),
    by: state.user?.name || '',
    at: now(),
    updatedAt: now(),
    answer: null,
    closed: false,
    deleted: false,
    rev: 0,
    dirty: true,
    edited: 'body',
  };
  return { state: { ...state, stickies: { ...(state.stickies || {}), [id]: s } }, id };
}

// 付箋を書き直す・消す・「確認済み」にする（事務）
export function editSticky(state, id, patch) {
  const s = state.stickies?.[id];
  if (!s) return state;
  return { ...state, stickies: { ...state.stickies, [id]: { ...s, ...patch, updatedAt: now(), dirty: true, edited: 'body' } } };
}
export const deleteSticky = (state, id) => editSticky(state, id, { deleted: true });
export const closeSticky = (state, id) => editSticky(state, id, { closed: true });

// 確定する・外す（事務）。確定できるのは、未解決の付箋がない、送信済みの木だけ
export function setConfirm(state, tree, value, cfg, survey = SIMPLE) {
  const key = survey.keyOf(tree, cfg);
  if (value) {
    const rs = reviewState(tree, state, cfg, survey);
    if (rs === 'asked' || rs === 'answered') throw new Error('未解決の付箋があるため、確定できません');
    if (!tree.sent) throw new Error('まだサーバーに届いていない入力があるため、確定できません');
  }
  const prev = state.confirms?.[key] || { rev: 0 };
  const c = { ...prev, treeId: key, value: !!value, treeRev: tree.rev || 0, by: state.user?.name || '', at: now(), updatedAt: now(), dirty: true };
  return { ...state, confirms: { ...(state.confirms || {}), [key]: c } };
}

// まとめて確定できる木（送信済み・付箋がすべて解決・まだ確定していない）
export const confirmable = (trees, state, cfg, survey = SIMPLE) =>
  trees.filter((t) => reviewState(t, state, cfg, survey) === 'submitted' && t.sent && !t.conflict);

// ---------- 調査者の操作 ----------

// 付箋に返事をする
//  type: 'adopt'（修正案を採用）/ 'keep'（このままで良い）/ 'edit'（自分で直す。text が新しい値）/ 'reply'（返事だけ）
export function answerSticky(state, id, { type, text = '' }, cfg) {
  const s = state.stickies?.[id];
  if (!s) return state;
  const answer = { type, text: String(text || ''), by: state.user?.name || '', at: now() };
  let next = { ...state, stickies: { ...state.stickies, [id]: { ...s, answer, updatedAt: now(), dirty: true, edited: 'answer' } } };
  const value = type === 'adopt' ? s.proposal : type === 'edit' ? answer.text : null;
  if (value != null && s.field) {
    // 付箋の鍵から、どの種類のどの記録かをたどる
    const hit = findByKey(state, s.treeId, cfg);
    if (hit)
      next = updateRecord(next, hit.survey, hit.record.id, (x) => {
        // 数の項目は数のまま入れる（ブックの数の欄に、文字ではなく数で書くため）
        const half = toHalf(String(value)).trim();
        const v = typeof x[s.field] === 'number' && /^-?\d+(\.\d+)?$/.test(half) ? Number(half) : value;
        // 部品から組み立てる詳細の文を付箋で直したときは、手で直した印を付ける（部品を変えても上書きしない）
        const manual = x[partsKeyOf(s.field)] ? { [manualKeyOf(s.field)]: true } : {};
        return touched({ ...x, [s.field]: v, ...manual, ...(s.field === 'dbNote' ? { dbNoteManual: true } : {}) });
      });
  }
  return next;
}

// ---------- 出力 ----------

// 一覧表に書き込む木を選ぶ。確認の流れを使っているとき（サーバーあり）は、アプリで入力した木のうち確定した木だけ。
//  includeUnconfirmed：途中経過を見るときなど、未確定の木も含める
//  返す形：{ trees（出力に渡す全体。除いた木は外してある）, excluded: [除いた木…] }
export function treesForDb(state, cfg, { includeUnconfirmed = false } = {}, survey = SIMPLE) {
  const useReview = !!state.server?.url;
  const excluded = [];
  const trees = recordsOf(state, survey).filter((t) => {
    if (t.deleted) return false; // 削除した木は書き込まない
    if (!useReview || includeUnconfirmed || !t.done || t.source !== 'app') return true;
    if (reviewState(t, state, cfg, survey) === 'confirmed') return true;
    excluded.push(t);
    return false;
  });
  return { trees, excluded };
}
