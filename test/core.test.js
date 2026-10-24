// 計算・文の組み立て・判定支援のテスト（架空の設定 test/fixtures/sample-config.json を使う）
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { branchRatioCell, branchRatioText, girthOf, heightRatioOf } from '../src/core/calc.js';
import { chooseConfig, validateConfig } from '../src/core/config.js';
import { autoDbNote, dbNoteOf, freeNoteLines, noteLines, toggleNote } from '../src/core/notes.js';
import { photoFlag, photoPlan } from '../src/core/photo.js';
import { alertsOf, applyAction, missingFields } from '../src/core/rules.js';
import { normalizeSpecies } from '../src/core/species.js';
import { fill, num, toHalf } from '../src/core/text.js';
import { composeTreat } from '../src/core/treat.js';
import { blankTree } from '../src/core/tree.js';

const cfg = structuredClone(cfgJson);
const T = (o = {}) => blankTree({ treeNo: 'AB123', species: 'テストノキ', ...o });
const ids = (t) => alertsOf(t, cfg).map((a) => a.id);

describe('文字の整形', () => {
  it('全角を半角にする', () => expect(toHalf('ＡＢ１２３（Ｘ）．　')).toBe('AB123(X). '));
  it('数として読む（0・空欄・文字は null）', () => {
    expect(num('１２.５')).toBe(12.5);
    expect([num(''), num('0'), num('abc'), num(null)]).toEqual([null, null, null, null]);
  });
  it('穴埋め（無い名前はそのまま残す）', () => expect(fill('{a}と{b}', { a: 1 })).toBe('1と{b}'));
});

describe('計算', () => {
  it('単幹の幹周は入力値のまま', () => expect(girthOf(T({ girths: ['1.23'] }), cfg)).toBe(1.23));
  it('株立の幹周は (和)×係数、小数第2位で丸め', () => {
    // (0.7+0.61)×0.8 = 1.048 → 1.05
    expect(girthOf(T({ girths: ['0.7', '0.61', ''] }), cfg)).toBe(1.05);
  });
  it('幹周が無ければ null', () => expect(girthOf(T({ girths: ['', ''] }), cfg)).toBeNull());
  it('樹高/幹径は 樹高÷(幹周÷3.14) を整数に丸める', () => {
    // 10 / (0.5/3.14) = 62.8 → 63
    expect(heightRatioOf(T({ height: '10', girths: ['0.5'] }), cfg)).toBe(63);
    expect(heightRatioOf(T({ height: '', girths: ['0.5'] }), cfg)).toBeNull();
  });
  it('枝長/枝径：上限未満は丸めない数値、上限以上は表記、枯死は「-」', () => {
    expect(branchRatioCell(T({ branchLen: '200', branchDia: '7' }), cfg)).toBeCloseTo(28.5714, 3);
    expect(branchRatioText(T({ branchLen: '200', branchDia: '7' }), cfg)).toBe('28.57');
    expect(branchRatioCell(T({ branchLen: '300', branchDia: '10' }), cfg)).toBe('30倍以上'); // ちょうど上限
    expect(branchRatioCell(T({ branchLen: '300', branchDia: '10', vigor: '枯' }), cfg)).toBe('-');
    expect(branchRatioCell(T(), cfg)).toBe('');
  });
});

describe('特記事項', () => {
  it('行の追加と削除（「・」付き）', () => {
    const a = toggleNote('', '枝の偏り');
    expect(a).toBe('・枝の偏り');
    expect(toggleNote(a + '\n・幹に割れ 30cm', '枝の偏り')).toBe('・幹に割れ 30cm');
    expect(noteLines('・A\n･B\n- C\n\n')).toEqual(['A', 'B', 'C']);
  });
  it('一覧表用：文はそのまま、名詞は「、」でまとめて「あり。」、自由記述は入れない', () => {
    const notes = ['・枝の偏り', '・支柱が不要', '・根元の割れ 幅2cm', '・根元の割れ', '・枝が道にはみ出す'].join('\n');
    expect(autoDbNote(notes, cfg)).toBe('支柱は不要。\n枝の偏り、根元の割れ、はみ出し枝あり。');
    expect(freeNoteLines(notes, cfg)).toEqual(['根元の割れ 幅2cm']);
  });
  it('同じ言い回しになる定型文は1回だけ', () => {
    expect(autoDbNote('・つる巻き付き(切れる)\n・つる巻き付き(切れない)', cfg)).toBe('つる巻き付きあり。');
  });
  it('手で直した一覧表用の文があれば、それを使う', () => {
    expect(dbNoteOf(T({ notes: '・枝の偏り', dbNote: '手で直した文', dbNoteManual: true }), cfg)).toBe('手で直した文');
    expect(dbNoteOf(T({ notes: '・枝の偏り', dbNote: '古い文' }), cfg)).toBe('枝の偏りあり。');
  });
});

