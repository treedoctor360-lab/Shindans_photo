// 特記事項（野帳用・一覧表用）の組み立て
//
// 野帳用：1行1項目。行頭に「・」。定型文ボタンの文と自由記述（寸法など）が混在する。
// 一覧表用：押された定型文だけから自動で作る。
//   kind "s"（文）… そのまま1行
//   kind "n"（名詞）… まとめて「A、Bあり。」の形（区切り・末尾は設定で変更可）

const BULLET = /^[・･\-\s]+/;

// 特記事項の各行（行頭の「・」を外したもの）
export const noteLines = (s) =>
  String(s || '')
    .split('\n')
    .map((x) => x.replace(BULLET, '').trim())
    .filter(Boolean);

// 行を追加・削除する（既にあれば削除、なければ「・」を付けて末尾に追加）
export function toggleNote(str, item) {
  const lines = String(str || '').split('\n').filter((x) => x.trim());
  const i = lines.findIndex((x) => x.replace(BULLET, '').trim() === item);
  if (i >= 0) lines.splice(i, 1);
  else lines.push('・' + item);
  return lines.join('\n');
}

// 行がその定型文のものか（今の文 t か、前の文 was のどれか。定型文の文を変えても、前に入れた行を同じ定型文として扱う）
export const isChipLine = (chip, line) => chip.t === line || (chip.was || []).includes(line);
// 行の定型文（なければ undefined）
export const chipOfLine = (line, cfg) => cfg.noteChips.find((c) => isChipLine(c, line));

// 押されている定型文（設定の noteChips のうち、特記に行があるもの）
export const chipsIn = (notes, cfg) => {
  const lines = noteLines(notes);
  return cfg.noteChips.filter((c) => lines.some((l) => isChipLine(c, l)));
};

// 定型文のボタンを押したとき：その定型文の行（前の文の行も）があれば消し、なければ今の文を足す
export function toggleChip(str, chip) {
  const lines = String(str || '').split('\n').filter((x) => x.trim());
  const kept = lines.filter((x) => !isChipLine(chip, x.replace(BULLET, '').trim()));
  if (kept.length < lines.length) return kept.join('\n');
  return [...lines, '・' + chip.t].join('\n');
}

// 定型文にない行（寸法などの自由記述）
export const freeNoteLines = (notes, cfg) => noteLines(notes).filter((l) => !chipOfLine(l, cfg));

// 一覧表用の特記事項を、押した定型文から作る
export function autoDbNote(notes, cfg) {
  const fmt = cfg.dbNote;
  const sentences = [];
  const nouns = [];
  // 行の順（入力した順）を保つため、定型文の並びではなく特記の行の並びで回す
  for (const line of noteLines(notes)) {
    const c = chipOfLine(line, cfg);
    if (!c) continue;
    const text = c.db || c.t;
    const list = c.kind === 's' ? sentences : nouns;
    if (!list.includes(text)) list.push(text);
  }
  const nounLine = nouns.length ? nouns.join(fmt.nounJoin) + fmt.nounSuffix : '';
  return [...sentences, nounLine].filter(Boolean).join('\n');
}

// 一覧表用の特記事項（手で直していれば、その文を優先する）
export const dbNoteOf = (tree, cfg) => (tree.dbNoteManual ? tree.dbNote || '' : autoDbNote(tree.notes, cfg));
