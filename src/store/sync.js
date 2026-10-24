// サーバー（GAS）とのやり取り
//  送信（push）・受信（pull）：記録を版番号つきでやり取りする（下の説明を参照）
//  ファイル：設定・野帳の原本・台帳をサーバーに置く／受け取る
//
// 本文は JSON の文字として送る（Content-Type を付けないことで、ブラウザの事前確認なしに送れる）

import { SURVEYS, recordsOf, surveyOfKind } from './surveys.js';

// つながらなかった失敗（少し待てば通るかもしれない）。retriable の印を付ける
//  サーバーが理由を付けて断ったもの（合言葉が違うなど）は、待っても変わらないので印を付けない
const retriable = (message) => Object.assign(new Error(message), { retriable: true });

// サーバーに送る。返す JSON の ok が false なら、その理由で失敗にする
export async function callServer(server, body, fetchFn = fetch) {
  if (!server?.url) throw new Error('サーバーの URL が設定されていません');
  let res;
  try {
    res = await fetchFn(server.url, { method: 'POST', body: JSON.stringify({ ...body, pass: server.pass || '' }) });
  } catch {
    throw retriable('サーバーにつながりませんでした（通信できません）');
  }
  if (!res.ok) throw retriable(`サーバーにつながりませんでした（${res.status}）`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('サーバーの返事が読めませんでした（URL が正しいか確認してください）');
  }
  if (!data.ok) throw new Error(data.error || 'サーバーで失敗しました');
  return data;
}

// ---------- 記録の送受信（版番号つき） ----------
//
// サーバーには「記録」を送る。記録の種類は、入力内容（調査の種類ごと。surveys.js の一覧。簡易診断は tree）・
// sticky（付箋）・confirm（確定の印）。
// 送るときは「自分が最後に見た版（baseRev）」を付け、他の人が先に変えていればサーバーが断る（conflict）。
//  入力内容の食い違い … 黙って上書きせず、記録に conflict を付けて、どちらを使うか人に選んでもらう
//  sticky の食い違い … 質問・修正案は事務、返事は調査者のものなので、持ち主ごとに合わせて送り直す
//  confirm の食い違い … 事務どうしの操作なので、サーバーの版に合わせて送り直す
//
// 受け取りは「前回から変わった記録だけ」（サーバーの通し番号 lastSeq より後）。

const LOCAL_ONLY = ['id', 'sent', 'rev', 'conflict', 'order'];

// まだ送っていない記録（アプリで入力・送信待ちで、入力済みか、サーバーに一度届いたもの）
//  サーバーに届いた後で「入力の取り消し」をした木は、未入力に戻ったことを送る
const isUnsent = (t) => t.source === 'app' && !t.sent && (t.done || t.rev > 0);
const unsentOf = (state, survey) => recordsOf(state, survey).filter(isUnsent);
export const unsentTrees = (state) => state.trees.filter(isUnsent); // 簡易診断の木
const dirtyStickies = (state) => Object.values(state.stickies || {}).filter((x) => x.dirty);
const dirtyConfirms = (state) => Object.values(state.confirms || {}).filter((x) => x.dirty);
export const unsentCount = (state) =>
  SURVEYS.reduce((n, sv) => n + unsentOf(state, sv).length, 0) + dirtyStickies(state).length + dirtyConfirms(state).length;

// 未送信の記録の一覧（画面で「何が・なぜ」送れていないかを見せる）
//  返す形：[{ kind, id, label, conflict（別の端末との食い違いで、どちらを使うか選ぶまで送らない） }]
export function unsentList(state, cfg) {
  const out = [];
  for (const sv of SURVEYS)
    for (const t of unsentOf(state, sv))
      out.push({ kind: sv.kind, id: t.id, label: `${sv.id === 'simple' ? '' : '詳しい診断 '}${t.treeNo || '（番号なし）'}`, conflict: !!t.conflict });
  for (const x of dirtyStickies(state)) out.push({ kind: 'sticky', id: x.id, label: `付箋（${labelOfKey(state, x.treeId, cfg)}）`, conflict: false });
  for (const x of dirtyConfirms(state)) out.push({ kind: 'confirm', id: x.treeId, label: `確定の印（${labelOfKey(state, x.treeId, cfg)}）`, conflict: false });
  return out;
}
// 記録の鍵から、木の番号を探す（見つからなければ鍵のまま）
function labelOfKey(state, key, cfg) {
  for (const sv of SURVEYS) {
    const t = recordsOf(state, sv).find((r) => sv.keyOf(r, cfg) === key);
    if (t) return t.treeNo || key;
  }
  return key || '';
}