describe('処置', () => {
  it('剪定の種類は設定の順にまとめて「剪定」を付ける', () => {
    expect(composeTreat(T({ treatSel: ['はみ出し枝', '支柱撤去', '枯れ枝'] }), cfg)).toBe('枯れ枝・はみ出し枝剪定・支柱撤去');
  });
  it('自由記述は半角にして末尾に付ける', () => {
    expect(composeTreat(T({ treatSel: ['伐採'], treatFree: 'ＸＹ処理 ' }), cfg)).toBe('伐採・XY処理');
    expect(composeTreat(T(), cfg)).toBe('');
  });
});

describe('写真の判定', () => {
  it('樹勢が未入力なら判定しない', () => expect(photoPlan(T(), cfg).mode).toBe('pending'));
  it('弱点なし → 写真不要・写真の有無は「無」', () => {
    const t = T({ vigor: '良', lean: '無', deadBranch: '少' });
    expect(photoPlan(t, cfg).mode).toBe('none');
    expect(photoFlag(t, cfg)).toBe('無');
  });
  it('全景で分かる弱点 → 全景と共用（写真名に付ける）', () => {
    const p = photoPlan(T({ vigor: '良', lean: '有' }), cfg);
    expect(p.mode).toBe('shared');
    expect(p.slots.map((s) => s.name)).toEqual(['全景・傾斜']);
  });
  it('写真で分からない弱点だけ → 全景のみ・写真の有無は「無」', () => {
    const t = T({ vigor: '良', notes: '・叩くと音が変' });
    expect(photoPlan(t, cfg).mode).toBe('fullOnly');
    expect(photoFlag(t, cfg)).toBe('無');
  });
  it('弱点写真が要る → 全景＋弱点（項目と定型文から）', () => {
    const p = photoPlan(T({ vigor: '良', deadBranch: '有', notes: '・根元の割れ\n・枝の偏り' }), cfg);
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '枯れ枝', '根元の割れ']);
    expect(p.over).toBe(false);
  });
  it('枯死の木は点検項目・定型文を写真の判定に使わない', () => {
    const p = photoPlan(T({ vigor: '枯', deadBranch: '有', notes: '・根元の割れ' }), cfg);
    expect(p.slots.map((s) => s.name)).toEqual(['全景・枯死']);
  });
  it('手で変えた写真の有無を優先する', () => expect(photoFlag(T({ vigor: '良', photoOverride: '有' }), cfg)).toBe('有'));
});

describe('入力漏れ', () => {
  const full = { height: '8', girths: ['0.5'], vigor: '良', lean: '無', deadBranch: '無', decay: '無', fungus: '無', initialNeeded: '否', grade: 'A' };
  it('全部入っていれば空', () => expect(missingFields(T(full), cfg)).toEqual([]));
  it('足りない項目を挙げる', () => {
    expect(missingFields(blankTree(), cfg)).toEqual(['樹木番号', '樹種', '樹高', '幹周', '樹勢', '傾斜', '枯れ枝', '腐朽', 'キノコ', '詳しい診断の必要性']);
  });
  it('枯れ枝「有」なら本数が必要。詳しい診断「否」なら健全度が必要', () => {
    expect(missingFields(T({ ...full, deadBranch: '有', grade: '' }), cfg)).toEqual(['枯れ枝の本数', '健全度']);
  });
  it('枯死の木は点検項目を求めない', () => {
    expect(missingFields(T({ ...full, vigor: '枯', lean: '', decay: '' }), cfg)).toEqual([]);
  });
  it('処置が伐採なら伐採理由が必要', () => {
    expect(missingFields(T({ ...full, treatSel: ['伐採'] }), cfg)).toEqual(['伐採理由']);
  });
});

