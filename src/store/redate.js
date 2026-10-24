// 調査日・調査者をまとめて直す（調査者の操作）
//
// 設定画面の調査日・調査者を間違えたまま保存した木を、公園・路線ごとにまとめて直す。
//  ・直すのは調査日・調査者だけ（ほかの入力内容は変えない）
//  ・「調査日＋調査者」の組ごとに選び、その中から直す木を選べる
//  ・その木の詳しい診断の記録も、調査日（調査者）が直す前の値と同じなら一緒に直す
//  ・直した記録は普段の入力と同じく送る（版を確かめるので、黙って上書きはしない）
//  ・確定は外さない（調査日・調査者だけを直したことを dateFix に残す。review.js の reviewState）
//  ・別の端末との食い違いがある記録は直さない（先にどちらを使うか選ぶ）

import { initialOf } from './initial.js';
import { dateFixSig, dateKeysOf, inspectorKeyOf } from './review.js';
import { INITIAL, SIMPLE } from './surveys.js';

const ymd = (date) => String(date || '').split('-').map(Number);

// 記録の調査日（"2026-10-14" の形。詳しい診断は年・月・日の項目から作る）
export function recordDate(r, cfg, survey = SIMPLE) {
  if (survey.id !== INITIAL.id) return r.date || '';
  const [y, m, d] = dateKeysOf(cfg, survey).map((k) => Number(r[k]));
  return y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

// 記録の調査者
export function recordInspector(r, cfg, survey = SIMPLE) {
  const k = inspectorKeyOf(cfg, survey);
  return k ? String(r[k] ?? '') : '';
}

// 調査日・調査者を変えた記録（確定を外さないための印 dateFix を付ける）。to：{ date?, inspector? } 変える方だけ
function withFix(r, to, cfg, survey, now) {
  // すでに調査日・調査者だけを直した記録なら、確定したときの版を引き継ぐ
  const f = r.dateFix;
  const keep = f && f.sig === dateFixSig(r, cfg, survey, f.v || 1);
  const fromRev = keep ? f.fromRev : r.rev || 0;
  const next = { ...r, sent: false, updatedAt: now };
  if (to.date != null) {
    if (survey.id === INITIAL.id) {
      const [y, m, d] = ymd(to.date);
      const [ky, km, kd] = dateKeysOf(cfg, survey);
      Object.assign(next, { [ky]: y, [km]: m, [kd]: d });
    } else next.date = to.date;
  }
  const ik = inspectorKeyOf(cfg, survey);
  if (to.inspector != null && ik) next[ik] = to.inspector;
  next.dateFix = { fromRev, sig: dateFixSig(next, cfg, survey, 2), v: 2 };
  return next;
}

// 直せる記録：アプリで入力済み・削除していない
const canFix = (r) => r.done && r.source === 'app' && !r.deleted;

// 「調査日＋調査者」の組の一覧（その公園・路線の、アプリで入力済みの木）。新しい日付が先
//  返す形：[{ date, inspector, trees: [木] }]
export function pairsOf(state, cfg, trees) {
  const m = new Map();
  for (const t of trees) {
    if (!canFix(t)) continue;
    const key = `${t.date || ''}\u0000${t.inspector || ''}`;
    if (!m.has(key)) m.set(key, { date: t.date || '', inspector: t.inspector || '', trees: [] });
    m.get(key).trees.push(t);
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.inspector.localeCompare(b.inspector, 'ja'));
}

// 直す対象（実行する前に見せる）。from：{ date?, inspector? } 直す前の値（どちらかを省くと問わない）、to：{ date?, inspector? } 直した後の値
//  返す形：{ trees: [木], initials: [詳しい診断の記録], conflicts: [食い違いがあって直せない木・記録] }
//  木は、調査日・調査者が from に合い、to で何かが変わるもの。詳しい診断の記録は、選んだ木の記録で、変える方の値が from と同じもの
export function fixTargets(state, cfg, trees, from, to) {
  const out = { trees: [], initials: [], conflicts: [] };
  const hit = (date, insp) => (from.date == null || date === from.date) && (from.inspector == null || insp === from.inspector);
  const changes = (date, insp) => (to.date != null && to.date !== date) || (to.inspector != null && to.inspector !== insp);
  for (const t of trees) {
    if (canFix(t) && hit(t.date || '', t.inspector || '') && changes(t.date || '', t.inspector || '')) (t.conflict ? out.conflicts : out.trees).push(t);
    // 詳しい診断の記録は木とは別に見る（木と調査日が違う記録もあるため）
    const r = cfg.initialSurvey ? initialOf(state, t, cfg) : null;
    if (!r || !canFix(r)) continue;
    const rd = recordDate(r, cfg, INITIAL);
    const ri = recordInspector(r, cfg, INITIAL);
    const dateHit = to.date != null && from.date != null && rd === from.date && to.date !== rd;
    const inspHit = to.inspector != null && from.inspector != null && inspectorKeyOf(cfg, INITIAL) && ri === from.inspector && to.inspector !== ri;
    if (dateHit || inspHit) (r.conflict ? out.conflicts : out.initials).push(r);
  }
  return out;
}

// 直す。treeIds：直す木の id（実行の時点の最新の状態から対象を選び直す）
//  返す形：{ state, trees（直した本数）, initials（直した記録の数）, conflicts（直せなかった数） }
export function fixDateInspector(state, cfg, treeIds, from, to, now = new Date().toISOString()) {
  if (to.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(to.date)) throw new Error('正しい調査日を選んでください');
  if (to.inspector != null && !String(to.inspector).trim()) throw new Error('調査者を入れてください');
  const ids = new Set(treeIds);
  const tg = fixTargets(state, cfg, state.trees.filter((t) => ids.has(t.id)), from, to);
  if (!tg.trees.length && !tg.initials.length && !tg.conflicts.length) throw new Error('直す木がありません（直す前と同じ値です）');
  const tIds = new Set(tg.trees.map((t) => t.id));
  const iIds = new Set(tg.initials.map((r) => r.id));
  // 詳しい診断の記録は、変える方の値が直す前と同じときだけ変える
  const toFor = (r) => ({
    date: to.date != null && recordDate(r, cfg, INITIAL) === from.date ? to.date : undefined,
    inspector: to.inspector != null && recordInspector(r, cfg, INITIAL) === from.inspector ? to.inspector : undefined,
  });
  const next = {
    ...state,
    trees: state.trees.map((t) => (tIds.has(t.id) ? withFix(t, to, cfg, SIMPLE, now) : t)),
    ...(iIds.size ? { [INITIAL.list]: state[INITIAL.list].map((r) => (iIds.has(r.id) ? withFix(r, toFor(r), cfg, INITIAL, now) : r)) } : {}),
  };
  return { state: next, trees: tIds.size, initials: iIds.size, conflicts: tg.conflicts.length };
}

// ---------- 調査日だけを直す（前からの呼び方） ----------

// 直す対象（調査日が from の木と、調査日が from の詳しい診断の記録）
export const redateTargets = (state, cfg, trees, from) => (from ? fixTargets(state, cfg, trees, { date: from }, { date: `${from}\u0000` }) : { trees: [], initials: [], conflicts: [] });

// 調査日の一覧（その公園・路線の、アプリで入力済みの木と詳しい診断の記録の調査日と本数）。新しい日付が先
export function datesOf(state, cfg, trees) {
  const n = new Map();
  for (const t of trees) {
    if (canFix(t) && t.date) n.set(t.date, (n.get(t.date) || 0) + 1);
    const r = cfg.initialSurvey ? initialOf(state, t, cfg) : null;
    const d = r && canFix(r) ? recordDate(r, cfg, INITIAL) : '';
    if (d && !(canFix(t) && t.date === d)) n.set(d, n.get(d) || 0); // 木と違う日付の記録も選べるように
  }
  return [...n.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({ date, count }));
}

// 調査日だけを直す
export function redate(state, cfg, treeIds, from, to, now = new Date().toISOString()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('正しい調査日を選んでください');
  if (from === to) throw new Error('同じ日付です');
  return fixDateInspector(state, cfg, treeIds, { date: from }, { date: to }, now);
}
