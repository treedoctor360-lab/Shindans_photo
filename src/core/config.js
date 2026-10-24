// 設定ファイルの検証
// 設定ファイル（業務ごとの選択肢・定型文・判定の基準など）は外から読み込むので、
// 使う前に形を確かめる。不正なら使わず、前に使えていた設定で動かす。

import { RULE_TYPES } from './rules.js';
import { validateDetailParts } from './detailParts.js';
import { validateKarte } from './karteCells.js';
import { validateFromMeasures, validateNoteMeasures } from './noteMeasures.js';
import { validateWording } from './wording.js';

// このアプリが読める設定の版。形式を変えたら上げる
export const CONFIG_VERSION = 6; // 2: dbFormat（台帳の列）/ 3: 一覧表への書き戻し / 4: fieldSheet（野帳）/ 5: 入力画面の選択肢 / 6: initialSurvey（詳しい診断のデータ入力用ブック。省略可）

const LEVELS = ['info', 'warn', 'danger'];

// 規則の種類ごとに必要な項目
const RULE_FIELDS = {
  treeNoPattern: ['pattern'],
  statusNotice: ['status'],
  speciesNotice: ['pattern'],
  ratioAtLeast: ['items'],
  contains: ['field', 'anyOf'],
  conflict: ['when', 'hits'],
  noteSuggestsTreat: ['note', 'treat'],
  treatForbidden: ['pattern'],
  treatRequires: ['pattern', 'field', 'label'],
  gradeNeedsTreat: ['grades'],
  photoOver: [],
};
// 正規表現として読む項目
const REGEX_FIELDS = ['pattern', 'unless'];

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isArr = Array.isArray;
const isObj = (v) => v != null && typeof v === 'object' && !isArr(v);
const isCond = (c) => isObj(c) && isStr(c.field) && typeof c.eq === 'string';