describe('注意・提案', () => {
  it('番号の形・札なし・樹種の注意', () => {
    expect(ids(T({ treeNo: 'ab1234', status: '札なし', species: 'ナゾノカエデ' }))).toEqual(['treeNo', 'noTag', 'maple']);
    expect(ids(T({ treeNo: 'ＡＢ１２３', species: 'ミホンカエデ' }))).toEqual([]); // 全角でも半角にして判定
  });
  it('比率の超過：理由を並べ、処置に縮小が入れば消える', () => {
    const t = T({ height: '10', girths: ['0.5'], branchLen: '400', branchDia: '10' });
    const a = alertsOf(t, cfg).find((x) => x.id === 'ratio');
    expect(a.msg).toBe('樹高/幹径 63倍、枝長/枝径 40倍。縮小剪定を検討してください。');
    expect(ids({ ...t, treatSel: ['縮小'] })).not.toContain('ratio');
  });
  it('枯死の木は枝長/枝径の超過を出さない', () => {
    expect(ids(T({ vigor: '枯', branchLen: '400', branchDia: '10' }))).not.toContain('ratio');
  });
  it('「剪定不要」を押すと特記に入り、提案は出なくなる', () => {
    const t = T({ height: '10', girths: ['0.5'] });
    const act = cfg.rules.find((r) => r.id === 'ratio').actions[1];
    const t2 = applyAction(t, act, 'ratio', cfg);
    expect(noteLines(t2.notes)).toEqual(['比率超過だが剪定不要']);
    expect(ids(t2)).not.toContain('ratio');
    expect(t.notes).toBe(''); // 元のデータは変えない
  });
  it('「縮小剪定を入れる」を押すと処置に入る（2回押しても1つ）', () => {
    const act = cfg.rules.find((r) => r.id === 'ratio').actions[0];
    const t = applyAction(applyAction(T(), act, 'ratio', cfg), act, 'ratio', cfg);
    expect(t.treatSel).toEqual(['縮小']);
  });
  it('強い菌：キノコ「有」のときだけ', () => {
    expect(ids(T({ fungus: '有', fungusName: 'ツヨイタケ' }))).toContain('strongFungus');
    expect(ids(T({ fungus: '無', fungusName: 'ツヨイタケ' }))).not.toContain('strongFungus');
  });
  it('弱点があるのに詳しい診断「否」', () => {
    const a = alertsOf(T({ initialNeeded: '否', fungus: '有', decay: '有' }), cfg).find((x) => x.id === 'initialConflict');
    expect(a.msg).toBe('キノコあり・腐朽ありですが、詳しい診断が「否」です。');
    // 枯死の木は点検項目を見ないので出さない
    expect(ids(T({ vigor: '枯', initialNeeded: '否', fungus: '有' }))).not.toContain('initialConflict');
  });
  it('枯死の木には「緊急の弱点を入力する」を出し、押すと点検項目を入力できる', () => {
    const t = T({ vigor: '枯' });
    expect(ids(t)).toContain('locked');
    const t2 = applyAction(t, { type: 'deadOverride' }, null, cfg);
    expect(ids(t2)).not.toContain('locked');
  });
  it('特記からの処置の提案・書かない処置・伐採理由・健全度と処置', () => {
    expect(ids(T({ notes: '・つる巻き付き(切れる)' }))).toContain('vineCut');
    expect(ids(T({ notes: '・つる巻き付き(切れる)', treatSel: ['つる除去'] }))).not.toContain('vineCut');
    expect(ids(T({ treatFree: '水やり' }))).toContain('noWater');
    expect(ids(T({ treatSel: ['伐採'] }))).toContain('fellReason');
    expect(ids(T({ treatSel: ['伐採'], fellingReason: '枯死' }))).not.toContain('fellReason');
    expect(ids(T({ grade: 'D' }))).toContain('gradeTreat');
  });
  it('弱点写真が上限を超えたら知らせる', () => {
    const t = T({ vigor: '良', deadBranch: '有', decay: '有', fungus: '有' });
    expect(alertsOf(t, cfg).find((x) => x.id === 'photoOver').msg).toBe('弱点写真は2枚までです。');
  });
  it('台帳で入力済み・アプリの控え', () => {
    expect(ids(T({ source: 'ledger', ledgerDate: '2099-04-05' }))).toContain('ledgerDone');
    expect(ids(T({ appBackup: { date: '2099-04-06' } }))).toContain('appBackup');
  });
});

