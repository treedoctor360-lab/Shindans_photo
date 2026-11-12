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
//  「無」に当たる値は設定 noneValue（省略時「無」）。項目ごとに checks の none で変えられる（例 要否の項目は「不」）
//  選択肢にその値がない項目は飛ばす。設定 initial.fillNone が true なら、詳しい診断の要否もまだなら initial.no にする
//  返す形：{ tree, keys: [「無」にした項目…] }
export function fillChecksNone(t, cfg) {
  const noneOf = (c) => c.none || cfg.noneValue || '無';
  const list = cfg.checks.map((c) => ({ key: c.key, v: noneOf(c) })).filter(({ key, v }) => !t[key] && (cfg.options[key] || []).includes(v));
  if (cfg.initial?.fillNone && !t.initialNeeded) list.push({ key: 'initialNeeded', v: cfg.initial.no });
  let tree = t;
  for (const { key, v } of list) tree = pressOption(tree, key, v, cfg);
  return { tree, keys: list.map((x) => x.key) };
}

// 「すべて無にする」のボタンの文（要否の項目なども入れるときは、その値も書く）
export function checksNoneLabel(cfg) {
  const none = cfg.noneValue || '無';
  const others = [...new Set([...cfg.checks.map((c) => c.none).filter((v) => v && v !== none), ...(cfg.initial?.fillNone ? [cfg.initial.no] : [])])];
  return `まだ選んでいない点検項目をすべて「${none}」${others.length ? `（要否などは「${others.join('・')}」）` : ''}にする`;
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
//  firstTree … 1本目の木に入れておく値（一覧から選んだまとまりの樹種など。例 { species }）
export function addGroup(state, cfg, values, now = Date.now(), firstTree = {}) {
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
  if (firstTree.species) nt.species = firstTree.species;
  return { state: { ...state, trees: [...state.trees, nt], group: key, area: '', currentId: nt.id, view: 'form' }, error: '', exists: false };
}

// 台帳にない木を追加する（場所の情報は同じまとまりの最初の木から写す）
//  uid … 追加した木の印（端末の印＋時刻）。番号の代わりにこれで木を見分ける（review.js の treeKey）
//  afterId … この木の次に入れる（木の after にその木の鍵を覚え、一覧表を読み込み直しても位置を保つ。order.js）。
//            なければ、まとまりの最後に入れる
//  設定 numbering があれば、まとまりの最後に足す木には次の番号を入れ、前の木から写す項目（carry。例 樹種）を写す。
//  途中に差し込む木（afterId がまとまりの最後の木でない）は、番号を空欄にして自分で入れてもらう（後ろの番号は振り直さない）
export function addTree(state, cfg, { area = '', now = Date.now(), afterId = '', beforeId = '' } = {}) {
  const ts = currentGroupTrees(state, cfg);
  // beforeId：その木の前に入れる＝その木の1つ前の木の次に入れる（まとまりの先頭なら、先頭に入れる）
  const before = beforeId ? state.trees.find((x) => x.id === beforeId) : null;
  const prevOfBefore = before ? ts[ts.indexOf(before) - 1] || null : null;
  const anchor = before ? prevOfBefore : afterId ? state.trees.find((x) => x.id === afterId) : null;
  const ref = anchor || before || ts[0] || {};
  const copyKeys = ['siteType', ...cfg.dbFormat.infoKeys];
  const uid = `${state.server?.deviceId || 'dev'}-${Number(now).toString(36)}`;
  const nt = blankTree({ id: `new:${now}`, uid, status: cfg.newTreeStatus ?? '', area });
  for (const k of copyKeys) if (ref[k] !== undefined) nt[k] = ref[k];
  if (cfg.numbering) {
    const live = ts.filter((x) => !x.deleted);
    const prev = anchor || (before ? null : live.at(-1)) || before;
    // まとまりの最後に足す木だけ次の番号。途中・先頭に差し込む木は番号を空欄にする
    if (!before && (!anchor || anchor === live.at(-1))) nt.treeNo = nextTreeNo(live, cfg);
    for (const k of cfg.numbering.carry || []) if (prev?.[k]) nt[k] = prev[k];
  }
  let trees;
  if (anchor) {
    trees = placeAdded(linkAfter([...state.trees, nt], cfg, nt, anchor, now), cfg);
  } else if (before) {
    // まとまりの先頭に入れる：その木の位置に入れ、その木を新しい木の次にする
    const at = state.trees.indexOf(before);
    trees = linkFirst([...state.trees.slice(0, at), nt, ...state.trees.slice(at)], cfg, nt, before, now);
  } else {
    // まとまりの最後の木の直後に入れる
    const last = ts.at(-1);
    const at = last ? state.trees.indexOf(last) + 1 : state.trees.length;
    trees = [...state.trees.slice(0, at), nt, ...state.trees.slice(at)];
  }
  return { ...state, trees, currentId: nt.id, view: 'form', group: state.group || groupKey(nt, cfg) };
}

// ---------- 並びの付け替え（差し込み・並びの選び直し・路線を移す） ----------
//  追加した木の並びは、木の after（次に置く木の鍵）でつながっている（src/store/order.js）。
//  ある木の直後に入れるときは、その木の次にあった木（after がその木の木）を、入れる木の次に付け替える。
//  付け替えないと、次にあった木の後ろに並んでしまう（同じ木の次に追加した木は、追加した順に並べるため）

// 一覧表の行に結び付いていない木（after で並ぶ木）
const unbound = (t) => !t.ledgerRow || !!t.ledgerGone;
// after を変えた木の印：入力済みなら送り直す
const relinked = (t, after, now) => (t.after || '') === after ? t : { ...t, after, ...(t.done ? { sent: false, updatedAt: stamp(now) } : {}) };

// m を anchor の直後に置く（m は trees に入っていること）。anchor の次にあった木は m の次へ
export function linkAfter(trees, cfg, m, anchor, now) {
  const ak = simpleKey(anchor, cfg);
  const mk = simpleKey(m, cfg);
  return trees.map((t) => {
    if (t === m) return relinked(t, ak, now);
    if (unbound(t) && t.after === ak) return relinked(t, mk, now);
    return t;
  });
}

// m をまとまりの先頭（first の前）に置く（m は trees の first の前に入っていること）
function linkFirst(trees, cfg, m, first, now) {
  const mk = simpleKey(m, cfg);
  return trees.map((t) => {
    if (t === m) return relinked(t, '', now);
    if (t === first && unbound(t)) return relinked(t, mk, now);
    return t;
  });
}

// 木を並びから外すとき：その木の次にあった木を、その木の前の木の次に付け替える（すき間を詰める）
function unlink(trees, cfg, gone, now) {
  const map = new Map(gone.map((g) => [simpleKey(g, cfg), g.after || '']));
  const resolve = (k) => {
    let v = k;
    for (let i = 0; i < 1000 && map.has(v); i++) v = map.get(v); // 外す木が続いていれば、その前までたどる
    return v;
  };
  return trees.map((t) => (gone.includes(t) || !unbound(t) || !map.has(t.after || '') ? t : relinked(t, resolve(t.after), now)));
}

// ---------- 番号を並び順に振り直す・別のまとまり（路線）へ移す ----------

// 今の公園・路線の番号を、並び順に 1 から振り直す（設定 numbering の start から）
//  削除した木は数えない。一覧表の行に結び付いた木があるまとまりはしない（一覧表の番号を変えられないため）
//  返す形：{ state, changes: [{ id, from, to }], error }。番号が変わった入力済みの木は送り直す（確定は外れる）
export function renumberGroup(state, cfg, now) {
  const live = currentGroupTrees(state, cfg).filter((t) => !t.deleted);
  if (live.some((t) => !unbound(t))) return { state, changes: [], error: '一覧表の行に結び付いた木があるため、番号を振り直せません' };
  const start = cfg.numbering?.start ?? 1;
  const changes = [];
  live.forEach((t, i) => {
    const to = String(start + i);
    if (toHalf(t.treeNo).trim() !== to) changes.push({ id: t.id, from: t.treeNo || '', to });
  });
  if (!changes.length) return { state, changes, error: '' };
  const byId = new Map(changes.map((c) => [c.id, c.to]));
  const trees = state.trees.map((t) => (byId.has(t.id) ? { ...t, treeNo: byId.get(t.id), ...(t.done ? { sent: false, updatedAt: stamp(now) } : {}) } : t));
  return { state: { ...state, trees }, changes, error: '' };
}

// 木を別の公園・路線へ移す
//  id の木から（rest: true ならその後ろの木すべて。削除した木は除く）を、移す先（values：場所の情報 { siteType, 名前の項目, … }）の最後に並べる
//  移す先の番号は、numbering があればその続きを振る。元の公園・路線では、移した木の前後をつなぎ直す
//  返す形：{ state, moved: [id…], error }
export function moveTrees(state, cfg, { id, rest = false, values, now }) {
  const src = currentGroupTrees(state, cfg);
  const x = src.find((t) => t.id === id);
  if (!x) return { state, moved: [], error: '木が見つかりません' };
  const block = (rest ? src.slice(src.indexOf(x)) : [x]).filter((t) => !t.deleted);
  if (block.some((t) => !unbound(t))) return { state, moved: [], error: '一覧表の行に結び付いた木は移せません' };
  const copyKeys = ['siteType', ...cfg.dbFormat.infoKeys];
  const destKey = groupKey({ ...values }, cfg);
  if (destKey === groupKey(x, cfg)) return { state, moved: [], error: '同じ路線です' };
  // 元の並びから外し、すき間を詰める
  let trees = unlink(state.trees.filter((t) => !block.includes(t)), cfg, block, now);
  const dest = treesOfGroup(trees, destKey, cfg);
  const destLive = dest.filter((t) => !t.deleted);
  let no = cfg.numbering ? Number(nextTreeNo(destLive, cfg)) : null;
  let prev = dest.at(-1) || null;
  const moved = block.map((t) => {
    const m = { ...t };
    for (const k of copyKeys) m[k] = values[k] ?? '';
    if (no != null) m.treeNo = String(no++);
    m.after = prev ? simpleKey(prev, cfg) : '';
    if (m.done) Object.assign(m, { sent: false, updatedAt: stamp(now) });
    prev = m;
    return m;
  });
  // 移す先の最後の木の直後（移す先に木がなければ、いちばん後ろ）に入れる
  const at = dest.length ? trees.indexOf(dest.at(-1)) + 1 : trees.length;
  trees = placeAdded([...trees.slice(0, at), ...moved, ...trees.slice(at)], cfg);
  return { state: { ...state, trees, group: destKey, currentId: x.id }, moved: moved.map((m) => m.id), error: '' };
}

// 追加した木の並び（どの木の次か）を変える。afterId が '' なら、まとまりの最後へ
export function setAddedPlace(state, cfg, id, afterId, now) {
  const t = state.trees.find((x) => x.id === id);
  if (!t || !isAddedTree(t)) return state;
  const anchor = afterId ? state.trees.find((x) => x.id === afterId) : null;
  const after = anchor ? simpleKey(anchor, cfg) : '';
  if ((t.after || '') === after) return state;
  // 並びは送る内容にも入る（他の端末でも同じ位置に並ぶ）。入力済みの木だけ送り直す
  //  元の位置のすき間を詰め（この木の次にあった木を、この木の前の木の次へ）、新しい位置ではその木の次にあった木をこの木の次へ
  let trees = unlink(state.trees.filter((x) => x.id !== id), cfg, [t], now);
  if (!anchor) {
    const moved = relinked(t, '', now);
    const at = afterSameGroup(trees, moved, cfg);
    trees = [...trees.slice(0, at), moved, ...trees.slice(at)];
  } else {
    const moved = { ...t };
    trees = placeAdded(linkAfter([...trees, moved], cfg, moved, anchor, now), cfg);
  }
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
