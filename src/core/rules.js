// 判定支援：入力漏れの一覧と、注意・提案の一覧を作る
// 判定の基準（しきい値・菌の名前・文言など）はすべて設定ファイル（cfg.rules）に書く。
// ここにあるのは「規則の種類ごとの動かし方」だけ。最終判断は人が行う（警告・提案のみ）。

import { girthOf, heightRatioOf, branchRatioRaw } from './calc.js';
import { chipOfLine, noteLines, toggleNote } from './notes.js';
import { fixWording, wordingIssues } from './wording.js';
import { photoPlan } from './photo.js';
import { fill, monthDay, num, toHalf } from './text.js';
import { composeTreat } from './treat.js';
import { isDead, isLocked, matches } from './tree.js';

// ---------- 入力漏れ ----------
export function missingFields(tree, cfg) {
  const m = [];
  if (!toHalf(tree.treeNo).trim()) m.push('樹木番号');
  if (!tree.species) m.push('樹種');
  if (!num(tree.height)) m.push('樹高');
  if (!girthOf(tree, cfg)) m.push('幹周');
  if (!tree.vigor) m.push(cfg.vigorLabel);
  if (!isLocked(tree, cfg)) cfg.checks.forEach((c) => !tree[c.key] && m.push(c.label));
  cfg.details.forEach((d) => {
    if (d.required && matches(tree, d.when, cfg) && !String(tree[d.field] ?? '').trim()) m.push(d.label);
  });
  if (!tree.initialNeeded) m.push(cfg.initial.label);
  if (tree.initialNeeded === cfg.initial.no && !tree.grade) m.push(cfg.gradeLabel);
  const treat = composeTreat(tree, cfg);
  cfg.rules
    .filter((r) => r.type === 'treatRequires' && new RegExp(r.pattern).test(treat) && !tree[r.field])
    .forEach((r) => m.push(r.label));
  return m;
}

// ---------- 規則の種類ごとの判定 ----------
// それぞれ「当てはまれば文の穴埋めに使う値（vars）」、当てはまらなければ null を返す
const CHECKERS = {
  // 樹木番号の形式
  treeNoPattern: (t, r) => (t.treeNo && !new RegExp(r.pattern).test(toHalf(t.treeNo)) ? {} : null),

  // 木の状態（例：番号札のない木）に応じたお知らせ
  statusNotice: (t, r) => (t.status === r.status ? {} : null),

  // 樹種の注意（pattern に当てはまり、unless に当てはまらない）
  speciesNotice: (t, r) =>
    t.species && new RegExp(r.pattern).test(t.species) && !(r.unless && new RegExp(r.unless).test(t.species))
      ? { species: t.species }
      : null,

  // 比率がしきい値以上（例：樹高/幹径・枝長/枝径）。処置に unlessTreat が入っていれば出さない
  ratioAtLeast: (t, r, cfg) => {
    if (r.unlessTreat && (t.treatSel || []).includes(r.unlessTreat)) return null;
    const reasons = r.items
      .map((it) => {
        const v = it.ratio === 'height' ? heightRatioOf(t, cfg) : isDead(t, cfg) ? null : branchRatioRaw(t);
        return v != null && v >= it.threshold ? `${it.label} ${Math.round(v)}倍` : null;
      })
      .filter(Boolean);
    return reasons.length ? { reasons: reasons.join('、') } : null;
  },

  // ある項目の文字に、指定の語のどれかが含まれる（例：子実体の種名）
  contains: (t, r, cfg) => {
    if (r.when && !matches(t, r.when, cfg)) return null;
    const v = String(t[r.field] || '');
    return r.anyOf.some((w) => v.includes(w)) ? { value: v } : null;
  },

  // when の状態なのに、hits のどれかが当てはまる（例：弱点があるのに初期診断不要）
  conflict: (t, r, cfg) => {
    if (!matches(t, r.when, cfg)) return null;
    const hits = r.hits.filter((h) => matches(t, h, cfg)).map((h) => h.label);
    return hits.length ? { hits: hits.join('・') } : null;
  },

  // 特記にある行があるのに、対応する処置が入っていない
  noteSuggestsTreat: (t, r, cfg) =>
    noteLines(t.notes).some((l) => l === r.note || chipOfLine(l, cfg)?.t === r.note) && !(t.treatSel || []).includes(r.treat) ? {} : null,

  // 処置に書かない語
  treatForbidden: (t, r, cfg) => (new RegExp(r.pattern).test(composeTreat(t, cfg)) ? {} : null),

  // 処置にある語が入ったら、別の項目の入力が必要
  treatRequires: (t, r, cfg) => (new RegExp(r.pattern).test(composeTreat(t, cfg)) && !t[r.field] ? {} : null),

  // 健全度が指定の値なのに処置が空欄
  gradeNeedsTreat: (t, r, cfg) => (r.grades.includes(t.grade) && !composeTreat(t, cfg) ? { grade: t.grade } : null),

  // 弱点写真の枚数が上限を超えた
  photoOver: (t, r, cfg) => (photoPlan(t, cfg).over ? { max: cfg.photo.maxWeak } : null),
};

export const RULE_TYPES = Object.keys(CHECKERS);