const treeData = (t) => {
  const d = { ...t };
  LOCAL_ONLY.forEach((k) => delete d[k]);
  return d;
};
const stickyData = (s) => {
  const { rev, dirty, edited, ...d } = s;
  return d;
};
const confirmData = (c) => {
  const { rev, dirty, ...d } = c;
  return d;
};

// 送る記録と、送った時点の印（送信中に変わったものは送信済みにしないため）
export function outbox(state, cfg) {
  const by = state.user?.name || '';
  const records = [];
  const tokens = new Map();
  for (const sv of SURVEYS) {
    for (const t of unsentOf(state, sv)) {
      const key = sv.keyOf(t, cfg);
      if (t.conflict) continue; // 食い違いを人が選ぶまでは送らない
      const id = `${sv.kind}:${key}`;
      records.push({ id, kind: sv.kind, treeId: key, baseRev: t.rev || 0, updatedAt: t.updatedAt || '', by, data: treeData(t) });
      tokens.set(id, { localId: t.id, token: t.updatedAt });
    }
  }
  for (const s of dirtyStickies(state)) {
    records.push({ id: `sticky:${s.id}`, kind: 'sticky', treeId: s.treeId, baseRev: s.rev || 0, updatedAt: s.updatedAt, by, data: stickyData(s) });
    tokens.set(`sticky:${s.id}`, { localId: s.id, token: s.updatedAt });
  }
  for (const c of dirtyConfirms(state)) {
    records.push({ id: `confirm:${c.treeId}`, kind: 'confirm', treeId: c.treeId, baseRev: c.rev || 0, updatedAt: c.updatedAt, by, data: confirmData(c) });
    tokens.set(`confirm:${c.treeId}`, { localId: c.treeId, token: c.updatedAt });
  }
  return { records, tokens };
}

// 送る。状態は書き換えず、結果は applyPush で「その時点の最新の状態」に当てはめる
export async function push(state, cfg, fetchFn = fetch) {
  const { records, tokens } = outbox(state, cfg);
  if (!records.length) return { results: [], tokens };
  const r = await callServer(state.server, { action: 'push', year: cfg.job.year, deviceId: state.server.deviceId, records }, fetchFn);
  return { results: r.results || [], tokens };
}

// 中身が同じか（項目の並び順は問わない）
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const sameData = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
// 入力内容が同じか（保存した時刻 updatedAt は比べない。2台で同じ内容に直したときは食い違いにしない）
const withoutTime = (d) => {
  if (!d || typeof d !== 'object') return d;
  const { updatedAt, ...rest } = d;
  return rest;
};
const sameContent = (a, b) => sameData(withoutTime(a), withoutTime(b));

// どちらの端末でも削除済み：中身を比べるまでもないので、食い違いにせずサーバーの版にそろえる
const bothDeleted = (server, local) => !!server?.deleted && !!local?.deleted;
const takeServer = (local, data, rev) => ({ ...data, id: local.id, order: local.order, rev, sent: true, conflict: null });

// 前の版のアプリで残った「どちらも削除済み」「中身が同じ（保存した時刻だけ違う）」の食い違いを片付ける
function settleDeleted(list) {
  return list.map((t) =>
    t.conflict && (bothDeleted(t.conflict.data, t) || sameContent(t.conflict.data, treeData(t))) ? takeServer(t, t.conflict.data, t.conflict.rev) : t,
  );
}

// 付箋の食い違いを、持ち主ごとに合わせる（送り直す前提で dirty のまま、版はサーバーに合わせる）
function mergeSticky(local, server, rev) {
  if (!server) return { ...local, rev };
  if (local.edited === 'answer') return { ...server, answer: local.answer, updatedAt: local.updatedAt, rev, dirty: true, edited: 'answer' };
  return { ...server, ...stickyBody(local), answer: server.answer, updatedAt: local.updatedAt, rev, dirty: true, edited: 'body' };
}
const stickyBody = (s) => ({ field: s.field, question: s.question, proposal: s.proposal, closed: s.closed, deleted: s.deleted });