describe('樹種', () => {
  it('置き換え表どおりに直す', () => {
    expect(normalizeSpecies(' キュウメイノキ ', cfg)).toBe('テストノキ');
    expect(normalizeSpecies('ミホンカエデ', cfg)).toBe('ミホンカエデ');
  });
});

describe('設定の検証', () => {
  it('見本の設定は正しい', () => expect(validateConfig(cfg)).toEqual({ ok: true, errors: [] }));
  it('版が違う・項目が無い・規則が不正なら理由を返す', () => {
    const bad = structuredClone(cfg);
    bad.version = 99;
    delete bad.calc;
    bad.rules.push({ id: 'x', type: 'unknownType', level: 'warn', message: 'm' });
    bad.rules.push({ id: 'treeNo', type: 'treatForbidden', level: 'warn', message: 'm', pattern: '(' });
    const r = validateConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/版が違います/);
    expect(r.errors.join('\n')).toMatch(/calc がありません/);
    expect(r.errors.join('\n')).toMatch(/unknownType/);
    expect(r.errors.join('\n')).toMatch(/id が重複/);
    expect(r.errors.join('\n')).toMatch(/正規表現として読めません/);
  });
  it('JSON の形でなければ不正', () => expect(validateConfig(null).ok).toBe(false));
  it('不正な設定は使わず、前の設定で動かす', () => {
    const prev = { name: '前の設定' };
    expect(chooseConfig({ version: 99 }, prev).config).toBe(prev);
    expect(chooseConfig({ version: 99 }, prev).errors.length).toBeGreaterThan(0);
    expect(chooseConfig(cfg, prev)).toEqual({ config: cfg, errors: [] });
  });
});

describe('定型文の文を変えたとき（was：前の文）', () => {
  it('前の文で入れた行も、同じ定型文として扱う（一覧表用の特記・ボタンの付け外し・自由記述の見分け）', async () => {
    const { autoDbNote, chipsIn, freeNoteLines, toggleChip } = await import('../src/core/notes.js');
    const c = structuredClone(cfgJson);
    const chip = c.noteChips.find((x) => x.t === '枝の偏り');
    expect(chip.was).toEqual(['枝のかたより']);
    const notes = '・枝のかたより\n・幹に腐朽';
    expect(chipsIn(notes, c).map((x) => x.t)).toEqual(['枝の偏り']);
    expect(freeNoteLines(notes, c)).toEqual(['幹に腐朽']);
    expect(autoDbNote(notes, c)).toBe(autoDbNote('・枝の偏り\n・幹に腐朽', c));
    // ボタンを押すと前の文の行を消す（二重にしない）。もう一度押すと今の文で足す
    const off = toggleChip(notes, chip);
    expect(off).toBe('・幹に腐朽');
    expect(toggleChip(off, chip)).toBe('・幹に腐朽\n・枝の偏り');
    // 前の文がほかの定型文と重なれば設定の誤り
    const bad = structuredClone(cfgJson);
    bad.noteChips.find((x) => x.t === '枝の偏り').was = [bad.noteChips[0].t];
    expect(validateConfig(bad).errors.join('\n')).toContain('重複');
  });
});

describe('番号の並びをまとめる（ファイル名用）', () => {
  it('英字の記号ごとに「最初-最後」。1本ならその番号', async () => {
    const { numberRanges } = await import('../src/core/text.js');
    expect(numberRanges(['PD0259', 'PD0037', 'PI0083', 'ＰＤ０１００'])).toBe('PD0037-PD0259,PI0083');
    expect(numberRanges(['AB001'])).toBe('AB001');
    expect(numberRanges([])).toBe('');
  });
});