// ---------- 注意・提案の一覧 ----------
// 返す形：[{ id, lv: 'info'|'warn'|'danger', msg, acts: [{ type, value, label, dismiss }] }]
export function alertsOf(tree, cfg) {
  const a = [];

  // 業務によらない、アプリとしてのお知らせ
  if (tree.planInitial) a.push({ id: 'planInitial', lv: 'info', msg: '事前に初期診断の対象として予定されている木です。', acts: [] });
  if (tree.source === 'ledger')
    a.push({
      id: 'ledgerDone',
      lv: 'info',
      msg: `この木は台帳ですでに調査済みです（${monthDay(tree.ledgerDate)} ${tree.ledgerInspector || ''}）。表示しているのは台帳の値で、ここでは変更できません。もう一度調べ直すときだけ、下のボタンを押してください。`,
      acts: [{ type: 'resurvey', label: '調べ直す（再調査として入力する）' }],
    });
  if (tree.ledgerDuplicate)
    a.push({
      id: 'ledgerDuplicate',
      lv: 'warn',
      msg: `台帳に同じ番号の行が${tree.ledgerDuplicate}行あります（この木は${tree.dupIndex || 1}行目）。現地の番号札と、場所・樹種が台帳と合っているか確認してください。`,
      acts: [],
    });
  if (tree.appBackup)
    a.push({
      id: 'appBackup',
      lv: 'warn',
      msg: `この木は${monthDay(tree.appBackup.date)}にアプリでも入力しましたが、後から読み込んだ台帳にも調査結果が入っていました。いまは台帳の方を表示しています。アプリで入力した内容は消さずに取ってあります。`,
      acts: [{ type: 'useApp', label: 'アプリで入力した内容を使う' }],
    });
  if (isLocked(tree, cfg))
    a.push({
      id: 'locked',
      lv: 'info',
      msg: '枯死のため、点検項目は原則空欄です。緊急対応が必要な弱点だけ入力できます。',
      acts: [{ type: 'deadOverride', label: '緊急の弱点を入力する' }],
    });

  // 表記の統一（設定 wording）。定型文のボタンの行は対象外（ボタンの文は設定で決まっているため）
  const wIssues = wordingOfTree(tree, cfg);
  if (wIssues.length)
    a.push({
      id: 'wording',
      lv: 'warn',
      msg: `表記の統一：${wIssues.join('・')}`,
      acts: [{ type: 'fixWording', label: '表記を直す' }],
    });

  // 設定ファイルの規則
  for (const r of cfg.rules) {
    if ((tree.dismissed || []).includes(r.id)) continue;
    const vars = CHECKERS[r.type](tree, r, cfg);
    if (vars) a.push({ id: r.id, lv: r.level, msg: fill(r.message, vars), acts: r.actions || [] });
  }
  return a;
}

// 表記の統一を調べる文：特記事項のうち定型文でない行・処置（追記）・伐採理由・手で直した一覧表用の特記
function wordingTexts(tree, cfg) {
  return [
    ...noteLines(tree.notes).filter((l) => !chipOfLine(l, cfg)),
    tree.treatFree,
    tree.fellingReason,
    ...(tree.dbNoteManual ? [tree.dbNote] : []),
  ];
}
export function wordingOfTree(tree, cfg) {
  if (!cfg.wording?.length || tree.source === 'ledger') return [];
  return [...new Set(wordingTexts(tree, cfg).flatMap((x) => wordingIssues(x, cfg)))];
}

// 表記を直した木（定型文の行はそのまま。寸法の1行を直したら、その元の数字の記録の1行も合わせる）
function fixWordingOfTree(t, cfg) {
  const fixLine = (raw) => {
    const body = raw.replace(/^[・･\-\s]+/, '').trim();
    if (!body || chipOfLine(body, cfg)) return raw;
    return raw.replace(body, fixWording(body, cfg));
  };
  const next = { ...t, notes: String(t.notes || '').split('\n').map(fixLine).join('\n') };
  for (const k of ['treatFree', 'fellingReason']) if (t[k]) next[k] = fixWording(t[k], cfg);
  if (t.dbNoteManual && t.dbNote) next.dbNote = fixWording(t.dbNote, cfg);
  if (Array.isArray(t.measures)) next.measures = t.measures.map((m) => (m?.line ? { ...m, line: fixWording(m.line, cfg) } : m));
  return next;
}

// ---------- 提案ボタンを押したときの変更 ----------
// 元の tree は書き換えず、新しい tree を返す
export function applyAction(tree, act, ruleId, cfg) {
  let t = { ...tree, treatSel: [...(tree.treatSel || [])], dismissed: [...(tree.dismissed || [])] };
  if (act.type === 'addTreat') {
    const known = [...cfg.treat.prune, ...cfg.treat.other].includes(act.value);
    if (known) {
      if (!t.treatSel.includes(act.value)) t.treatSel.push(act.value);
    } else if (!String(t.treatFree || '').includes(act.value)) {
      t.treatFree = [t.treatFree, act.value].filter(Boolean).join(cfg.treat.join);
    }
  }
  if (act.type === 'addNote' && !noteLines(t.notes).includes(act.value)) t.notes = toggleNote(t.notes, act.value);
  if (act.type === 'deadOverride') t.deadOverride = true;
  if (act.type === 'fixWording') t = fixWordingOfTree(t, cfg);
  if (act.dismiss && ruleId && !t.dismissed.includes(ruleId)) t.dismissed.push(ruleId);
  return t;
}
