// 画面の操作で状態を変える処理（画面から切り離して、テストできるようにしている）
// どれも元の状態を書き換えず、新しい状態を返す。

import { groupKey, treesOfGroup } from '../core/groups.js';
import { applyAction as applyRuleAction, missingFields } from '../core/rules.js';
import { normalizeSpecies } from '../core/species.js';
import { toHalf } from '../core/text.js';
import { blankTree, isDead } from '../core/tree.js';
import { photoPlan } from '../core/photo.js';

// 表示中のまとまりの木
export const currentGroupTrees = (state, cfg) => treesOfGroup(state.trees, state.group, cfg);
export const currentTree = (state) => state.trees.find((t) => t.id === state.currentId) || null;

// 1本の木を変える
export function updateTree(state, id, fn) {
  return { ...state, trees: state.trees.map((t) => (t.id === id ? fn(t) : t)) };
}

// 入力済みの木を直したとき：送り直しが必要な印を付ける
export const touched = (t, now = new Date().toISOString()) => (t.done && t.source === 'app' ? { ...t, sent: false, updatedAt: now } : t);

// 選択ボタンを押した：同じものをもう一度押すと解除
export function pressOption(t, field, v, cfg) {
  if (field === 'photoOverride') {
    const auto = photoPlan(t, cfg).weakPhoto ? cfg.photo.flagYes : cfg.photo.flagNo;
    return { ...t, photoOverride: v === auto ? '' : v }; // 自動判定と同じなら「手入力なし」に戻す
  }
  const next = { ...t, [field]: t[field] === v ? '' : v };
  if (field === 'initialNeeded' && next.initialNeeded === cfg.initial.yes) next.grade = ''; // 詳しい診断が必要なら健全度は空欄
  if (field === 'vigor' && !isDead(next, cfg)) next.deadOverride = false;
  return next;
}

// 点検項目のうち、まだ選んでいない項目をすべて「無」にする（選んである項目・樹勢は変えない）
//  「無」に当たる値は設定 noneValue（省略時「無」）。選択肢にその値がない項目は飛ばす
//  返す形：{ tree, keys: [「無」にした項目…] }
export function fillChecksNone(t, cfg) {
  const none = cfg.noneValue || '無';
  const keys = cfg.checks.map((c) => c.key).filter((k) => !t[k] && (cfg.options[k] || []).includes(none));
  let tree = t;
  for (const k of keys) tree = pressOption(tree, k, none, cfg);
  return { tree, keys };
}

// 定型文・処置のボタン（入っていれば外す、なければ入れる）
export function toggleTreat(t, item) {
  const sel = t.treatSel || [];
  return { ...t, treatSel: sel.includes(item) ? sel.filter((x) => x !== item) : [...sel, item] };
}

// 文字の入力を確定したとき：番号は半角大文字、樹種は置き換え表、数は半角
export function normalizeField(t, field, cfg) {
  if (field === 'treeNo') return { ...t, treeNo: toHalf(t.treeNo).toUpperCase().trim() };
  if (field === 'species') return { ...t, species: normalizeSpecies(t.species, cfg) };
  if (['height', 'branchLen', 'branchDia', 'deadBranchCount'].includes(field)) return { ...t, [field]: toHalf(t[field]).trim() };
  return t;
}

// 注意・提案のボタンを押した
export function pressAlertAction(state, id, act, ruleId, cfg) {
  if (act.type === 'resurvey')
    // 台帳で入力済みの木を、再調査としてアプリで入力し直す（台帳の値を下書きにする）
    return updateTree(state, id, (t) => ({ ...t, source: 'app', done: false, sent: false, dbNoteManual: false }));
  if (act.type === 'useApp')
    // 控えにしていたアプリの入力に戻す
    return updateTree(state, id, (t) => (t.appBackup ? { ...t.appBackup } : t));
  return updateTree(state, id, (t) => applyRuleAction(t, act, ruleId, cfg));
}

// まとまりの中で、次の未入力の木（今の木より後ろ→前の順に探す）
export function nextTodo(state, cfg) {
  const ts = currentGroupTrees(state, cfg);
  const i = ts.findIndex((t) => t.id === state.currentId);
  return ts.slice(i + 1).find((t) => !t.done) || ts.find((t) => !t.done && t.id !== state.currentId) || null;
}