// 送った結果を当てはめる。返す形：{ state, saved, conflicts: [木の番号…], rejected: [{ label, error }]（サーバーに断られた記録） }
export function applyPush(state, results, tokens, cfg) {
  const lists = Object.fromEntries(SURVEYS.map((sv) => [sv.list, recordsOf(state, sv)]));
  const stickies = { ...(state.stickies || {}) };
  const confirms = { ...(state.confirms || {}) };
  let saved = 0;
  const conflicts = [];
  const rejected = [];
  for (const r of results) {
    const tk = tokens.get(r.id);
    if (!tk) continue;
    const kind = r.id.split(':')[0];
    if (!r.ok && !r.conflict && r.error) rejected.push({ label: rejectedLabel(state, kind, tk.localId, cfg), error: String(r.error) }); // 未送信のまま残る
    const sv = surveyOfKind(kind);
    if (sv) {
      lists[sv.list] = lists[sv.list].map((t) => {
        if (t.id !== tk.localId) return t;
        if (r.ok) {
          saved++;
          return { ...t, rev: r.rev, sent: t.updatedAt === tk.token ? true : t.sent };
        }
        // 送信はサーバーに届いていたのに、返事が届く前に通信が切れた場合：サーバーの内容はこの端末が送ったものと同じ。
        // 自分どうしの食い違いにはせず、送信済みとして扱う
        if (r.conflict && sameData(r.data, treeData(t))) {
          saved++;
          return { ...t, rev: r.rev, sent: t.updatedAt === tk.token ? true : t.sent, conflict: null };
        }
        if (r.conflict && bothDeleted(r.data, t)) {
          saved++;
          return takeServer(t, r.data, r.rev);
        }
        // 別の端末が先に同じ内容を送っていた（保存した時刻だけ違う）：食い違いにせず、サーバーの版にそろえる
        if (r.conflict && sameContent(r.data, treeData(t))) {
          saved++;
          return t.updatedAt === tk.token ? takeServer(t, r.data, r.rev) : { ...t, rev: r.rev, conflict: null };
        }
        if (r.conflict) {
          conflicts.push(t.treeNo);
          return { ...t, conflict: { rev: r.rev, by: r.by, updatedAt: r.updatedAt, data: r.data } };
        }
        return t;
      });
    } else if (kind === 'sticky') {
      const s = stickies[tk.localId];
      if (!s) continue;
      if (r.ok) {
        saved++;
        stickies[tk.localId] = { ...s, rev: r.rev, dirty: s.updatedAt === tk.token ? false : s.dirty };
      } else if (r.conflict) stickies[tk.localId] = mergeSticky(s, r.data, r.rev);
    } else if (kind === 'confirm') {
      const c = confirms[tk.localId];
      if (!c) continue;
      if (r.ok) {
        saved++;
        confirms[tk.localId] = { ...c, rev: r.rev, dirty: c.updatedAt === tk.token ? false : c.dirty };
      } else if (r.conflict) confirms[tk.localId] = { ...c, rev: r.rev, dirty: true };
    }
  }
  return { state: { ...state, ...lists, stickies, confirms }, saved, conflicts, rejected };
}

// 断られた記録の名前（木の番号。詳しい診断・付箋・確定はそれと分かるように）
function rejectedLabel(state, kind, localId, cfg) {
  const sv = surveyOfKind(kind);
  if (sv) {
    const t = recordsOf(state, sv).find((x) => x.id === localId);
    const no = (t?.treeNo && String(t.treeNo)) || '(番号なし)';
    return sv.kind === 'tree' ? no : `${no}の${cfg?.initialSurvey?.label || '詳しい診断'}`;
  }
  return kind === 'sticky' ? '付箋' : kind === 'confirm' ? '確定' : kind;
}

// 断られた理由を、画面に出す文にする（なければ空）
//  「記録の形が違います」は、サーバー（GAS）が古い版のままで、その種類の記録を知らないときに出る
export function rejectedMessage(rejected) {
  if (!rejected?.length) return '';
  const list = rejected.slice(0, 5).map((x) => `${x.label}（${x.error}）`).join('・') + (rejected.length > 5 ? ` ほか${rejected.length - 5}件` : '');
  const hint = rejected.some((x) => x.error.includes('記録の形が違います'))
    ? '。サーバー（Apps Script）が古い版のままかもしれません。「デプロイを管理」で新しい版にしてください'
    : '';
  return `サーバーに断られました：${list}${hint}`;
}

// 受け取る（前回から変わった記録だけ）
export async function pull(state, cfg, fetchFn = fetch) {
  const r = await callServer(state.server, { action: 'pull', year: cfg.job.year, since: state.server.lastSeq || 0 }, fetchFn);
  return { records: r.records || [], lastSeq: r.lastSeq || 0 };
}