// 検証する。返す形：{ ok: true/false, errors: ['…', …] }
export function validateConfig(cfg) {
  const e = [];
  const need = (ok, msg) => {
    if (!ok) e.push(msg);
    return ok;
  };

  if (!need(isObj(cfg), '設定が読めません（JSON の形ではありません）')) return { ok: false, errors: e };
  need(cfg.version === CONFIG_VERSION, `設定の版が違います（このアプリは ${CONFIG_VERSION}、設定は ${cfg.version}）`);

  need(isStr(cfg.deadVigor), 'deadVigor（枯死に当たる樹勢の値）がありません');
  need(isStr(cfg.vigorLabel) && isStr(cfg.gradeLabel), 'vigorLabel・gradeLabel（項目名）がありません');

  const c = cfg.calc;
  if (need(isObj(c), 'calc がありません')) {
    need(isNum(c.multiStemFactor) && c.multiStemFactor > 0 && c.multiStemFactor <= 1, 'calc.multiStemFactor は 0〜1 の数にしてください');
    need(isNum(c.pi) && c.pi > 3 && c.pi < 3.2, 'calc.pi は円周率の値にしてください');
    need(isNum(c.branchCap) && c.branchCap > 0, 'calc.branchCap は正の数にしてください');
    need(isStr(c.branchCapLabel) && isStr(c.deadLabel), 'calc.branchCapLabel・deadLabel がありません');
  }

  if (need(isArr(cfg.checks) && cfg.checks.length > 0, 'checks（点検項目）がありません')) {
    cfg.checks.forEach((x, i) => need(isStr(x?.key) && isStr(x?.label), `checks[${i}] に key と label が必要です`));
    const keys = cfg.checks.map((x) => x?.key);
    need(new Set(keys).size === keys.length, 'checks の key が重複しています');
  }

  if (need(isArr(cfg.details), 'details がありません'))
    cfg.details.forEach((d, i) => {
      need(isCond(d?.when) && isStr(d?.field) && isStr(d?.label), `details[${i}] の形が違います`);
      need(d?.numeric == null || typeof d.numeric === 'boolean', `details[${i}].numeric（数字のキーボード）は true か false にしてください`);
    });

  need(isObj(cfg.initial) && isStr(cfg.initial.label) && isStr(cfg.initial.yes) && isStr(cfg.initial.no), 'initial（初期診断の必要性）の形が違います');

  if (need(isArr(cfg.noteChips), 'noteChips（定型文）がありません')) {
    cfg.noteChips.forEach((x, i) => need(isStr(x?.t) && ['n', 's'].includes(x?.kind), `noteChips[${i}] に t と kind（n か s）が必要です`));
    cfg.noteChips.forEach((x, i) => need(x?.was == null || (isArr(x.was) && x.was.every(isStr)), `noteChips[${i}].was（前の文）は文字の並びにしてください`));
    // 今の文と前の文（was）を合わせて、ほかの定型文と重ならないこと
    const ts = cfg.noteChips.flatMap((x) => [x?.t, ...(isArr(x?.was) ? x.was : [])]);
    need(new Set(ts).size === ts.length, 'noteChips の t（前の文 was を含む）が重複しています');
  }
  need(isObj(cfg.dbNote) && typeof cfg.dbNote.nounJoin === 'string' && typeof cfg.dbNote.nounSuffix === 'string', 'dbNote の形が違います');

  const t = cfg.treat;
  need(isObj(t) && isArr(t.prune) && isArr(t.other) && typeof t.pruneSuffix === 'string' && typeof t.join === 'string', 'treat（処置）の形が違います');

  need(isObj(cfg.species) && isArr(cfg.species.list) && isObj(cfg.species.replace), 'species（樹種）の形が違います');

  const p = cfg.photo;
  if (need(isObj(p), 'photo がありません')) {
    need(isStr(p.fullName) && isStr(p.flagYes) && isStr(p.flagNo), 'photo.fullName・flagYes・flagNo がありません');
    need(isNum(p.maxWeak) && p.maxWeak > 0, 'photo.maxWeak は正の数にしてください');
    need(isArr(p.weak) && p.weak.every((x) => isCond(x) && isStr(x.name)), 'photo.weak の形が違います');
    need(isArr(p.shared) && p.shared.every((x) => isCond(x) && isStr(x.name)), 'photo.shared の形が違います');
    need(isArr(p.fullOnly) && p.fullOnly.every(isCond), 'photo.fullOnly の形が違います');
    // camera（省略可）：撮った写真の大きさ・ファイル名・端末に残す量
    if (p.camera !== undefined) {
      const c = p.camera;
      need(
        isObj(c) && ['long', 'short', 'maxKB', 'localMB'].every((k) => c[k] === undefined || (isNum(c[k]) && c[k] > 0)) && (c.fileName === undefined || isStr(c.fileName)),
        'photo.camera の long・short・maxKB・localMB は正の数、fileName は文字にしてください',
      );
    }
  }

  if (need(isArr(cfg.rules), 'rules（判定支援の規則）がありません')) {
    const ids = new Set();
    cfg.rules.forEach((r, i) => {
      const at = `rules[${i}]${r?.id ? `（${r.id}）` : ''}`;
      if (!need(isObj(r) && isStr(r.id), `${at} に id が必要です`)) return;
      need(!ids.has(r.id), `${at} の id が重複しています`);
      ids.add(r.id);
      if (!need(RULE_TYPES.includes(r.type), `${at} の type「${r.type}」は使えません`)) return;
      need(LEVELS.includes(r.level), `${at} の level は info・warn・danger のどれかです`);
      need(isStr(r.message), `${at} に message が必要です`);
      RULE_FIELDS[r.type].forEach((f) => need(r[f] != null, `${at} に ${f} が必要です`));
      REGEX_FIELDS.forEach((f) => {
        if (r[f] == null) return;
        try {
          new RegExp(r[f]);
        } catch {
          e.push(`${at} の ${f} が正規表現として読めません`);
        }
      });
      if (r.type === 'ratioAtLeast')
        need(
          isArr(r.items) && r.items.every((it) => ['height', 'branch'].includes(it.ratio) && isNum(it.threshold) && isStr(it.label)),
          `${at} の items の形が違います`,
        );
      if (r.type === 'conflict') need(isCond(r.when) && isArr(r.hits) && r.hits.every((h) => isCond(h) && isStr(h.label)), `${at} の when・hits の形が違います`);
      if (r.actions != null)
        need(isArr(r.actions) && r.actions.every((a) => ['addTreat', 'addNote'].includes(a?.type) && isStr(a.value) && isStr(a.label)), `${at} の actions の形が違います`);
    });
  }

  validateDbFormat(cfg.dbFormat, need, e);
  validateFieldSheet(cfg.fieldSheet, need);
  validateScreen(cfg, need);
  if (cfg.previous != null) validatePrevious(cfg.previous, need);
  if (cfg.initialSurvey != null) validateInitialSurvey(cfg.initialSurvey, cfg, need);
  if (cfg.noteMeasures != null) validateNoteMeasures(cfg.noteMeasures, need); // 特記事項に足す寸法の1行（省略可）
  if (cfg.wording != null) validateWording(cfg.wording, need); // 表記の統一（省略可）

  return { ok: e.length === 0, errors: e };
}

