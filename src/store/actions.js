// 画面の操作で状態を変える処理（画面から切り離して、テストできるようにしている）
// どれも元の状態を書き換えず、新しい状態を返す。

import { groupKey, treesOfGroup } from '../core/groups.js';
import { applyAction as applyRuleAction, missingFields } from '../core/rules.js';
import { normalizeSpecies } from '../core/species.js';
import { toHalf } from '../core/text.js';
import { blankTree, isDead } from '../core/tree.js';
import { photoPlan } from '../core/photo.js';
import { placeAdded } from './order.js';
import { afterSameGroup, simpleKey } from './surveys.js';

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
  // 設定で足した計測の欄：数の欄は半角に、文字の欄は前後の空白を取る
  const extra = (cfg.extraFields || []).find((f) => f.key === field);
  if (extra) return { ...t, [field]: extra.numeric ? toHalf(t[field] ?? '').trim() : String(t[field] ?? '').trim() };
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

// 保存：入力済みにして、調査日・調査者を記録し（入力済みの木を直したときは元のまま）、次の未入力の木へ移る
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
    // 調査日・調査者は初めて入力済みにしたときだけ入れる（入力済みの木を後日直しても元のまま。直すときは「まとめて直す」）
    date: x.done && x.date ? x.date : state.session.date,
    inspector: x.done && x.inspector ? x.inspector : state.session.inspector,
  }));
  if (after === 'stay') return { state: next, missing, saved: true }; // 保存だけ（同じ木のまま続けて直せる）
  if (after === 'list') return { state: { ...next, view: 'list' }, missing, saved: true };
  // もう1本追加：今の木の次に入れる（現地で続けて見つけた木を、見つけた順に並べる）
  if (after === 'add') return { state: addTree(next, cfg, { area: t.area || '', now: Date.parse(now) + 1 || Date.now(), afterId: t.id }), missing, saved: true };
  const n = nextTodo(next, cfg);
  next = n ? { ...next, currentId: n.id } : { ...next, view: 'list' };
  return { state: next, missing, saved: true };
}

// 次の番号（設定 numbering：まとまりごとに start から順に振る）
//  数字だけの番号のうち一番大きいものの次。枝番（例 3-1）や文字の入った番号は数えない
export function nextTreeNo(trees, cfg) {
  const start = cfg.numbering?.start ?? 1;
  const nums = trees.map((t) => toHalf(t.treeNo).trim()).filter((v) => /^\d+$/.test(v)).map(Number);
  return String(nums.length ? Math.max(...nums) + 1 : start);
}

// まとまり（公園・路線）を足す（設定 addGroups。台帳がなくても現地で作れる）
//  values … 設定の fields の項目ごとの値（例 { routeName, routeNo }）。まとまりの名前の項目は必須
//  その中の1本目の木を作って開く（まとまりは木から作られるので、木がないまとまりは作れない）
// 返す形：{ state, error（足せなかった理由。足せたら ''）, exists（同じ名前のまとまりがあり、そちらを開いた） }
export function addGroup(state, cfg, values, now = Date.now()) {
  const ag = cfg.addGroups;
  const sheet = ag && cfg.dbFormat.sheets.find((x) => x.type === ag.siteType);
  if (!sheet) return { state, error: 'この設定では足せません', exists: false };
  const info = { siteType: ag.siteType };
  for (const f of ag.fields) {
    const v = toHalf(values?.[f.key] ?? '').trim();
    if (!v && (f.required || f.key === sheet.identify)) return { state, error: `${f.label}を入れてください`, exists: false };
    info[f.key] = v;
  }
  const key = groupKey(info, cfg);
  if (state.trees.some((t) => groupKey(t, cfg) === key)) return { state: { ...state, group: key, area: '', view: 'list' }, error: '', exists: true };
  const uid = `${state.server?.deviceId || 'dev'}-${Number(now).toString(36)}`;
  const nt = blankTree({ id: `new:${now}`, uid, status: cfg.newTreeStatus ?? '', ...info });
  if (cfg.numbering) nt.treeNo = nextTreeNo([], cfg);
  return { state: { ...state, trees: [...state.trees, nt], group: key, area: '', currentId: nt.id, view: 'form' }, error: '', exists: false };
}

