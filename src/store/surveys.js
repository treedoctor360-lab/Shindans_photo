// 記録の種類の一覧（調査の種類ごとの「入力内容」の記録）
//
// 送受信（sync.js）と確認の流れ（review.js）は、この一覧を順に回して動く。
// 新しい調査の種類を足すときは、ここに1件足す（送受信・付箋・確定の仕組みはそのまま使える）。
//
// 1件の形：
//  id     … 調査の種類の名前（プログラムの中で使う）
//  kind   … 送受信するときの記録の種類。サーバー（gas/Code.js）の KINDS にも同じ名前が必要
//  list   … 端末の状態の中の置き場所（state[list] が記録の配列）
//  keyOf  … 記録の鍵（端末とサーバーで共通。付箋・確定の印もこの鍵で記録に結び付く）
//  place  … 受け取った記録が端末になかったとき、配列のどこに入れるか（省略すると最後）

import { groupKey } from '../core/groups.js';
import { toHalf } from '../core/text.js';

// 簡易診断の木の鍵（年度・シートの種類・番号・何本目）
//  一覧にない木を追加したときは、番号の代わりに追加したときの印（uid）で見分ける。
//  番号のない木が何本あってもぶつからず、送信の後で番号を書き換えても同じ木のまま。
export const simpleKey = (t, cfg) =>
  [cfg.job.year, t.siteType || '', t.uid ? `+${t.uid}` : toHalf(t.treeNo).trim(), t.dupIndex || 1].join('|');

// 同じまとまり（公園・路線）の最後の後ろ。まとまりがなければ配列の最後
function afterSameGroup(list, rec, cfg) {
  const g = groupKey(rec, cfg);
  for (let j = list.length - 1; j >= 0; j--) if (groupKey(list[j], cfg) === g) return j + 1;
  return list.length;
}

export const SIMPLE = { id: 'simple', kind: 'tree', list: 'trees', keyOf: simpleKey, place: afterSameGroup };

// 詳しい診断（初期診断など）の記録の鍵：簡易診断の木の鍵の前に「initial|」を付ける
//  記録には、元の木を見分ける項目（シートの種類・番号・何本目・uid）を写して持つので、同じ作り方で鍵ができる
export const initialKey = (r, cfg) => `initial|${simpleKey(r, cfg)}`;
export const INITIAL = { id: 'initial', kind: 'initial', list: 'initials', keyOf: initialKey };

export const SURVEYS = [SIMPLE, INITIAL];

// 記録の種類の名前から調べる（無ければ null）
export const surveyOfKind = (kind) => SURVEYS.find((s) => s.kind === kind) || null;

// 端末の状態から、その種類の記録の配列を取り出す（まだ無ければ空）
export const recordsOf = (state, survey) => state[survey.list] || [];

// 鍵から記録を探す（付箋・確定の印から記録をたどるとき）。返す形：{ survey, record } または null
export function findByKey(state, key, cfg) {
  for (const survey of SURVEYS) {
    const record = recordsOf(state, survey).find((r) => survey.keyOf(r, cfg) === key);
    if (record) return { survey, record };
  }
  return null;
}

// その種類の記録を1件変える（元の状態は書き換えず、新しい状態を返す）
export const updateRecord = (state, survey, id, fn) => ({
  ...state,
  [survey.list]: recordsOf(state, survey).map((r) => (r.id === id ? fn(r) : r)),
});