// 受け取った記録を当てはめる
//  返す形：{ state, changedTrees: [木の番号…]（他の端末で変わった木）, newStickies: 件数, conflicts: [木の番号…] }
export function applyPull(state, records, lastSeq, cfg) {
  // 種類ごとに、記録の配列（複製）と「鍵 → 配列の位置」の索引を用意する
  const lists = {};
  const indexes = {};
  const reindex = (sv) => (indexes[sv.list] = new Map(lists[sv.list].map((t, i) => [sv.keyOf(t, cfg), i])));
  for (const sv of SURVEYS) {
    lists[sv.list] = settleDeleted(recordsOf(state, sv).map((t) => ({ ...t })));
    reindex(sv);
  }
  const stickies = { ...(state.stickies || {}) };
  const confirms = { ...(state.confirms || {}) };
  const changedTrees = [];
  const conflicts = [];
  let newStickies = 0;

  for (const rec of records) {
    const sv = surveyOfKind(rec.kind);
    if (sv) {
      const trees = lists[sv.list];
      const i = indexes[sv.list].get(rec.treeId);
      const incoming = { ...rec.data, rev: rec.rev, sent: true, conflict: null };
      if (i === undefined) {
        // 端末にない記録（別の端末で追加した木など）は、種類ごとに決めた場所（簡易診断は同じまとまりの最後）に入れる
        const t = { ...incoming, id: `srv:${rec.treeId}` };
        const at = sv.place ? sv.place(trees, t, cfg) : trees.length;
        trees.splice(at, 0, t);
        reindex(sv);
        changedTrees.push(t.treeNo);
        continue;
      }
      const local = trees[i];
      if (local.source === 'ledger' && !(local.rev > 0)) continue; // 台帳で入力済みの木は台帳を正とする
      if (rec.rev <= (local.rev || 0)) continue; // 自分が送ったもの・もう知っている版
      if (local.conflict && rec.rev <= local.conflict.rev) continue; // 送ったときに既に食い違いとして受け取った版
      const dirty = local.done && local.source === 'app' && !local.sent;
      if (bothDeleted(rec.data, local)) {
        trees[i] = takeServer(local, rec.data, rec.rev);
      } else if (dirty && sameData(rec.data, treeData(local))) {
        // この端末が送った内容（返事を受け取れなかった送信）。送信済みにする
        trees[i] = { ...local, rev: rec.rev, sent: true, conflict: null };
      } else if (dirty && sameContent(rec.data, treeData(local))) {
        // 別の端末が同じ内容に直していた（保存した時刻だけ違う）。食い違いにせず、サーバーの版にそろえる
        trees[i] = takeServer(local, rec.data, rec.rev);
      } else if (dirty) {
        // 自分にも送っていない修正がある → 黙って上書きしない
        trees[i] = { ...local, conflict: { rev: rec.rev, by: rec.by, updatedAt: rec.updatedAt, data: rec.data } };
        conflicts.push(local.treeNo);
      } else {
        trees[i] = { ...incoming, id: local.id, order: local.order };
        changedTrees.push(local.treeNo);
      }
    } else if (rec.kind === 'sticky') {
      const id = rec.data?.id;
      if (!id) continue;
      const local = stickies[id];
      if (local && rec.rev <= (local.rev || 0)) continue;
      if (!local) newStickies++;
      stickies[id] = local?.dirty ? mergeSticky(local, rec.data, rec.rev) : { ...rec.data, rev: rec.rev, dirty: false };
    } else if (rec.kind === 'confirm') {
      const key = rec.data?.treeId;
      if (!key) continue;
      const local = confirms[key];
      if (local && rec.rev <= (local.rev || 0)) continue;
      confirms[key] = local?.dirty ? { ...local, rev: rec.rev } : { ...rec.data, rev: rec.rev, dirty: false };
    }
  }
  return {
    state: { ...state, ...lists, stickies, confirms, server: { ...state.server, lastSeq: Math.max(state.server.lastSeq || 0, lastSeq) } },
    changedTrees,
    newStickies,
    conflicts,
  };
}

// 記録の食い違いを解決する（localId の記録を、どの種類の配列からでも探す）
//  'server' … サーバー（相手）の内容を使う / 'mine' … 自分の内容で上書きする（次の送信で送る）
export function resolveConflict(state, localId, choice) {
  const resolve = (t) => {
    if (t.id !== localId || !t.conflict) return t;
    const c = t.conflict;
    if (choice === 'server') return { ...c.data, id: t.id, order: t.order, rev: c.rev, sent: true, conflict: null };
    return { ...t, rev: c.rev, sent: false, conflict: null, updatedAt: new Date().toISOString() };
  };
  const lists = Object.fromEntries(SURVEYS.map((sv) => [sv.list, recordsOf(state, sv).map(resolve)]));
  return { ...state, ...lists };
}

// ArrayBuffer ⇔ base64（ファイルを文字にして送るため）
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export const putFile = (server, kind, name, buffer, fetchFn = fetch) =>
  callServer(server, { action: 'putFile', kind, name, base64: toBase64(buffer) }, fetchFn);

// 返す形：{ name, updated, buffer } または null（まだ置いていない）
export async function getFile(server, kind, fetchFn = fetch) {
  const r = await callServer(server, { action: 'getFile', kind }, fetchFn);
  return r.file ? { name: r.file.name, updated: r.file.updated, buffer: fromBase64(r.file.base64) } : null;
}