// 台帳・一覧表の書式（見出しの探し方など）
function validateDbFormat(f, need, e) {
  if (!need(isObj(f), 'dbFormat（台帳・一覧表の書式）がありません')) return;
  need(Number.isInteger(f.headerRow) && f.headerRow >= 1, 'dbFormat.headerRow は1以上の整数にしてください');
  need(Number.isInteger(f.dataRow) && f.dataRow > f.headerRow, 'dbFormat.dataRow は見出し行より後ろの行にしてください');
  if (!need(isObj(f.columns) && isStr(f.columns.treeNo), 'dbFormat.columns に treeNo（樹木番号の見出し）が必要です')) return;
  for (const [k, re] of Object.entries(f.columns)) {
    try {
      new RegExp(re);
    } catch {
      e.push(`dbFormat.columns.${k} が正規表現として読めません`);
    }
  }
  const has = (k) => k in f.columns;
  need(
    isArr(f.sheets) && f.sheets.length > 0 && f.sheets.every((s) => isStr(s?.type) && isStr(s?.label) && has(s?.identify)),
    'dbFormat.sheets は type・label・identify（columns にある見出しのキー）の一覧にしてください',
  );
  need(isArr(f.infoKeys) && f.infoKeys.every(has), 'dbFormat.infoKeys は columns にあるキーの一覧にしてください');
  need(has(f.doneKey), 'dbFormat.doneKey は columns にあるキーにしてください');
  if (f.serialStatus != null) need(isObj(f.serialStatus) && has(f.serialKey), 'dbFormat.serialStatus を使うときは serialKey（columns にあるキー）が必要です');
  if (f.parenKeys != null)
    need(isObj(f.parenKeys) && Object.entries(f.parenKeys).every(([k, p]) => has(k) && isStr(p?.field)), 'dbFormat.parenKeys の形が違います');
  if (f.replace != null) need(isObj(f.replace) && Object.values(f.replace).every(isObj), 'dbFormat.replace の形が違います');
  // 書き戻し
  need(isArr(f.writeKeys) && f.writeKeys.length > 0 && f.writeKeys.every(has), 'dbFormat.writeKeys は columns にあるキーの一覧にしてください');
  need(has(f.serialKey) && typeof f.newSerial === 'string', 'dbFormat.serialKey・newSerial（一覧表にない木を足すときの通し番号欄）が必要です');
  if (f.serialFor != null) need(isObj(f.serialFor), 'dbFormat.serialFor の形が違います');
  if (f.heightRatioFormula != null)
    need(isStr(f.heightRatioFormula) && f.heightRatioFormula.includes('{height}') && f.heightRatioFormula.includes('{girth}'), 'dbFormat.heightRatioFormula には {height} と {girth} が必要です');
  if (f.parenKeys != null)
    need(Object.values(f.parenKeys).every((p) => isStr(p.when) && (p.alias == null || isObj(p.alias))), 'dbFormat.parenKeys には when（例「有」）が必要です');
}

