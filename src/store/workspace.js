// 業務ごとの置き場所（この端末の中で、業務ごとに入力内容・設定・台帳などを分けて持つ）
//
//  ・業務の名前は設定ファイルの job.title。名前の違う設定を読み込むとき、新しい業務として始めるか選べる
//  ・新しい業務は空の置き場所から始める。前の業務の入力内容は消さずにそのまま残り、切り替えれば戻れる
//  ・サーバー（GAS）の URL・合言葉も業務ごと（入力内容の状態の中にあるため）
//  ・切り替えは「一覧に印を書く → 画面を読み込み直す」。起動したときに印を読み、その業務の置き場所を使う
//    （動いている間に置き場所を変えない。保存の待ち時間に、前の業務の内容が新しい業務へ書かれないように）
//
// 端末内の形（鍵 'workspaces'。業務を選ばずに置く）
//  { current: 使っている業務の印, list: [{ id: 印（最初の業務は ''）, title: 業務の名前, createdAt }] }

import { idbGetRaw, idbPutRaw, setWorkspaceId, wsKey } from './idb.js';

const META = 'workspaces';

function normalize(m) {
  const list = Array.isArray(m?.list) ? m.list.filter((w) => w && typeof w.id === 'string') : [];
  if (!list.some((w) => w.id === '')) list.unshift({ id: '', title: '', createdAt: '' });
  const current = list.some((w) => w.id === m?.current) ? m.current : '';
  return { current, list };
}

export async function loadWorkspaces() {
  return normalize(await idbGetRaw(META));
}

// 起動したときに1回：使う業務を決める（以後の読み書きはその業務の置き場所）
export async function openCurrentWorkspace() {
  const m = await loadWorkspaces();
  setWorkspaceId(m.current);
  return m;
}

// 今の業務の名前を覚える（設定を読み込んだとき。一覧に出す名前）
export async function rememberTitle(title) {
  const m = await loadWorkspaces();
  const w = m.list.find((x) => x.id === m.current);
  if (!w || w.title === (title || '')) return;
  w.title = title || '';
  await idbPutRaw(META, m);
}

// 名前の違う設定を読み込むときに、新しい業務として始める必要があるか
//  今の業務に木か設定があり、名前が違うときだけ聞く（何も入っていなければ、そのまま今の業務に読み込む）
export function needsNewWorkspace(state, current, next) {
  const hasData = (state?.trees?.length || 0) > 0;
  if (!current || !hasData) return false;
  return (current.job?.title || '') !== (next.job?.title || '');
}

// 設定を、別の業務の置き場所で使う（同じ名前の業務があればそこへ、なければ新しく作る）。
//  この後に画面を読み込み直すと、その業務で始まる。前の業務の置き場所には何も書かない
// 返す形：{ id, created（新しく作った）}
export async function putConfigInWorkspace(config, now = Date.now()) {
  const m = await loadWorkspaces();
  const title = config.job?.title || '';
  let w = m.list.find((x) => x.id !== m.current && x.title === title);
  const created = !w;
  if (!w) {
    let id = `w${Number(now).toString(36)}`;
    while (m.list.some((x) => x.id === id)) id += 'x';
    w = { id, title, createdAt: new Date(now).toISOString() };
    m.list.push(w);
  }
  await idbPutRaw(wsKey(w.id, 'config'), config);
  m.current = w.id;
  await idbPutRaw(META, m);
  return { id: w.id, created };
}

// 業務を切り替える（この後に画面を読み込み直す）
export async function switchWorkspace(id) {
  const m = await loadWorkspaces();
  if (!m.list.some((w) => w.id === id)) throw new Error('その業務はこの端末にありません');
  m.current = id;
  await idbPutRaw(META, m);
}