// 台帳にない木を追加する（場所の情報は同じまとまりの最初の木から写す）
//  uid … 追加した木の印（端末の印＋時刻）。番号の代わりにこれで木を見分ける（review.js の treeKey）
//  afterId … この木の次に入れる（木の after にその木の鍵を覚え、一覧表を読み込み直しても位置を保つ。order.js）。
//            なければ、まとまりの最後に入れる
//  設定 numbering があれば、まとまりの最後に足す木には次の番号を入れ、前の木から写す項目（carry。例 樹種）を写す。
//  途中に差し込む木（afterId がまとまりの最後の木でない）は、番号を空欄にして自分で入れてもらう（後ろの番号は振り直さない）
export function addTree(state, cfg, { area = '', now = Date.now(), afterId = '' } = {}) {
  const ts = currentGroupTrees(state, cfg);
  const anchor = afterId ? state.trees.find((x) => x.id === afterId) : null;
  const ref = anchor || ts[0] || {};
  const copyKeys = ['siteType', ...cfg.dbFormat.infoKeys];
  const uid = `${state.server?.deviceId || 'dev'}-${Number(now).toString(36)}`;
  const nt = blankTree({ id: `new:${now}`, uid, status: cfg.newTreeStatus ?? '', area });
  for (const k of copyKeys) if (ref[k] !== undefined) nt[k] = ref[k];
  if (cfg.numbering) {
    const live = ts.filter((x) => !x.deleted);
    const prev = anchor || live.at(-1);
    if (!anchor || anchor === live.at(-1)) nt.treeNo = nextTreeNo(live, cfg);
    for (const k of cfg.numbering.carry || []) if (prev?.[k]) nt[k] = prev[k];
  }
  let trees;
  if (anchor) {
    nt.after = simpleKey(anchor, cfg);
    trees = placeAdded([...state.trees, nt], cfg);
  } else {
    // まとまりの最後の木の直後に入れる
    const last = ts.at(-1);
    const at = last ? state.trees.indexOf(last) + 1 : state.trees.length;
    trees = [...state.trees.slice(0, at), nt, ...state.trees.slice(at)];
  }
  return { ...state, trees, currentId: nt.id, view: 'form', group: state.group || groupKey(nt, cfg) };
}