// 前回の調査の読み方（省略可）。kartes：カルテの種類の一覧（以前の形 karte：1種類だけ、も使える）
function validatePrevious(p, need) {
  if (!need(isObj(p), 'previous の形が違います')) return;
  if (p.kartes != null && !need(isArr(p.kartes) && p.kartes.length > 0, 'previous.kartes はカルテの種類の一覧にしてください')) return;
  const list = p.kartes || (p.karte != null ? [{ id: 'karte', ...p.karte }] : []);
  const labelOk = (d) => isObj(d) && (isStr(d.label) || (isArr(d.label) && d.label.every(isStr))) && (d.nth == null || (Number.isInteger(d.nth) && d.nth >= 1));
  const strs = (v) => v == null || (isArr(v) && v.every(isStr));
  list.forEach((k, i) => {
    const at = p.kartes ? `previous.kartes[${i}]` : 'previous.karte';
    if (!need(isObj(k) && isObj(k.fields), `${at} に fields（見出しの文字と、その右の値）が必要です`)) return;
    need(isStr(k.id), `${at} に id（種類の名前）が必要です`);
    need(Object.values(k.fields).every(labelOk), `${at}.fields の各項目は { label, nth } の形にしてください`);
    need(labelOk(k.fields.treeNo), `${at}.fields に treeNo（樹木番号の見出し）が必要です`);
    need(isStr(k.yesMark), `${at}.yesMark（「有」の印）が必要です`);
    need(k.match == null || isStr(k.match), `${at}.match は文字にしてください`);
    need(k.fieldSheetMark == null || isStr(k.fieldSheetMark), `${at}.fieldSheetMark（野帳に書く印）は文字にしてください`);
    need(
      k.info == null || (isArr(k.info) && k.info.every((x) => isObj(x) && isStr(x.label) && (x.title == null || isStr(x.title)) && (x.nth == null || (Number.isInteger(x.nth) && x.nth >= 1)) && (x.unit == null || isStr(x.unit)))),
      `${at}.info は { label, title?, nth?, unit? } の一覧にしてください`,
    );
    need(strs(k.parts) && strs(k.photoCaptions) && strs(k.dropTexts), `${at} の parts・photoCaptions・dropTexts は文字の一覧にしてください`);
    need(
      k.summary == null || (isArr(k.summary) && k.summary.every((x) => isObj(x) && isStr(x.label) && (x.rows == null || (Number.isInteger(x.rows) && x.rows >= 1)))),
      `${at}.summary は { label, rows } の一覧にしてください`,
    );
  });
  const ids = list.map((k) => k?.id);
  need(new Set(ids).size === ids.length, 'previous.kartes の id が重複しています');
}

