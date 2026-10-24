// 表記の統一（例：「枯枝」→「枯れ枝」、「～有り」→「～あり」）
//
// 書き方の決まりは設定 wording に置く（業務ごとに違うため）。
//  wording：[{ from: "正規表現", to: "置き換える文字（$1 などで、かっこで囲んだ所を使える）", label: "画面に出す説明" }]
//  上から順に当てはめる（前の置き換えの結果に、次の決まりを当てる）
// ここにあるのは「調べる・直す」仕組みだけ。直すのは人がボタンを押したときだけ（勝手には直さない）。
//
// 正規表現の「後ろ読み（(?<=…)・(?<!…)）」は古いスマホで読めず、設定ごと使えなくなるので使わない（検証で断る）。

const rulesOf = (cfg) => (Array.isArray(cfg?.wording) ? cfg.wording : []);

// 1つの文に当てはまる決まり（説明の一覧）。返す形：[label]
export function wordingIssues(text, cfg) {
  let s = String(text ?? '');
  const out = [];
  for (const w of rulesOf(cfg)) {
    const re = new RegExp(w.from, 'g');
    if (!re.test(s)) continue;
    out.push(w.label || `${w.from}→${w.to}`);
    s = s.replace(new RegExp(w.from, 'g'), w.to);
  }
  return out;
}

// 決まりどおりに直した文
export function fixWording(text, cfg) {
  let s = String(text ?? '');
  for (const w of rulesOf(cfg)) s = s.replace(new RegExp(w.from, 'g'), w.to);
  return s;
}

// 設定を確かめる（config.js から呼ぶ）。need(条件, 誤りの文)
export function validateWording(list, need) {
  if (!need(Array.isArray(list), 'wording は並び（[…]）にしてください')) return;
  list.forEach((w, i) => {
    const at = `wording[${i}]`;
    if (!need(w && typeof w === 'object' && typeof w.from === 'string' && w.from && typeof w.to === 'string', `${at} は { from: "正規表現", to: "置き換える文字", label? } の形にしてください`)) return;
    need(w.label == null || typeof w.label === 'string', `${at}.label は文字にしてください`);
    need(!/\(\?<[=!]/.test(w.from), `${at}.from に後ろ読み（(?<=…)・(?<!…)）は使えません（古いスマホで読めないため）`);
    try {
      new RegExp(w.from, 'g');
    } catch {
      need(false, `${at}.from が正規表現として読めません`);
    }
  });
}