// 保存：入力済みにして、調査日・調査者を記録し、次の未入力の木へ移る
//  after：保存の後の行き先。'next'（次の未入力の木。既定）/ 'list'（一覧へ）/ 'add'（同じ区画にもう1本追加して開く）/ 'stay'（同じ木のまま）
// 返す形：{ state, missing（未入力の項目）, saved（保存したか） }
export function saveTree(state, cfg, { force = false, now = new Date().toISOString(), after = 'next' } = {}) {
  const t = currentTree(state);
  if (!t || t.source === 'ledger') return { state, missing: [], saved: false };
  const missing = missingFields(t, cfg);
  if (missing.length && !force) return { state, missing, saved: false };
  let next = updateTree(state, t.id, (x) => ({
    ...x,
    done: true,
    sent: false,
    source: 'app',
    updatedAt: now, // サーバーで新しい・古いを比べるため
    date: state.session.date,
    inspector: state.session.inspector,
  }));
  if (after === 'stay') return { state: next, missing, saved: true }; // 保存だけ（同じ木のまま続けて直せる）
  if (after === 'list') return { state: { ...next, view: 'list' }, missing, saved: true };
  if (after === 'add') return { state: addTree(next, cfg, { area: t.area || '', now: Date.parse(now) + 1 || Date.now() }), missing, saved: true };
  const n = nextTodo(next, cfg);
  next = n ? { ...next, currentId: n.id } : { ...next, view: 'list' };
  return { state: next, missing, saved: true };
}

// 台帳にない木を追加する（場所の情報は同じまとまりの最初の木から写す）
//  uid … 追加した木の印（端末の印＋時刻）。番号の代わりにこれで木を見分ける（review.js の treeKey）
export function addTree(state, cfg, { area = '', now = Date.now() } = {}) {
  const ts = currentGroupTrees(state, cfg);
  const ref = ts[0] || {};
  const copyKeys = ['siteType', ...cfg.dbFormat.infoKeys];
  const uid = `${state.server?.deviceId || 'dev'}-${Number(now).toString(36)}`;
  const nt = blankTree({ id: `new:${now}`, uid, status: cfg.newTreeStatus ?? '', area });
  for (const k of copyKeys) if (ref[k] !== undefined) nt[k] = ref[k];
  // まとまりの最後の木の直後に入れる
  const last = ts.at(-1);
  const at = last ? state.trees.indexOf(last) + 1 : state.trees.length;
  const trees = [...state.trees.slice(0, at), nt, ...state.trees.slice(at)];
  return { ...state, trees, currentId: nt.id, view: 'form', group: state.group || groupKey(nt, cfg) };
}

// ---------- 削除・入力の取り消し（調査者の操作） ----------

// 一覧にない木を追加したものか（台帳から読み込んだ木には ledgerRow がある）
//  台帳の行と結び付いていたが、今の台帳にない木（ledgerGone）も、追加した木と同じく扱う（番号を直したり削除したりできる）
export const isAddedTree = (t) => !t.ledgerRow || !!t.ledgerGone;

const stamp = (now) => now || new Date().toISOString();

// 追加した木を削除する
//  サーバーに届いていない木（版がない）は端末から消す。
//  届いている木は「削除した」印を付けて送る（他の端末でも削除になる。元に戻せる）
export function deleteTree(state, id, now) {
  const t = state.trees.find((x) => x.id === id);
  if (!t) return state;
  if (!isAddedTree(t)) throw new Error('台帳の木は削除できません（入力の取り消しを使ってください）');
  if (!(t.rev > 0)) {
    return { ...state, trees: state.trees.filter((x) => x.id !== id), currentId: state.currentId === id ? '' : state.currentId };
  }
  if (t.conflict) throw new Error('別の端末との食い違いがあります。先にどちらを使うか選んでください');
  return updateTree(state, id, (x) => ({ ...x, deleted: true, source: 'app', sent: false, updatedAt: stamp(now) }));
}

// 削除した木を元に戻す
export function restoreTree(state, id, now) {
  return updateTree(state, id, (x) => (x.deleted ? { ...x, deleted: false, sent: false, updatedAt: stamp(now) } : x));
}

// 台帳の木の入力を取り消して、未入力に戻す（入力した値は下書きとして残る）
//  サーバーに届いていれば、未入力に戻ったことを送る（版がない木は送らない）
export function withdrawTree(state, id, now) {
  const t = state.trees.find((x) => x.id === id);
  if (!t) return state;
  if (isAddedTree(t)) throw new Error('追加した木は、入力の取り消しではなく削除を使ってください');
  if (!t.done || t.source !== 'app') throw new Error('アプリで入力済みの木だけ取り消せます');
  if (t.conflict) throw new Error('別の端末との食い違いがあります。先にどちらを使うか選んでください');
  return updateTree(state, id, (x) => ({ ...x, done: false, sent: false, updatedAt: stamp(now) }));
}