// 詳しい診断（初期診断など）の設定（省略可。省略すると、その画面は出さない）
//  book：データ入力用ブックの書式。シートごとに、どの書式（form）・どのシートの種類（siteType）か、
//        見出しの行数・データの最初の行、項目ごとの列（col）と、確かめる見出し（header、正規表現・省略可）
export const INITIAL_FORMS = ['initial', 'environment'];
const INHERIT_CALC = ['@girth', '@heightRatio', '@branchRatio'];
function validateInitialSurvey(s, cfg, need) {
  if (!need(isObj(s), 'initialSurvey の形が違います')) return;
  need(isStr(s.label), 'initialSurvey.label（画面に出す名前）がありません');
  // 引き継ぎ（省略可）：{ 項目: "簡易診断の項目名" か { from, map } }。from が「@」で始まるものは計算した値
  if (s.inherit != null)
    need(
      isObj(s.inherit) &&
        Object.values(s.inherit).every(
          (x) => (isStr(x) || (isObj(x) && isStr(x.from) && (x.map == null || isObj(x.map)))) && (!String(x?.from ?? x).startsWith('@') || INHERIT_CALC.includes(x?.from ?? x)),
        ),
      `initialSurvey.inherit は { 項目: "簡易診断の項目名" か { from, map } } の形にしてください（計算した値は ${INHERIT_CALC.join('・')}）`,
    );
  if (s.forms != null) validateInitialForms(s.forms, need);
  validateDetailParts(s, need); // 弱点の詳細を組み立てる部品（省略可）
  if (s.fromMeasures != null) validateFromMeasures(s.fromMeasures, cfg, need); // 特記事項の寸法から弱点の詳細へ写す（省略可）
  // 一覧表の健全度への書き戻し（省略可）：{ from: "詳しい診断の項目", values: [書く値…], treatFrom?: "処置の項目" }
  if (s.gradeWriteBack != null)
    need(
      isObj(s.gradeWriteBack) &&
        isStr(s.gradeWriteBack.from) &&
        isArr(s.gradeWriteBack.values) &&
        s.gradeWriteBack.values.length > 0 &&
        s.gradeWriteBack.values.every(isStr) &&
        (s.gradeWriteBack.treatFrom == null || isStr(s.gradeWriteBack.treatFrom)),
      'initialSurvey.gradeWriteBack は { from: "項目", values: ["A", …], treatFrom?: "項目" } の形にしてください',
    );
  // 確認用のカルテの様式（省略可）
  if (s.karte != null) {
    const siteTypesK = isObj(cfg.dbFormat) && isArr(cfg.dbFormat.sheets) ? cfg.dbFormat.sheets.map((x) => x?.type) : [];
    validateKarte(s.karte, (form) => initialKeys(s, form), siteTypesK, need);
  }
  if (s.stamp != null)
    need(
      isObj(s.stamp) && (s.stamp.date == null || (isArr(s.stamp.date) && s.stamp.date.length === 3 && s.stamp.date.every(isStr))) && (s.stamp.inspector == null || isStr(s.stamp.inspector)),
      'initialSurvey.stamp は { date: ["年の項目","月の項目","日の項目"], inspector: "調査者の項目" } の形にしてください',
    );
  const b = s.book;
  if (!need(isObj(b), 'initialSurvey.book（データ入力用ブックの書式）がありません')) return;
  need(isStr(b.doneKey), 'initialSurvey.book.doneKey（入力済みの行を見分ける項目。例 treeNo）がありません');
  if (!need(isArr(b.sheets) && b.sheets.length > 0, 'initialSurvey.book.sheets（シートの一覧）がありません')) return;
  const siteTypes = isObj(cfg.dbFormat) && isArr(cfg.dbFormat.sheets) ? cfg.dbFormat.sheets.map((x) => x?.type) : [];
  const seen = new Set();
  b.sheets.forEach((sh, i) => {
    const at = `initialSurvey.book.sheets[${i}]`;
    if (!need(isObj(sh), `${at} の形が違います`)) return;
    need(INITIAL_FORMS.includes(sh.form), `${at}.form は ${INITIAL_FORMS.join('・')} のどれかです`);
    need(siteTypes.includes(sh.siteType), `${at}.siteType は dbFormat.sheets の type のどれかです`);
    const id = `${sh.form}|${sh.siteType}`;
    need(!seen.has(id), `${at}：同じ form・siteType のシートが2つあります`);
    seen.add(id);
    let reOk = isStr(sh.name);
    if (reOk)
      try {
        new RegExp(sh.name);
      } catch {
        reOk = false;
      }
    need(reOk, `${at}.name（シート名の正規表現）が読めません`);
    need(Number.isInteger(sh.headerRows) && sh.headerRows >= 1, `${at}.headerRows（見出しの行数）は1以上の整数にしてください`);
    need(Number.isInteger(sh.dataRow) && sh.dataRow > sh.headerRows, `${at}.dataRow は見出しより後ろの行にしてください`);
    if (!need(isObj(sh.columns) && isObj(sh.columns[b.doneKey]), `${at}.columns に ${b.doneKey} が必要です`)) return;
    const cols = [];
    for (const [k, c] of Object.entries(sh.columns)) {
      if (!need(isObj(c) && isCol(c.col), `${at}.columns.${k} は { col: "AB", header?: "見出し" } の形にしてください`)) continue;
      cols.push(c.col);
      if (c.header == null) continue;
      try {
        new RegExp(c.header);
      } catch {
        need(false, `${at}.columns.${k}.header が正規表現として読めません`);
      }
    }
    need(new Set(cols).size === cols.length, `${at}.columns の列が重複しています`);
  });
}

