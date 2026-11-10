// デスクトップ表示の一覧表（1本1行）に出す中身を作る
//  ・判定は今の注意（簡易診断の未記入・詳しい診断の注意・付箋）と同じ関数を使い、ここで新しい判定は作らない
import { initialOf, initialWarnings, isInitialTarget, measureStatus, simpleNotesStatus, syncMeasures } from '../store/initial.js';
import { reviewStatesOf } from '../store/review.js';
import { missingFields } from '../core/rules.js';

// 点検項目のうち「有」のもの（程度や本数・種名を添える）と、まだ選んでいない項目の番号
//  返す形：{ yes: ['③枯れ枝(有)(2)'…], blank: ['⑥'…] }。どちらも空なら、すべて「無」を選んだ木
export function checksOf(tree, cfg) {
  const yes = [];
  const blank = [];
  for (const c of cfg.checks || []) {
    const v = String(tree[c.key] ?? '').trim();
    const no = c.label.match(/^[①-⑳]/)?.[0] || c.label;
    if (!v) {
      blank.push(no);
      continue;
    }
    if (v === '無') continue;
    const d = (cfg.details || []).find((x) => x.when?.field === c.key && String(tree[x.field] ?? '').trim());
    yes.push(`${c.label}${v !== '有' ? `(${v})` : ''}${d ? `(${tree[d.field]})` : ''}`);
  }
  return { yes, blank };
}

// 注意の印。返す形：[[印, 理由]…]
export function flagsOf(tree, state, cfg) {
  const out = [];
  if (tree.done && missingFields(tree, cfg).length) out.push(['未記入', `簡易で入れていない項目：${missingFields(tree, cfg).join('・')}`]);
  // 詳しい診断の対象でなくなった木（「要」を後で「否」にした）に残っている記録は見ない（ブック・カルテにも書かない）
  const rec0 = isInitialTarget(tree, cfg) ? initialOf(state, tree, cfg) : null;
  if (rec0) {
    const rec = syncMeasures(rec0, tree, cfg).record; // 画面を開いたときと同じく、簡易の寸法に合わせた後の状態で見る
    const ws = (initialWarnings(rec, tree, cfg) || []).map(String);
    const notReflected = simpleNotesStatus(rec, tree, cfg).filter((x) => x.state === 'missing').length + ws.filter((w) => w.startsWith('簡易診断で')).length;
    if (notReflected) out.push([`未反映${notReflected}`, '簡易の特記事項・「有」が詳しい診断にない']);
    if (ws.some((w) => w.includes('芯達か芯未達か'))) out.push(['芯達未選択', '芯達か芯未達かを選んでいない箇所がある']);
    if (measureStatus(rec, tree, cfg).some((s) => !s.follow && s.differs)) out.push(['簡易と違う', '詳しい診断を手で直していて、簡易の寸法と違う']);
    if (ws.some((w) => w.includes('詳細が入っていますが'))) out.push(['有無の食い違い', '詳細があるのに有無が「無」か未選択']);
    if (!rec.done) out.push(['初期未完了', '詳しい診断が下書きのまま']);
  }
  const rs = reviewStatesOf(tree, state, cfg);
  if (rs.includes('conflict')) out.push(['食い違い', '2台で直した内容が食い違っている（どちらを使うか選ぶ）']);
  if (rs.includes('asked')) out.push(['付箋', '返事待ちの付箋がある']);
  else if (rs.includes('answered')) out.push(['付箋回答済み', '付箋に返事があり、事務の確認待ち']);
  return out;
}