// 追加した木の並び（どの木の次か）を変える。afterId が '' なら、まとまりの最後へ
export function setAddedPlace(state, cfg, id, afterId, now) {
  const t = state.trees.find((x) => x.id === id);
  if (!t || !isAddedTree(t)) return state;
  const anchor = afterId ? state.trees.find((x) => x.id === afterId) : null;
  const after = anchor ? simpleKey(anchor, cfg) : '';
  if ((t.after || '') === after) return state;
  // 並びは送る内容にも入る（他の端末でも同じ位置に並ぶ）。入力済みの木だけ送り直す
  const moved = { ...t, after, ...(t.done ? { sent: false, updatedAt: stamp(now) } : {}) };
  let trees = state.trees.filter((x) => x.id !== id);
  if (!anchor) {
    const at = afterSameGroup(trees, moved, cfg);
    trees = [...trees.slice(0, at), moved, ...trees.slice(at)];
  } else trees = placeAdded([...trees, moved], cfg);
  return { ...state, trees };
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

// ---------- 現地の番号に変える（一覧表の行の木を、現地の番号の追加した木にする） ----------
//  一覧表の番号と現地の番号札が違ったとき、調査者が使う。
//  ・入力した内容は、現地の番号の「追加した木」に移す（uid を付ける。並びは元の行の次＝今と同じ位置）。
//    内勤さんが一覧表のその行の番号を現地の番号に直して読み込めば、追加した木がその行に結び付く（ledger.js の takeAdded）
//  ・元の一覧表の行の木は、空の木（未入力）に戻す。サーバーに届いていれば、空に戻ったことを送る（他の端末でも二重にならない）
//  ・詳しい診断の記録・付箋も新しい番号の木に移す。確定は外す（番号が変わったので確かめ直す）
//  ・dropLines：特記事項から消す行（「PI915に変更」のような番号の書き込み。一覧表の特記に書かれないように）
//  返す形：新しい状態（今の木は新しい木）
//  moved：一覧表の読み込みで、同じ番号の行が別の場所に入って行の当たり先が変わる木を、行から外すとき（detachMoved）。
//         番号は変えず、印（uid）は元の鍵から決める（どの端末で外しても同じ木になる）。元の行・新しい番号の印は残さない
export function renumberToAdded(state, cfg, id, newNo, { dropLines = [], now = Date.now(), moved = false } = {}) {
  const t = state.trees.find((x) => x.id === id);
  if (!t) return state;
  const isMoved = moved;
  const at = new Date(now).toISOString();
  const oldKey = simpleKey(t, cfg);
  let no;
  let uid;
  if (moved) {
    no = toHalf(t.treeNo).trim();
    uid = `mv-${oldKey.replace(/[^0-9A-Za-z]+/g, '-')}`;
  } else {
    if (isAddedTree(t)) throw new Error('追加した木は、番号の欄をそのまま直してください');
    if (t.source === 'ledger') throw new Error('台帳で入力済みの木は変えられません');
    if (t.conflict) throw new Error('別の端末との食い違いがあります。先にどちらを使うか選んでください');
    no = toHalf(String(newNo || '')).trim().toUpperCase();
    if (!no) throw new Error('現地の番号を入れてください');
    if (no === toHalf(t.treeNo).trim().toUpperCase()) throw new Error('今の番号と同じです');
    uid = `${state.server?.deviceId || 'dev'}-${Number(now).toString(36)}`;
  }

  // 新しい木（入力した内容をそのまま持つ。一覧表の行との結び付きは外す）
  const { ledgerRow, ledgerGone, order, ledgerSerial, ledgerDuplicate, ledgerSpecies, rev, conflict, ...data } = t;
  const notes = String(t.notes || '')
    .split('\n')
    .filter((l) => !dropLines.includes(l))
    .join('\n');
  const nt = {
    ...data,
    id: moved ? `new:${uid}` : `new:${now}`,
    uid,
    treeNo: no,
    dupIndex: 1,
    ...(moved ? {} : { after: oldKey, renamedFrom: { treeNo: t.treeNo, dupIndex: t.dupIndex || 1 } }), // after：元の行（空に戻した木）の次 ＝ 今と同じ位置
    notes,
    sent: false,
    conflict: null,
    updatedAt: at,
  };
  const newKey = simpleKey(nt, cfg);

  // 元の行の木は空に戻す（場所の情報・一覧表の行はそのまま）
  const keep = ['siteType', ...cfg.dbFormat.infoKeys];
  const blank = blankTree({ id: t.id, treeNo: t.treeNo, dupIndex: t.dupIndex, status: t.status, species: ledgerSpecies ?? '' });
  for (const k of keep) if (t[k] !== undefined) blank[k] = t[k];
  Object.assign(blank, { ledgerRow, order, ledgerSerial, ledgerDuplicate, ledgerSpecies, updatedAt: at }, moved ? { species: '' } : { renamedTo: uid });
  if (rev > 0) Object.assign(blank, { rev, sent: false }); // 空に戻ったことを送る
  let trees = state.trees.map((x) => (x.id === id ? blank : x));
  trees = placeAdded([...trees, nt], cfg);

  // 詳しい診断の記録：新しい木に移す。元の記録は、サーバーに届いていれば未入力に戻ったことを送り、届いていなければ消す
  let initials = state.initials || [];
  const rec = initials.find((r) => r.id && `initial|${simpleKey(r, cfg)}` === `initial|${oldKey}`);
  if (rec) {
    const { rev: rrev, conflict: rc, ...rd } = rec;
    const moved = { ...rd, id: `ini:${nt.id}`, uid, treeNo: no, dupIndex: 1, sent: false, conflict: null, updatedAt: at };
    initials = initials.filter((r) => r !== rec);
    //  moved（行の当たり先が変わる木）では、元の鍵の記録に中身を残さない（その鍵は別の木のものになるため）
    if (rrev > 0) {
      initials = [...initials, isMoved ? { id: rec.id, siteType: rec.siteType, treeNo: rec.treeNo, dupIndex: rec.dupIndex, rev: rrev, done: false, sent: false, updatedAt: at } : { ...rec, done: false, sent: false, renamedTo: uid, updatedAt: at }];
    }
    initials = [...initials, moved];
  }

  // 付箋は新しい木に付け替える（送り直す）
  const stickies = { ...(state.stickies || {}) };
  for (const [sid, s] of Object.entries(stickies)) {
    if (s.treeId === oldKey) stickies[sid] = { ...s, treeId: newKey, dirty: true };
    else if (s.treeId === `initial|${oldKey}`) stickies[sid] = { ...s, treeId: `initial|${newKey}`, dirty: true };
  }
  // 確定は外す（番号が変わったので、事務が確かめ直す）
  const confirms = { ...(state.confirms || {}) };
  for (const k of [oldKey, `initial|${oldKey}`]) {
    if (confirms[k]?.value) confirms[k] = { ...confirms[k], value: false, at, updatedAt: at, dirty: true };
  }
  return { ...state, trees, initials, stickies, confirms, currentId: moved ? state.currentId : nt.id };
}

// 一覧表の読み込みの前に：同じ番号の行が別の場所に入って、行の当たり先が変わる木を行から外す（追加した木と同じ扱いにする）。
//  外した木は、読み込みで「番号＋場所の名前」が合う行に結び付く（ledger.js の takeAdded）。入力・詳しい診断の記録・付箋も一緒
//  places：新しい一覧表の「鍵 → 場所の名前」（ledger.js の rowPlaces）。keepIds：詳しい診断の記録・付箋・確定がある木
//  返す形：{ state, moved: [知らせの文…] }
export function detachMoved(state, cfg, places, keepIds = new Set(), now = Date.now()) {
  const half = (v) => toHalf(String(v ?? '')).trim();
  const moved = [];
  let s = state;
  for (const t of state.trees) {
    if (!t.ledgerRow || t.ledgerGone || t.uid || t.deleted) continue;
    const pk = cfg.dbFormat.sheets.find((x) => x.type === t.siteType)?.identify;
    const mine = half(pk && t[pk]);
    const theirs = places.get(`${t.siteType}|${half(t.treeNo)}|${t.dupIndex || 1}`);
    if (!mine || theirs === undefined || theirs === mine) continue;
    // 何か入力した木・記録のある木だけ（空の木・台帳を写しただけの木は、新しい行の内容に入れ替わるだけでよい）
    const hasInput = (t.source === 'app' && (t.done || t.rev > 0 || !!t.vigor || !!half(t.height) || !!half(t.notes) || (t.measures || []).length > 0)) || !!t.appBackup;
    if (!hasInput && !keepIds.has(t.id)) continue;
    s = renumberToAdded(s, cfg, t.id, '', { moved: true, now });
    moved.push(`${half(t.treeNo)}（${mine}）`);
  }
  return { state: s, moved };
}

// 特記事項のうち、番号の書き込みらしい行（現地の番号の数字を含む行）。「現地の番号に変える」で消す候補に出す
export function numberNoteLines(t, newNo) {
  const digits = String(toHalf(newNo || '')).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return [];
  return String(t.notes || '')
    .split('\n')
    .filter((l) => l.trim() && toHalf(l).replace(/\D/g, ' ').split(' ').some((d) => d && d.replace(/^0+/, '') === digits));
}