// 詳しい診断の記録で使える項目の名前（書式 form ごと）：入力画面の項目・弱点の詳細・ブックの列・調査日と調査者・引き継ぎ
function initialKeys(s, form) {
  const keys = new Set();
  const f = isObj(s.forms) ? s.forms[form] : null;
  for (const sec of (isObj(f) && isArr(f.sections) ? f.sections : []))
    for (const it of isObj(sec) && isArr(sec.items) ? sec.items : []) {
      if (!isObj(it) || !isStr(it.key)) continue;
      keys.add(it.key);
      if (it.type === 'weak') keys.add(it.detailKey || `${it.key}Detail`);
    }
  for (const sh of isObj(s.book) && isArr(s.book.sheets) ? s.book.sheets : []) if (isObj(sh) && sh.form === form && isObj(sh.columns)) Object.keys(sh.columns).forEach((k) => keys.add(k));
  if (isObj(s.stamp)) [...(isArr(s.stamp.date) ? s.stamp.date : []), s.stamp.inspector].filter(isStr).forEach((k) => keys.add(k));
  if (isObj(s.inherit)) Object.keys(s.inherit).forEach((k) => keys.add(k));
  ['treeNo', 'species'].forEach((k) => keys.add(k));
  return keys;
}

// 詳しい診断の入力画面の並び（省略可）
//  forms：書式（initial／environment）ごとに { title, sections: [{ title, none?, items: [{ key, label, type, … }] }] }
//   type：choice（選択肢のボタン）/ weak（有無などの選択肢＋「有」のときの詳細）/ number（数）/ text（1行）/ textarea（数行）
//   選択肢は options（設定）か、データ入力用ブックの入力規則から。desk: true は「後で（机上）」の項目。free: true は選択肢にない値も書ける（任意記入）
//   none: true の区切りには「この区切りはすべて無」のボタンを出す
export const INITIAL_ITEM_TYPES = ['choice', 'weak', 'number', 'text', 'textarea'];
function validateInitialForms(forms, need) {
  if (!need(isObj(forms), 'initialSurvey.forms の形が違います')) return;
  for (const [form, f] of Object.entries(forms)) {
    const at = `initialSurvey.forms.${form}`;
    need(INITIAL_FORMS.includes(form), `${at}：書式は ${INITIAL_FORMS.join('・')} のどれかです`);
    if (!need(isObj(f) && isStr(f.title) && isArr(f.sections) && f.sections.length > 0, `${at} には title と sections が必要です`)) continue;
    const keys = [];
    f.sections.forEach((sec, i) => {
      if (!need(isObj(sec) && isStr(sec.title) && isArr(sec.items), `${at}.sections[${i}] には title と items が必要です`)) return;
      sec.items.forEach((it, j) => {
        const ok = isObj(it) && isStr(it.key) && isStr(it.label) && INITIAL_ITEM_TYPES.includes(it.type) && (it.options == null || (isArr(it.options) && it.options.every((o) => typeof o === 'string')));
        need(ok, `${at}.sections[${i}].items[${j}] は { key, label, type（${INITIAL_ITEM_TYPES.join('・')}）, options? } の形にしてください`);
        if (ok) keys.push(it.key, ...(it.type === 'weak' ? [it.detailKey || `${it.key}Detail`] : []));
        if (ok && it.row != null) need(isStr(it.row) && ['number', 'text'].includes(it.type), `${at}.sections[${i}].items[${j}].row（横に並べる組の名前）は、数・1行の文字の項目に文字で付けてください`);
        if (ok && it.noneValue != null) need(isStr(it.noneValue) && ['choice', 'weak'].includes(it.type), `${at}.sections[${i}].items[${j}].noneValue（「すべて無」で入れる値）は、選択肢の項目に文字で付けてください`);
        if (ok && it.free != null) need(it.free === true && it.type === 'choice', `${at}.sections[${i}].items[${j}].free（任意記入）は、選択肢の項目に true で付けてください`);
        if (ok && it.blank != null) need(isStr(it.blank) && ['number', 'text'].includes(it.type), `${at}.sections[${i}].items[${j}].blank（空欄のときの値）は、数・1行の文字の項目に文字で付けてください`);
      });
    });
    need(new Set(keys).size === keys.length, `${at}：項目の key が重複しています`);
  }
}

