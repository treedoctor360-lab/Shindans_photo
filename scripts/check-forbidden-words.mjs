// 公開前チェック：リポジトリに上げるファイルに、業務固有の語（自治体名・地名・樹木番号など）が
// 含まれていないかを調べる。禁止語のリスト自体は公開できないので、次のどちらかで渡す。
//   ・手元：リポジトリ直下の .forbidden-words.txt（.gitignore 済み。1行に1語、# から始まる行は無視）
//   ・GitHub Actions：シークレット FORBIDDEN_WORDS（1行に1語）
// 見つかったら終了コード1で止まる（＝コミット・公開を止める）。
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// 禁止語リストの文字列 → 語の配列
export function parseWords(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

// 1つのファイルの中身から、含まれている禁止語を探す
export function findWords(content, words) {
  return words.filter((w) => content.includes(w));
}

function main() {
  const fromFile = existsSync('.forbidden-words.txt') ? readFileSync('.forbidden-words.txt', 'utf8') : '';
  const words = parseWords(process.env.FORBIDDEN_WORDS || fromFile);
  if (!words.length) {
    // GitHub Actions（CI）ではリスト未登録を失敗にする。チェックが黙って省略されるのを防ぐため
    if (process.env.CI) {
      console.error('禁止語リスト（シークレット FORBIDDEN_WORDS）が登録されていません。');
      process.exit(1);
    }
    console.warn('禁止語リストがありません（.forbidden-words.txt か FORBIDDEN_WORDS）。チェックを省略します。');
    return;
  }
  // 追跡中＋追加予定のファイル（.gitignore で除外したものは対象外）
  const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('node_modules/'));
  const hits = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const found = findWords(text, words);
    if (found.length) hits.push(`${f}: ${found.length}語`);
  }
  if (hits.length) {
    // 禁止語そのものはログに出さない（ログも公開されるため）
    console.error('公開できない語が含まれています：\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log(`禁止語チェックOK（${files.length}ファイル・${words.length}語）`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