// 新しい設定が正しければそれを、不正なら前の設定を使う
// 返す形：{ config, errors }（errors が空でなければ、画面で知らせる）
export function chooseConfig(next, previous) {
  const r = validateConfig(next);
  if (r.ok) return { config: next, errors: [] };
  return { config: previous ?? null, errors: r.errors };
}

// 野帳の書式
const isCol = (v) => typeof v === 'string' && /^[A-Z]{1,2}$/.test(v);
const isAddr = (v) => typeof v === 'string' && /^[A-Z]{1,2}\d+$/.test(v);
function validateFieldSheet(fs, need) {
  if (!need(isObj(fs), 'fieldSheet（野帳の書式）がありません')) return;
  const ints = ['rowsPerSheet', 'firstRow', 'rowsPerTree', 'templateRows', 'templateCols'];
  need(ints.every((k) => Number.isInteger(fs[k]) && fs[k] > 0), `fieldSheet の ${ints.join('・')} は正の整数にしてください`);
  need(isNum(fs.charPx) && isNum(fs.defaultColWidth) && isNum(fs.optionFontPt) && isNum(fs.optionLinePt), 'fieldSheet の charPx・defaultColWidth・optionFontPt・optionLinePt は数にしてください');
  need(isStr(fs.font) && /^[0-9A-F]{8}$/i.test(fs.penColor || ''), 'fieldSheet の font・penColor（例 FF1F3D99）が必要です');
  const h = fs.header;
  need(isObj(h) && isAddr(h.title) && isAddr(h.inspector) && isAddr(h.date) && isStr(h.dateTemplate) && isNum(h.eraOffset) && isStr(h.multiLabel), 'fieldSheet.header の形が違います');
  const keys = ['treeNo', 'species', 'height', 'girth', 'branch', 'note', 'initial', 'treat', 'reason'];
  need(isObj(fs.cells) && keys.every((k) => isCol(fs.cells[k])), `fieldSheet.cells には ${keys.join('・')} の列が必要です`);
  need(
    isArr(fs.optionCols) && fs.optionCols.every((oc) => isCol(oc?.col) && isStr(oc.field) && isArr(oc.opts) && oc.opts.length > 0 && oc.opts.every((o) => typeof o?.v === 'string' && isArr(o.lines) && o.lines.length > 0)),
    'fieldSheet.optionCols の形が違います（col・field・opts[{ v, lines }]）',
  );
  if (isArr(fs.optionCols)) {
    const cols = fs.optionCols.map((oc) => oc?.col);
    need(new Set(cols).size === cols.length, 'fieldSheet.optionCols の列が重複しています');
  }
}

// 入力画面の選択肢など
function validateScreen(cfg, need) {
  const o = cfg.options;
  if (!need(isObj(o), 'options（選択肢）がありません')) return;
  const keys = ['vigor', 'initialNeeded', 'grade', ...(isArr(cfg.checks) ? cfg.checks.map((c) => c?.key) : [])];
  for (const k of keys) need(isArr(o[k]) && o[k].length > 0 && o[k].every((v) => typeof v === 'string'), `options.${k}（選択肢の一覧）がありません`);
  if (isArr(o.vigor)) need(o.vigor.includes(cfg.deadVigor), 'options.vigor に deadVigor の値が入っていません');
  if (isArr(o.initialNeeded) && isObj(cfg.initial)) need(o.initialNeeded.includes(cfg.initial.yes) && o.initialNeeded.includes(cfg.initial.no), 'options.initialNeeded に initial.yes・no の値が必要です');
  if (cfg.statusOptions != null)
    need(isArr(cfg.statusOptions) && cfg.statusOptions.every((x) => typeof x?.v === 'string' && isStr(x.label)), 'statusOptions は [{ v, label }] の一覧にしてください');
  if (cfg.gradeText != null) need(isObj(cfg.gradeText), 'gradeText の形が違います');
  if (cfg.noteChipsShow != null) need(Number.isInteger(cfg.noteChipsShow) && cfg.noteChipsShow > 0, 'noteChipsShow は正の整数にしてください');
  if (isArr(cfg.details)) cfg.details.forEach((d, i) => d?.chips != null && need(isArr(d.chips) && d.chips.every(isStr), `details[${i}].chips は文字の一覧にしてください`));
}
