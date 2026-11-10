// 簡易診断の特記事項に、寸法（腐朽・空洞・鋼棒など）の1行を数字から作るテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { autoDbNote, dbNoteOf } from '../src/core/notes.js';
import { photoPlan } from '../src/core/photo.js';
import { addMeasure, appendNoteLine, measureKinds, measureLine, measureParts, measurePlaces, measurePrefill, measureRecord, measuresToInitial, putMeasure, removeMeasure } from '../src/core/noteMeasures.js';
import { addEntry, buildText, checkNumbers, entriesOf, partsOf, removeEntry, requiredFlags, setPart, unchosenEntries, unchosenFlags, withAuto } from '../src/core/detailParts.js';

const cfg = structuredClone(cfgJson);

describe('寸法の1行', () => {
  it('部位・種類と数字から、決まった書き方の1行を作る', () => {
    expect(measureKinds(cfg).map((k) => k.label)).toEqual(['腐朽', '鋼棒貫入', '打診音異常', '枯れ枝', 'はみ出し']);
    expect(measureParts('decay', cfg).map((p) => p.name)).toEqual(['height', 'size', 'circ', 'core']);
    expect(measureLine(cfg, 'decay', '幹', { height: { a: '２' }, size: [{ w: '20', h: '50' }], circ: { a: '110', b: '150' }, core: true })).toBe(
      '幹の腐朽：地上2m、20cm×50cm、110/150（芯達）',
    );
    expect(measureLine(cfg, 'rod', '根株', { rod: { a: '29', b: '50' } })).toBe('根株の鋼棒貫入：29cm/50cm');
    expect(measureLine(cfg, 'tap', '幹', { height: { a: '0.5', b: '2.2' } })).toBe('幹の打診音異常：地上0.5～2.2m');
    // 2か所
    expect(measureLine(cfg, 'decay', '枝', { size: [{ w: '10', h: '5' }, { w: '7', h: '7' }] })).toBe('枝の腐朽：10cm×5cm、7cm×7cm（2箇所）');
    // 数字が何もなければ作らない。部位・種類が選ばれていなければ作らない
    expect(measureLine(cfg, 'decay', '幹', {})).toBe('');
    expect(measureLine(cfg, 'decay', '', { height: { a: '2' } })).toBe('');
    expect(measureLine(cfg, 'nothing', '幹', { height: { a: '2' } })).toBe('');
  });

  it('部位を選ばない種類（枯れ枝）：種類ごとの1行の形。本数は木の入力から入れておく', () => {
    expect(measurePlaces('deadBranch', cfg)).toEqual([]);
    expect(measurePlaces('decay', cfg)).toEqual(cfg.noteMeasures.places);
    expect(measurePrefill('deadBranch', { deadBranchCount: '４' }, cfg)).toEqual({ count: '4' });
    expect(measurePrefill('decay', { deadBranchCount: '4' }, cfg)).toEqual({});
    expect(measureLine(cfg, 'deadBranch', '', { count: '6', height: { a: '5' }, branchDia: '4', branchLen: '3', max: true })).toBe('枯れ枝：6本、地上5m、枝直径4cm、枝長3m（最大）');
  });

  it('特記事項の最後に「・」を付けて1行足す（空なら1行目に）', () => {
    expect(appendNoteLine('', 'A')).toBe('・A');
    expect(appendNoteLine('・枝の偏り', 'A')).toBe('・枝の偏り\n・A');
    expect(appendNoteLine('・枝の偏り\n\n', 'A')).toBe('・枝の偏り\n・A');
  });
});

describe('設定の確かめ', () => {
  it('寸法の設定の誤りを知らせる。省略してもよい', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (fn) => {
      const c = structuredClone(cfgJson);
      fn(c.noteMeasures, c);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((m) => (m.kinds[0].parts = ['nothing']))).toContain('noteMeasures.kinds[0].parts');
    expect(bad((m) => (m.places = []))).toContain('noteMeasures.places');
    expect(bad((m) => (m.parts.circ.type = 'slider'))).toContain('noteMeasures.parts.circ');
    expect(bad((m) => (m.kinds[3].prefill = { nothing: 'deadBranchCount' }))).toContain('prefill');
    expect(bad((m) => (m.kinds[3].places = '枝'))).toContain('places');
    expect(bad((m, c) => delete c.noteMeasures)).toBe('');
  });
});

describe('詳しい診断への引き継ぎ（initialSurvey.fromMeasures）', () => {
  // 見本の設定に、幹の腐朽（周囲長比あり）を足したもの
  const withTrunk = () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size', 'ratio', 'core'] });
    c.initialSurvey.fromMeasures.push({
      kind: 'decay',
      place: '幹',
      item: 't2',
      parts: { height: 'height', size: 'size', circ: { to: 'ratio', ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3' } }, core: 'core' },
    });
    return c;
  };
  const tree = (measures) => ({ notes: measures.map((m) => `・${m.line}`).join('\n'), measures });
  const decay = (place, values) => {
    const c = withTrunk();
    return measureRecord('decay', place, values, measureLine(c, 'decay', place, values));
  };

  it('見本の設定は通る。形の誤りを知らせる', () => {
    expect(validateConfig(withTrunk()).errors).toEqual([]);
    const bad = (fn) => {
      const c = withTrunk();
      fn(c.initialSurvey.fromMeasures);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((l) => (l[1].kind = 'none'))).toContain('noteMeasures.kinds にありません');
    expect(bad((l) => (l[1].item = 'height'))).toContain('弱点（weak）の項目にありません');
    expect(bad((l) => (l[1].parts.size3 = 'size'))).toContain('「size3」は寸法「decay」の欄にありません');
    expect(bad((l) => (l[1].parts.height = 'branchDia'))).toContain('写し先「branchDia」');
    expect(bad((l) => (l[1].parts.circ.ratio.ge = '≧1/2'))).toContain('ratio');
  });

  it('寸法の数字を、弱点の詳細の数値と文に写す。110/150 は周囲長比（1/3 以上か）にする', () => {
    const c = withTrunk();
    const r = measuresToInitial(tree([decay('幹', { height: { a: '1.5' }, size: [{ w: '20', h: '50' }], circ: { a: '110', b: '150' }, core: true })]), c);
    expect(r.keys).toEqual(['t2Detail']);
    expect(r.values.t2DetailParts).toEqual({ height: { a: '1.5' }, size: [{ w: '20', h: '50' }], ratio: '≧1/3', core: true });
    expect(r.values.t2Detail).toBe('地上1.5m、20×50cm、周囲長比≧1/3（芯達）');
    // 1/3 ちょうどは「以上」、それ未満は「未満」
    expect(measuresToInitial(tree([decay('幹', { circ: { a: '50', b: '150' } })]), c).values.t2DetailParts.ratio).toBe('≧1/3');
    expect(measuresToInitial(tree([decay('幹', { circ: { a: '49', b: '150' } })]), c).values.t2DetailParts.ratio).toBe('＜1/3');
    // 設定にない部位（枝の腐朽）は写さない
    expect(measuresToInitial(tree([decay('枝', { height: { a: '3' } })]), c).keys).toEqual([]);
  });

  it('同じ項目に2つ来たら、1件ずつ別の箇所にし、文は①②で並べる（高さ・周囲長などの数を混ぜない）', () => {
    const c = withTrunk();
    const r = measuresToInitial(
      tree([
        decay('幹', { height: { a: '2' }, size: [{ w: '10', h: '5' }], circ: { a: '20', b: '150' } }),
        decay('幹', { height: { a: '0.5', b: '1' }, size: [{ w: '7', h: '7' }], circ: { a: '60', b: '150' } }),
      ]),
      c,
    );
    expect(r.values.t2DetailParts).toEqual({
      height: { a: '2' },
      size: [{ w: '10', h: '5' }],
      ratio: '＜1/3',
      more: [{ height: { a: '0.5', b: '1' }, size: [{ w: '7', h: '7' }], ratio: '≧1/3' }],
    });
    expect(r.values.t2Detail).toBe('①地上2m、10×5cm、周囲長比＜1/3 ②地上0.5～1m、7×7cm、周囲長比≧1/3');
  });

  it('特記事項から消した・書き換えた1行の数字は使わない', () => {
    const c = withTrunk();
    const m = decay('幹', { height: { a: '2' } });
    expect(measuresToInitial({ notes: '・枝の偏り', measures: [m] }, c).keys).toEqual([]);
    expect(measuresToInitial({ notes: `・${m.line.replace('2m', '3m')}`, measures: [m] }, c).keys).toEqual([]);
    expect(measuresToInitial({ notes: `・${m.line}`, measures: [m] }, c).keys).toEqual(['t2Detail']);
  });

  it('枯れ枝（部位なし）は枯れ枝の項目へ。設定がなければ何もしない', () => {
    const v = { count: '3', height: { a: '4' }, branchDia: '5', branchLen: '1.5', max: true };
    const m = measureRecord('deadBranch', '', v, measureLine(cfg, 'deadBranch', '', v));
    const r = measuresToInitial(tree([m]), cfg);
    expect(r.values.b4DetailParts).toEqual({ count: '3', height: { a: '4' }, branchDia: '5', branchLen: '1.5' }); // 写し先にない「最大」は写さない
    expect(r.values.b4Detail).toBe('3本、地上4m、枝直径5cm、枝長1.5m');
    const c = structuredClone(cfgJson);
    delete c.initialSurvey.fromMeasures;
    expect(measuresToInitial(tree([m]), c)).toEqual({ values: {}, keys: [] });
  });
});

describe('決まった値を入れる（fromMeasures の set）', () => {
  it('根株の空洞を、幹の空洞の欄に「根株、…」として写す', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.site = { type: 'choice', label: '部位', options: ['根株'] };
    c.initialSurvey.detailParts.size3 = { type: 'size', label: '縦×横×奥行', depth: true, unitEach: true };
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't1', label: '開口空洞', type: 'weak', parts: ['site', 'height', 'size3'] });
    c.noteMeasures.kinds.push({ key: 'cavity', label: '開口空洞', parts: ['height', 'size3'] });
    c.initialSurvey.fromMeasures.push({ kind: 'cavity', place: '根株', item: 't1', set: { site: '根株' }, parts: { size3: 'size3' } });
    expect(validateConfig(c).errors).toEqual([]);
    const v = { size3: [{ w: '15', h: '11', d: '5' }] };
    const line = measureLine(c, 'cavity', '根株', v);
    const r = measuresToInitial({ notes: `・${line}`, measures: [measureRecord('cavity', '根株', v, line)] }, c);
    expect(r.values.t1DetailParts).toEqual({ site: '根株', size3: [{ w: '15', h: '11', d: '5' }] });
    expect(r.values.t1Detail).toBe('根株、15cm×11cm×5cm');

    const bad = (fn) => {
      const x = structuredClone(c);
      fn(x.initialSurvey.fromMeasures.at(-1));
      return validateConfig(x).errors.join('\n');
    };
    expect(bad((m) => (m.set = { site: '根元' }))).toContain('選択肢にありません');
    expect(bad((m) => (m.set = { nothing: 'x' }))).toContain('数値にありません');
  });
});

describe('特記事項の寸法の1行から撮る写真を決める（kinds の photo / fullOnly）', () => {
  const c = structuredClone(cfgJson);
  c.noteMeasures.kinds.find((k) => k.key === 'decay').photo = '{place}の腐朽';
  c.noteMeasures.kinds.find((k) => k.key === 'rod').fullOnly = true;
  const base = { vigor: '並', lean: '無', deadBranch: '無', decay: '無', fungus: '無', initialNeeded: '否', grade: 'B' };
  const tree = (measures, notes) => ({ ...base, measures, notes });
  const decay = measureRecord('decay', '幹', {}, '幹の腐朽：10×20cm');
  const rod = measureRecord('rod', '根株', {}, '根株の鋼棒貫入：2cm');

  it('設定は正しい（photo・fullOnly を足しても通る）', () => expect(validateConfig(c)).toEqual({ ok: true, errors: [] }));

  it('photo の種類の1行があれば、その弱点写真が要る', () => {
    const p = photoPlan(tree([decay], `・${decay.line}`), c);
    expect(p.mode).toBe('full+weak');
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '幹の腐朽']);
  });

  it('fullOnly の種類の1行だけなら、全景だけ要る', () => {
    expect(photoPlan(tree([rod], `・${rod.line}`), c).mode).toBe('fullOnly');
  });

  it('特記事項から消した・書き換えた1行は判定に使わない。設定にない種類は今までどおり', () => {
    expect(photoPlan(tree([decay, rod], '・別の特記'), c).mode).toBe('none');
    expect(photoPlan(tree([decay], `・${decay.line}`), cfgJson).mode).toBe('none');
  });

  // 特記事項に書いたものは撮る（現場で撮る写真。一覧表の写真の有無・弱点写真の上限には数えない）
  it('特記事項の寸法の1行・定型文・手で書いた行は、すべて撮る写真（extra）に出る', () => {
    const p = photoPlan(tree([rod], `・${rod.line}\n・枝の偏り\n・幹に古い傷あり。`), c);
    expect(p.mode).toBe('fullOnly'); // 判定（写真の有無）は今までどおり
    expect(p.extra.map((x) => x.name)).toEqual(['枝の偏り', '根株の鋼棒貫入', '幹に古い傷あり']);
    expect(p.extra.every((x) => x.orient === c.photo.weakOrient)).toBe(true);
    expect(p.shoot.map((x) => x.name)).toEqual(['全景', '枝の偏り', '根株の鋼棒貫入', '幹に古い傷あり']);
  });

  it('【再現】手で直した寸法の1行は「：」の前だけを名前にし、弱点写真・寸法の1行と同じ名前なら二重に出さない', () => {
    const p = photoPlan(tree([decay], `・${decay.line}\n・幹の腐朽：地上1m、10cm×5cm\n・根株の腐朽：地上0～0.2m、25cm×20cm`), c);
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '幹の腐朽']);
    expect(p.extra.map((x) => x.name)).toEqual(['根株の腐朽']);
  });

  it('弱点写真と同じ名前は二重に出さない。弱点がなくても特記があれば全景も撮る', () => {
    const p = photoPlan(tree([decay], `・${decay.line}`), c);
    expect(p.slots.map((s) => s.name)).toEqual(['全景', '幹の腐朽']);
    expect(p.extra).toEqual([]);
    const q = photoPlan(tree([], '・枝の偏り'), cfgJson);
    expect(q.mode).toBe('none');
    expect(q.shoot.map((x) => x.name)).toEqual(['全景', '枝の偏り']);
    expect(photoPlan(tree([], ''), cfgJson).shoot).toEqual([]);
  });
});

describe('同じ部位・種類の寸法を1行にまとめる（noteMeasures.merge）', () => {
  const c = structuredClone(cfgJson);
  c.noteMeasures.merge = true;
  c.noteMeasures.parts.height.prefix = 'H';
  c.noteMeasures.parts.size.unitEach = false;
  c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size'] });
  c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '根株', item: 't2', parts: { height: 'height', size: 'size' } });
  const rec = (place, values) => measureRecord('decay', place, values, measureLine(c, 'decay', place, values));
  const add = (tree, r) => ({ ...tree, ...addMeasure(tree, c, r) });

  it('設定は通る', () => expect(validateConfig(c).errors).toEqual([]));

  it('2つ目からは、同じ部位・種類の1行に①②…でまとめる。ほかの行・別の部位はそのまま', () => {
    let t = { notes: '・ガードリング(不可)', measures: [] };
    t = add(t, rec('根株', { height: { a: '0', b: '0.4' }, size: [{ w: '40', h: '20' }] }));
    expect(t.notes).toBe('・ガードリング(不可)\n・根株の腐朽：H0～0.4m、40×20cm');
    t = add(t, rec('幹', { size: [{ w: '10', h: '5' }] }));
    t = add(t, rec('根株', { height: { a: '0', b: '0.5' }, size: [{ w: '50', h: '10' }] }));
    t = add(t, rec('根株', { height: { a: '0', b: '0.3' }, size: [{ w: '30', h: '30' }] }));
    expect(t.notes).toBe('・ガードリング(不可)\n・根株の腐朽：①H0～0.4m、40×20cm ②H0～0.5m、50×10cm ③H0～0.3m、30×30cm\n・幹の腐朽：10×5cm');
    // まとめた寸法は、どれも特記事項に残っている扱い → 詳しい診断に全部写す（大きさは並べ、高さは一番低い所から高い所まで）
    expect(t.measures.filter((m) => m.place === '根株').every((m) => t.notes.includes(m.line))).toBe(true);
    const r = measuresToInitial(t, c);
    // 詳しい診断では、まとめた1行ではなく元の寸法1件ずつを箇所にする
    expect(r.values.t2DetailParts.size).toHaveLength(1);
    expect(r.values.t2DetailParts.more).toHaveLength(2);
    expect(r.values.t2DetailParts.height).toEqual({ a: '0', b: '0.4' });
  });

  it('手で書き直した1行はまとめない（新しい1行として足す）。merge がなければ今までどおり別の行', () => {
    let t = { notes: '', measures: [] };
    t = add(t, rec('根株', { size: [{ w: '40', h: '20' }] }));
    t = { ...t, notes: '・根株の腐朽：40×20cm（南側）' };
    t = add(t, rec('根株', { size: [{ w: '50', h: '10' }] }));
    expect(t.notes).toBe('・根株の腐朽：40×20cm（南側）\n・根株の腐朽：50×10cm');
    const off = { ...c, noteMeasures: { ...c.noteMeasures, merge: false } };
    let u = { notes: '', measures: [] };
    u = { ...u, ...addMeasure(u, off, rec('根株', { size: [{ w: '40', h: '20' }] })) };
    u = { ...u, ...addMeasure(u, off, rec('根株', { size: [{ w: '50', h: '10' }] })) };
    expect(u.notes.split('\n')).toHaveLength(2);
  });
});

describe('寸法の1行を一覧表用の特記にも入れる（kinds の db）', () => {
  it('高さと長さの1行（部位は種類の places）', () => {
    expect(measurePlaces('overhang', cfg)).toEqual(['左', '右']);
    expect(measureLine(cfg, 'overhang', '右', { height: { a: '2.5' }, len: '1.2' })).toBe('はみ出し(右)：地上2.5m、L1.2m');
  });
  it('特記事項に残っている寸法の1行は、db の言い回しで一覧表用の特記に入る（定型文と同じく入力した順）', () => {
    const line = measureLine(cfg, 'overhang', '右', { height: { a: '2.5' }, len: '1.2' });
    const t = { notes: '', measures: [] };
    const a = addMeasure({ notes: '・枝の偏り' }, cfg, measureRecord('overhang', '右', { height: { a: '2.5' }, len: '1.2' }, line));
    Object.assign(t, a);
    expect(dbNoteOf(t, cfg)).toBe('枝の偏り、はみ出し(右側)あり。');
    // 写真も定型文と同じ名前
    expect(photoPlan({ ...t, vigor: cfg.options.vigor[0] }, cfg).slots.map((x) => x.name)).toContain('はみ出し枝');
  });
  it('同じ部位の2つ目は①②でまとめた1行になり、一覧表用は1回だけ', () => {
    const mc = structuredClone(cfgJson);
    mc.noteMeasures.merge = true;
    let t = { notes: '', measures: [] };
    for (const len of ['1.2', '0.8']) {
      const v = { height: { a: '2.5' }, len };
      t = { ...t, ...addMeasure(t, mc, measureRecord('overhang', '左', v, measureLine(mc, 'overhang', '左', v))) };
    }
    expect(t.notes).toBe('・はみ出し(左)：①地上2.5m、L1.2m ②地上2.5m、L0.8m');
    expect(dbNoteOf(t, mc)).toBe('はみ出し(左側)あり。');
  });
  it('手で消した・書き換えた行や、db のない種類は入れない', () => {
    const line = measureLine(cfg, 'overhang', '右', { len: '1' });
    expect(autoDbNote('・はみ出し(右)：L1m（直した）', cfg, [measureRecord('overhang', '右', { len: '1' }, line)])).toBe('');
    const tap = measureLine(cfg, 'tap', '幹', { height: { a: '1' } });
    expect(autoDbNote(`・${tap}`, cfg, [measureRecord('tap', '幹', { height: { a: '1' } }, tap)])).toBe('');
  });
  it('db は文字でなければ設定の誤り', () => {
    const bad = structuredClone(cfgJson);
    bad.noteMeasures.kinds.find((k) => k.key === 'overhang').db = 1;
    expect(validateConfig(bad).errors.join()).toContain('.db');
  });
});

describe('寸法から写した2つの数の比（詳しい診断の pair の ratio.to）', () => {
  it('周囲長／幹周を写すと、文に出さずに持ち、周囲長比の選択肢も決める', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.circ = { type: 'pair', label: '周囲長／幹周', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3', to: 'ratio' } };
    const b4 = c.initialSurvey.forms.initial.sections[1].items[0];
    b4.parts.push('size', 'circ', 'ratio');
    c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '幹', item: 'b4', parts: { size: 'size', circ: 'circ' } });
    expect(validateConfig(c).errors).toEqual([]);
    const values = { circ: { a: '120', b: '187' }, size: [{ w: '100', h: '120' }] };
    const line = measureLine(c, 'decay', '幹', values);
    const r = measuresToInitial({ notes: `・${line}`, measures: [measureRecord('decay', '幹', values, line)] }, c);
    expect(r.values.b4DetailParts.circ).toEqual({ a: '120', b: '187' });
    expect(r.values.b4DetailParts.ratio).toBe('≧1/3');
    expect(r.values.b4Detail).toBe('100×120cm、周囲長比≧1/3');
  });
});

describe('寸法を特記事項の文字から分ける（measuresV 2）', () => {
  const mc = structuredClone(cfgJson);
  mc.noteMeasures.merge = true;
  mc.noteMeasures.parts.memo = { type: 'text', label: '備考' };
  mc.noteMeasures.kinds.find((k) => k.key === 'decay').parts.push('memo');
  const rec = (kind, place, values) => ({ kind, place, values });

  it('新しい形：特記事項の文字には寸法の1行を入れず、野帳の全文では文字の後に並べる（同じ部位・種類は①②）', async () => {
    const { putMeasure, fullNotesOf, measureLinesOf, freeNotesOf, removeMeasure } = await import('../src/core/noteMeasures.js');
    let t = { notes: '・枝の偏り' };
    t = putMeasure(t, mc, rec('decay', '幹', { height: { a: '1' }, size: [{ w: '10', h: '5' }], memo: '北側' }));
    t = putMeasure(t, mc, rec('decay', '幹', { height: { a: '2' } }));
    t = putMeasure(t, mc, rec('rod', '根株', { rod: { a: '21', b: '70' } }));
    expect(t.measuresV).toBe(2);
    expect(t.notes).toBe('・枝の偏り');
    expect(freeNotesOf(t, mc)).toBe('・枝の偏り');
    expect(measureLinesOf(t, mc)).toEqual(['幹の腐朽：①地上1m、10cm×5cm、北側 ②地上2m', '根株の鋼棒貫入：21cm/70cm']);
    expect(fullNotesOf(t, mc)).toBe('・枝の偏り\n・幹の腐朽：①地上1m、10cm×5cm、北側 ②地上2m\n・根株の鋼棒貫入：21cm/70cm');
    // 直す（番号で）・消す
    t = putMeasure(t, mc, rec('decay', '幹', { height: { a: '3' } }), 1);
    expect(measureLinesOf(t, mc)[0]).toBe('幹の腐朽：①地上1m、10cm×5cm、北側 ②地上3m');
    t = removeMeasure(t, mc, 0);
    expect(measureLinesOf(t, mc)).toEqual(['幹の腐朽：地上3m', '根株の鋼棒貫入：21cm/70cm']);
  });

  it('新しい形の寸法も、一覧表用の特記（db）・写真・規則・初期への写しに使う', async () => {
    const { putMeasure, measuresToInitial } = await import('../src/core/noteMeasures.js');
    const { alertsOf } = await import('../src/core/rules.js');
    const t = putMeasure({ notes: '・枝の偏り', vigor: cfg.options.vigor[0], deadBranch: '無' }, mc, rec('overhang', '右', { height: { a: '2.5' }, len: '1.2' }));
    expect(dbNoteOf(t, mc)).toBe('枝の偏り、はみ出し(右側)あり。');
    expect(photoPlan(t, mc).shoot.map((x) => x.name)).toContain('はみ出し枝');
    const d = putMeasure(t, mc, rec('deadBranch', '', { count: '2', height: { a: '3' } }));
    expect(alertsOf(d, mc).map((a) => a.id)).toContain('measureCheck'); // 寸法があるのに③が「無」
    expect(measuresToInitial(d, mc).values.b4Detail).toBe('2本、地上3m');
  });

  it('【移し替え】前の形の木：1行そのままは一覧へ、後ろに言葉を足した行は備考へ、途中を直した行は文字に残す', async () => {
    const { toMeasuresV2, activeMeasures, fullNotesOf } = await import('../src/core/noteMeasures.js');
    const l1 = measureLine(mc, 'decay', '幹', { height: { a: '1' } });
    const l2 = measureLine(mc, 'rod', '根株', { rod: { a: '21', b: '70' } });
    const l3 = measureLine(mc, 'tap', '幹', { height: { a: '2' } });
    const old = {
      notes: `・枝の偏り\n・${l1}、北側に開口\n・${l2}\n・南側の${l3}\n・自由な文`,
      measures: [measureRecord('decay', '幹', { height: { a: '1' } }, l1), measureRecord('rod', '根株', { rod: { a: '21', b: '70' } }, l2), measureRecord('tap', '幹', { height: { a: '2' } }, l3), measureRecord('tap', '幹', { height: { a: '9' } }, '消した行')],
    };
    expect(activeMeasures(old)).toHaveLength(3); // 前と同じく、文字の中に1行が残っているものだけ
    const v2 = toMeasuresV2(old, mc);
    expect(v2.notes).toBe(`・枝の偏り\n・南側の${l3}\n・自由な文`);
    expect(v2.measures).toEqual([
      { kind: 'decay', place: '幹', values: { height: { a: '1' }, memo: '北側に開口' } },
      { kind: 'rod', place: '根株', values: { rod: { a: '21', b: '70' } } },
      { kind: 'tap', place: '幹', values: { height: { a: '2' } } }, // 途中を直した行は、文字にも寸法にも残す（消さない）
    ]);
    expect(fullNotesOf(v2, mc)).toContain(`・${l1}、北側に開口`);
    // 前の形のままの木は、特記事項の文字をそのまま使う（出力は変わらない）
    expect(fullNotesOf(old, mc)).toBe(old.notes);
  });

  it('【移し替え】①②でまとめた1行は、記録ごとに一覧へ分ける', async () => {
    const { toMeasuresV2, measureLinesOf } = await import('../src/core/noteMeasures.js');
    let t = { notes: '' , measures: [] };
    for (const a of ['1', '2']) {
      const v = { height: { a } };
      t = { ...t, ...addMeasure(t, mc, measureRecord('decay', '幹', v, measureLine(mc, 'decay', '幹', v))) };
    }
    expect(t.notes).toBe('・幹の腐朽：①地上1m ②地上2m');
    const v2 = toMeasuresV2(t, mc);
    expect(v2.notes).toBe('');
    expect(v2.measures).toHaveLength(2);
    expect(measureLinesOf(v2, mc)).toEqual(['幹の腐朽：①地上1m ②地上2m']);
  });
});

describe('芯達か芯未達かを必ず選ぶ（flag の required）・開口空洞の有無を数値から決める（項目の valueFrom）', () => {
  // 見本の設定に、開口空洞（周囲長と芯達の印）と、詳しい診断の開口空洞（有無の選択肢を数値から決める）を足したもの
  const withCavity = () => {
    const c = structuredClone(cfgJson);
    Object.assign(c.noteMeasures.parts.core, { required: ['幹', '根株'], offLabel: '芯未達' });
    c.noteMeasures.kinds.push({ key: 'cavity', label: '開口空洞', parts: ['height', 'size3', 'circ', 'core'] });
    const dp = c.initialSurvey.detailParts;
    dp.size3 = { type: 'size', label: '縦×横×奥行', depth: true };
    dp.circ = { type: 'pair', label: '周囲長', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3' } };
    dp.coreReach = { type: 'flag', label: '芯達', text: '（芯達）', noText: true };
    c.initialSurvey.forms.initial.sections[1].items.push({
      key: 't1',
      label: '開口空洞',
      type: 'weak',
      parts: ['height', 'size3', 'circ', 'coreReach'],
      valueFrom: { ratio: 'circ', core: 'coreReach', values: { lt: '有（周囲＜1/3）', ge: '有（周囲≧1/3）', coreLt: '有（芯到達・周囲＜1/3）', coreGe: '有（芯到達・周囲≧1/3）' } },
    });
    c.initialSurvey.fromMeasures.push({ kind: 'cavity', item: 't1', parts: { height: 'height', size3: 'size3', circ: 'circ', core: 'coreReach' } });
    return c;
  };
  const cav = (c, place, values) => measureRecord('cavity', place, values, measureLine(c, 'cavity', place, values));
  const tree = (ms) => ({ notes: ms.map((m) => `・${m.line}`).join('\n'), measures: ms });

  it('設定の形を確かめる', () => {
    expect(validateConfig(withCavity()).errors).toEqual([]);
    const c = withCavity();
    c.noteMeasures.parts.core.required = '幹';
    expect(validateConfig(c).errors.join()).toContain('required');
    const c2 = withCavity();
    c2.initialSurvey.forms.initial.sections[1].items.at(-1).valueFrom.core = 'height';
    expect(validateConfig(c2).errors.join()).toContain('valueFrom');
  });

  it('必ず選ぶ印：決めた部位では、芯達（true）か芯未達（false）を選ぶまで「選んでいない」。芯未達は文に出さない', () => {
    const c = withCavity();
    const parts = measureParts('decay', c);
    expect(requiredFlags(parts, '幹')).toEqual(['core']);
    expect(requiredFlags(parts, '枝')).toEqual([]);
    expect(unchosenFlags({}, parts, '幹')).toEqual(['芯達']);
    expect(unchosenFlags({ core: false }, parts, '幹')).toEqual([]);
    expect(unchosenFlags({}, parts, '枝')).toEqual([]);
    expect(measureLine(c, 'decay', '幹', { height: { a: '1' }, core: false })).toBe('幹の腐朽：地上1m');
    // 鋼棒は数から自動で決まる（貫入深が直径の半分以上なら芯達、未満なら芯未達）
    const rod = measureParts('rod', c);
    expect(unchosenFlags(withAuto({ rod: { a: '10', b: '50' } }, rod, 'rod'), rod, '根株')).toEqual([]);
  });

  it('開口空洞：周囲長比と芯達から、詳しい診断の有無の選択肢を決めて写す（文には芯達・周囲長を出さない）', () => {
    const c = withCavity();
    const r = measuresToInitial(tree([cav(c, '幹', { height: { a: '1' }, size3: [{ w: '20', h: '10', d: '5' }], circ: { a: '60', b: '150' }, core: true })]), c);
    expect(r.values.t1Detail).toBe('地上1m、20×10×5cm');
    expect(r.choices.t1Detail).toEqual({ key: 't1', value: '有（芯到達・周囲≧1/3）' });
    const v = (circ, core) => measuresToInitial(tree([cav(c, '幹', { circ, core })]), c).choices?.t1Detail?.value;
    expect(v({ a: '40', b: '150' }, true)).toBe('有（芯到達・周囲＜1/3）');
    expect(v({ a: '60', b: '150' }, false)).toBe('有（周囲≧1/3）');
    expect(v({ a: '40', b: '150' }, false)).toBe('有（周囲＜1/3）');
    expect(v({ a: '', b: '' }, true)).toBeUndefined(); // 周囲長がなければ決めない
  });

  it('詳しい診断の画面で数値を直したときも、有無の選択肢を決め直す', () => {
    const c = withCavity();
    const item = c.initialSurvey.forms.initial.sections[1].items.at(-1);
    let rec = setPart({}, item, 't1Detail', 'circ', { a: '60', b: '150' }, c);
    expect(rec.t1).toBe('有（周囲≧1/3）');
    rec = setPart(rec, item, 't1Detail', 'coreReach', true, c);
    expect(rec.t1).toBe('有（芯到達・周囲≧1/3）');
  });
});

describe('【再現】同じ項目に寸法が2件以上あるとき、詳しい診断で数値が消えない（箇所ごとに①②）', () => {
  // 不具合：同じ項目（例 幹の腐朽）に寸法が何件かあると、1か所にまとめて写していたため、
  //  周囲長が混ざって別の組になり（10/236 と 20/160 → 10/236）、高さは1つの範囲に、2件目からの備考は消えていた
  const withTrunk = () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.circ = { type: 'pair', label: '周囲長', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3', to: 'ratio' } };
    c.initialSurvey.detailParts.note = { type: 'text', label: '備考', noText: true, prefix: '備考：' };
    c.initialSurvey.detailParts.name.whole = true;
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size', 'name', 'circ', 'ratio', 'core', 'note'] });
    c.noteMeasures.parts.memo = { type: 'text', label: '備考' };
    c.noteMeasures.kinds[0].parts.push('memo');
    c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '幹', item: 't2', parts: { height: 'height', size: 'size', circ: 'circ', core: 'core', memo: 'note' }, fromTree: { name: 'fungusName' } });
    return c;
  };
  const tree = (c, list, o = {}) => {
    const ms = list.map((v) => measureRecord('decay', '幹', v, measureLine(c, 'decay', '幹', v)));
    return { notes: ms.map((m) => `・${m.line}`).join('\n'), measures: ms, ...o };
  };

  it('箇所ごとに数値を残し、文は①②③。項目全体の部品（種名）は最後に1回。確認用の数も箇所ごと', () => {
    const c = withTrunk();
    expect(validateConfig(c).errors).toEqual([]);
    const t = tree(
      c,
      [
        { height: { a: '5', b: '6.5' }, size: [{ w: '150', h: '30' }], memo: '北側' },
        { height: { a: '0.2', b: '1.2' }, size: [{ w: '100', h: '10' }], circ: { a: '10', b: '236' }, memo: '南側' },
        { height: { a: '2', b: '3.5' }, size: [{ w: '150', h: '20' }], circ: { a: '20', b: '160' }, core: true },
      ],
      { fungus: '有', fungusName: '不明種' },
    );
    const r = measuresToInitial(t, c);
    const p = r.values.t2DetailParts;
    expect(entriesOf(p).map((e) => e.circ)).toEqual([undefined, { a: '10', b: '236' }, { a: '20', b: '160' }]);
    expect(entriesOf(p).map((e) => e.note)).toEqual(['北側', '南側', undefined]);
    expect(r.values.t2Detail).toBe('①地上5～6.5m、150×30cm ②地上0.2～1.2m、100×10cm、周囲長比＜1/3 ③地上2～3.5m、150×20cm、周囲長比＜1/3（芯達）、不明種');
    const parts = partsOf(c.initialSurvey.forms.initial.sections[1].items.at(-1), c);
    expect(checkNumbers(p, parts)).toEqual(['①備考：北側', '②10/236', '②備考：南側', '③20/160']);
  });

  it('奥行は大きさに入れず備考へ（rule の depthTo）。備考があれば前に足す', () => {
    const c = withTrunk();
    c.noteMeasures.parts.size.depth = true;
    c.initialSurvey.fromMeasures.at(-1).depthTo = 'note';
    expect(validateConfig(c).errors).toEqual([]);
    const r = measuresToInitial(tree(c, [{ size: [{ w: '30', h: '10', d: '５' }], memo: '北側' }, { size: [{ w: '20', h: '8', d: '3' }, { w: '5', h: '5', d: '2' }] }, { size: [{ w: '9', h: '9' }] }]), c);
    const es = entriesOf(r.values.t2DetailParts);
    expect(es.map((e) => e.size)).toEqual([[{ w: '30', h: '10' }], [{ w: '20', h: '8' }, { w: '5', h: '5' }], [{ w: '9', h: '9' }]]);
    expect(es.map((e) => e.note)).toEqual(['奥行5cm、北側', '奥行3・2cm', undefined]);
    // 提出用の文には出さず、確認用の数（備考）に出す。奥行を別に重ねて出さない
    expect(r.values.t2Detail).not.toContain('奥行');
    const parts = partsOf(c.initialSurvey.forms.initial.sections[1].items.at(-1), c);
    expect(checkNumbers(r.values.t2DetailParts, parts)).toEqual(['①備考：奥行5cm、北側', '②備考：奥行3・2cm']);
  });

  it('depthTo の写し先は文字の欄でないといけない', () => {
    const c = withTrunk();
    c.initialSurvey.fromMeasures.at(-1).depthTo = 'size';
    expect(validateConfig(c).errors.join()).toContain('depthTo');
  });

  it('子実体の種名は、簡易診断で子実体が「有」のときだけ写す', () => {
    const c = withTrunk();
    const v = [{ height: { a: '1' } }];
    expect(measuresToInitial(tree(c, v, { fungus: '有', fungusName: 'コフキタケ' }), c).values.t2Detail).toBe('地上1m、コフキタケ');
    expect(measuresToInitial(tree(c, v, { fungus: '無', fungusName: 'コフキタケ' }), c).values.t2Detail).toBe('地上1m');
  });

  it('merge: true の規則は今までどおり1か所にまとめる', () => {
    const c = withTrunk();
    c.initialSurvey.fromMeasures.at(-1).merge = true;
    const r = measuresToInitial(tree(c, [{ height: { a: '2' }, size: [{ w: '10', h: '5' }] }, { height: { a: '0.5' }, size: [{ w: '7', h: '7' }] }]), c);
    expect(r.values.t2DetailParts.more).toBeUndefined();
    expect(r.values.t2DetailParts.height).toEqual({ a: '0.5', b: '2' });
  });

  it('詳しい診断の画面：箇所ごとに直す・足す・消す（項目全体の部品は1か所目に残す）', () => {
    const c = withTrunk();
    const item = c.initialSurvey.forms.initial.sections[1].items.at(-1);
    let rec = setPart({}, item, 't2Detail', 'height', { a: '1' }, c);
    rec = setPart(rec, item, 't2Detail', 'name', 'コフキタケ', c);
    rec = addEntry(rec, item, 't2Detail', c);
    rec = setPart(rec, item, 't2Detail', 'height', { a: '3' }, c, 1);
    expect(rec.t2Detail).toBe('①地上1m ②地上3m、コフキタケ');
    rec = removeEntry(rec, item, 't2Detail', 0, c);
    expect(rec.t2DetailParts).toEqual({ height: { a: '3' }, name: 'コフキタケ' });
    expect(rec.t2Detail).toBe('地上3m、コフキタケ');
  });
});

describe('子実体の寸法（発生高さ・範囲）：詳しい診断では種名だけを文にし、高さ・範囲は確認用カルテにだけ', () => {
  const withFungus = () => {
    const c = structuredClone(cfgJson);
    c.noteMeasures.parts.fungusName = { type: 'text', label: '子実体の種名' };
    c.noteMeasures.kinds.push({ key: 'fungus', label: '子実体', places: ['幹', '根株'], parts: ['fungusName', 'height', 'size'] });
    const dp = c.initialSurvey.detailParts;
    dp.name.whole = true;
    dp.fungusH = { type: 'height', label: '子実体の発生高さ', noText: true, checkPrefix: '子実体 ' };
    dp.fungusSize = { type: 'size', label: '子実体の範囲', noText: true, checkPrefix: '子実体 ' };
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽(子実体)', type: 'weak', parts: ['height', 'size', 'name', 'fungusH', 'fungusSize'] });
    c.initialSurvey.fromMeasures.push(
      { kind: 'decay', place: '幹', item: 't2', parts: { height: 'height', size: 'size' } },
      { kind: 'fungus', place: '幹', item: 't2', parts: { fungusName: 'name', height: 'fungusH', size: 'fungusSize' }, merge: true },
    );
    return c;
  };
  const rec = (c, kind, values) => measureRecord(kind, '幹', values, measureLine(c, kind, '幹', values));
  const tree = (ms) => ({ notes: ms.map((m) => `・${m.line}`).join('\n'), measures: ms });

  it('腐朽の範囲がなく子実体だけ：文は種名だけ。発生高さ・範囲は確認用の数に', () => {
    const c = withFungus();
    expect(validateConfig(c).errors).toEqual([]);
    const f = rec(c, 'fungus', { fungusName: 'コフキタケ', height: { a: '1.5' }, size: [{ w: '20', h: '10' }] });
    expect(f.line).toBe('幹の子実体：コフキタケ、地上1.5m、20cm×10cm');
    const r = measuresToInitial(tree([f]), c);
    expect(r.values.t2Detail).toBe('コフキタケ');
    const parts = partsOf(c.initialSurvey.forms.initial.sections[1].items.at(-1), c);
    expect(checkNumbers(r.values.t2DetailParts, parts)).toEqual(['子実体 地上1.5m', '子実体 20×10cm']);
  });

  it('腐朽の寸法もあれば、腐朽の箇所に種名を足す（子実体で別の箇所を作らない）', () => {
    const c = withFungus();
    const r = measuresToInitial(tree([rec(c, 'fungus', { fungusName: 'コフキタケ', height: { a: '1.5' } }), rec(c, 'decay', { height: { a: '1' }, size: [{ w: '30', h: '20' }] })]), c);
    expect(r.values.t2Detail).toBe('地上1m、30×20cm、コフキタケ');
    expect(r.values.t2DetailParts.more).toBeUndefined();
  });
});

describe('【再現】子実体の種名は、その子実体の寸法の部位の項目にだけ写す', () => {
  // 不具合：根株に子実体の寸法（ベッコウタケ）を入れると、toTree で簡易の種名に入った名前を、幹の腐朽の規則が fromTree で写していた
  const cfgOf = () => {
    const c = structuredClone(cfgJson);
    c.noteMeasures.parts.fungusName = { type: 'text', label: '子実体の種名' };
    c.noteMeasures.kinds.push({ key: 'fungus', label: '子実体', places: ['幹', '根株'], parts: ['fungusName', 'height'], toTree: { fungus: '有', fungusName: { from: 'fungusName' } } });
    c.initialSurvey.detailParts.name.whole = true;
    const items = c.initialSurvey.forms.initial.sections[1].items;
    items.push({ key: 't2', label: '幹の腐朽', type: 'weak', parts: ['height', 'size', 'name'] }, { key: 'r1', label: '根株の腐朽', type: 'weak', parts: ['height', 'size', 'name'] });
    for (const [place, item] of [['幹', 't2'], ['根株', 'r1']])
      c.initialSurvey.fromMeasures.push(
        { kind: 'decay', place, item, parts: { height: 'height', size: 'size' }, fromTree: { name: 'fungusName' } },
        { kind: 'fungus', place, item, parts: { fungusName: 'name' }, merge: true },
      );
    return c;
  };
  const put = (c, t, kind, place, values) => putMeasure(t, c, { kind, place, values });

  it('根株の子実体は根株の腐朽にだけ。幹の腐朽には写さない', () => {
    const c = cfgOf();
    expect(validateConfig(c).errors).toEqual([]);
    let t = { notes: '', measuresV: 2, measures: [], fungus: '無' };
    t = put(c, t, 'decay', '幹', { height: { a: '1' } });
    t = put(c, t, 'fungus', '根株', { fungusName: 'ベッコウタケ' });
    expect(t.fungusName).toBe('ベッコウタケ');
    const r = measuresToInitial(t, c);
    expect(r.values.t2Detail).toBe('地上1m');
    expect(r.values.r1Detail).toBe('ベッコウタケ');
  });

  it('寸法にない名前（⑦に手で書いた名前）は、今までどおり腐朽の項目に写す', () => {
    const c = cfgOf();
    let t = { notes: '', measuresV: 2, measures: [], fungus: '有', fungusName: 'コフキタケ' };
    t = put(c, t, 'decay', '幹', { height: { a: '1' } });
    t = put(c, t, 'fungus', '根株', { fungusName: 'ベッコウタケ' });
    expect(t.fungusName).toBe('コフキタケ、ベッコウタケ');
    const r = measuresToInitial(t, c);
    expect(r.values.t2Detail).toBe('地上1m、コフキタケ');
    expect(r.values.r1Detail).toBe('ベッコウタケ');
  });

  it('子実体の寸法がなければ、⑦の名前を腐朽の項目に写す（種類の prefill があっても）', () => {
    const c = cfgOf();
    c.noteMeasures.kinds.at(-1).prefill = { fungusName: 'fungusName' };
    let t = { notes: '', measuresV: 2, measures: [], fungus: '有', fungusName: 'コフキタケ' };
    t = put(c, t, 'decay', '幹', { height: { a: '1' } });
    expect(measuresToInitial(t, c).values.t2Detail).toBe('地上1m、コフキタケ');
  });
});

describe('子実体の寸法を入れたら、簡易診断の子実体も「有」にして種名を足す（種類の toTree）', () => {
  const c = structuredClone(cfgJson);
  c.noteMeasures.parts.fungusName = { type: 'text', label: '子実体の種名' };
  c.noteMeasures.kinds.push({ key: 'fungus', label: '子実体', places: ['幹', '根株'], parts: ['fungusName', 'height'], toTree: { fungus: '有', fungusName: { from: 'fungusName' } } });
  it('入れていなければ入れ、入っていれば「、」で足す。同じ名前は足さない', () => {
    expect(validateConfig(c).errors).toEqual([]);
    let t = putMeasure({ notes: '', measuresV: 2, measures: [], fungus: '無' }, c, { kind: 'fungus', place: '幹', values: { fungusName: 'コフキタケ' } });
    expect([t.fungus, t.fungusName]).toEqual(['有', 'コフキタケ']);
    t = putMeasure(t, c, { kind: 'fungus', place: '根株', values: { fungusName: 'ナラタケ' } });
    expect(t.fungusName).toBe('コフキタケ、ナラタケ');
    t = putMeasure(t, c, { kind: 'fungus', place: '根株', values: { fungusName: 'ナラタケ', height: { a: '0.2' } } }, 1);
    expect(t.fungusName).toBe('コフキタケ、ナラタケ');
    // 消しても戻さない
    expect(removeMeasure(t, c, 0).fungusName).toBe('コフキタケ、ナラタケ');
    const bad = structuredClone(c);
    bad.noteMeasures.kinds.at(-1).toTree.fungusName.from = 'nokey';
    expect(validateConfig(bad).errors.join()).toContain('toTree');
  });
});

describe('腐朽の大きさの奥行（size の depthInput）：入れられるが、文には出さず確認用カルテにだけ', () => {
  it('文は縦×横だけ。確認用の数に奥行', () => {
    const p = [{ name: 'size', type: 'size', label: '大きさ', depthInput: true, unitEach: true }];
    const v = { size: [{ w: '70', h: '46', d: '15' }] };
    expect(buildText(v, p)).toBe('70cm×46cm');
    expect(checkNumbers(v, p)).toEqual(['奥行15cm']);
  });
  it('簡易の寸法の奥行は、そのまま大きさに写る（depthTo なし）', () => {
    const c = structuredClone(cfgJson);
    c.noteMeasures.parts.size.depth = true;
    c.initialSurvey.detailParts.size.depthInput = true;
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'size'] });
    c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '幹', item: 't2', parts: { height: 'height', size: 'size' } });
    expect(validateConfig(c).errors).toEqual([]);
    const v = { height: { a: '1' }, size: [{ w: '30', h: '10', d: '5' }] };
    const m = measureRecord('decay', '幹', v, measureLine(c, 'decay', '幹', v));
    const r = measuresToInitial({ notes: `・${m.line}`, measures: [m] }, c);
    expect(r.values.t2DetailParts.size).toEqual([{ w: '30', h: '10', d: '5' }]);
    expect(r.values.t2Detail).toBe('地上1m、30×10cm');
  });
  it('depthInput は size にだけ付けられる', () => {
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.height.depthInput = true;
    expect(validateConfig(c).errors.join()).toContain('depthInput');
  });
});

describe('子実体は腐朽と結び付けず、別の箇所として写す（規則に merge を付けない）', () => {
  const cfgOf = () => {
    const c = structuredClone(cfgJson);
    c.noteMeasures.parts.fungusName = { type: 'text', label: '子実体の種名' };
    c.noteMeasures.kinds.push({ key: 'fungus', label: '子実体', places: ['幹'], parts: ['fungusName', 'height', 'size'] });
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽(子実体)', type: 'weak', parts: ['height', 'size', 'name', 'core'] });
    c.initialSurvey.fromMeasures.push(
      { kind: 'decay', place: '幹', item: 't2', parts: { height: 'height', size: 'size' }, fromTree: { name: 'fungusName' } },
      { kind: 'fungus', place: '幹', item: 't2', parts: { fungusName: 'name', height: 'height', size: 'size' } },
    );
    return c;
  };
  const rec = (c, kind, values) => measureRecord(kind, '幹', values, measureLine(c, kind, '幹', values));
  const tree = (ms, o = {}) => ({ notes: ms.map((m) => `・${m.line}`).join('\n'), measures: ms, ...o });

  it('腐朽と別の高さの子実体：①腐朽 ②子実体（高さ・範囲・種名）', () => {
    const c = cfgOf();
    expect(validateConfig(c).errors).toEqual([]);
    const r = measuresToInitial(
      tree([rec(c, 'decay', { height: { a: '0', b: '0.7' }, size: [{ w: '70', h: '46' }] }), rec(c, 'fungus', { fungusName: 'コフキタケ', height: { a: '1.5' }, size: [{ w: '20', h: '30' }] })]),
      c,
    );
    expect(r.values.t2Detail).toBe('①地上0～0.7m、70×46cm ②地上1.5m、20×30cm、コフキタケ');
  });
  it('腐朽がなく子実体だけ：位置・範囲・種名の1か所', () => {
    const c = cfgOf();
    const r = measuresToInitial(tree([rec(c, 'fungus', { fungusName: 'コフキタケ', height: { a: '1.5' } })]), c);
    expect(r.values.t2Detail).toBe('地上1.5m、コフキタケ');
  });
  it('⑦に手で書いた種名（fromTree）は、腐朽が何か所あっても1回だけ（全部の箇所に付けない）', () => {
    const c = cfgOf();
    const r = measuresToInitial(tree([rec(c, 'decay', { height: { a: '1' } }), rec(c, 'decay', { height: { a: '3' } })], { fungus: '有', fungusName: '不明種' }), c);
    expect(r.values.t2Detail).toBe('①地上1m、不明種 ②地上3m');
  });
});

describe('詳しい診断の芯達／芯未達（flag の required: true）：選んでいなければ保存の前に注意', () => {
  const parts = [
    { name: 'height', type: 'height', label: '高さ' },
    { name: 'circ', type: 'pair', label: '周囲長' },
    { name: 'name', type: 'text', label: '種名', standalone: true },
    { name: 'core', type: 'flag', label: '芯達', text: '（芯達）', required: true, offLabel: '芯未達' },
  ];
  it('選んでいない箇所の番号。芯未達（false）は選んだことになる。空の箇所・子実体だけの箇所は聞かない', () => {
    expect(unchosenEntries({ height: { a: '1' } }, parts)).toEqual([0]);
    expect(unchosenEntries({ height: { a: '1' }, core: false }, parts)).toEqual([]);
    expect(unchosenEntries({ height: { a: '1' }, core: true, more: [{ height: { a: '2' }, name: 'コフキタケ' }, {}] }, parts)).toEqual([]);
    expect(unchosenEntries({ core: true, more: [{ height: { a: '2' }, circ: { a: '5', b: '30' }, name: 'コフキタケ' }] }, parts)).toEqual([1]);
    expect(unchosenEntries(undefined, parts)).toEqual([]);
    expect(requiredFlags(parts, '')).toEqual(['core']);
  });
});

describe('選択肢の印を後ろの文につなぐ（部品の glue）：打診音異常の（大）（小）', () => {
  const parts = [
    { name: 'grade', type: 'choice', label: '程度', options: ['(大)', '(小)'], glue: true },
    { name: 'height', type: 'height', label: '高さ', prefix: 'H' },
    { name: 'memo', type: 'text', label: '備考' },
  ];
  it('（大）は高さの前に「、」なしで付く', () => {
    expect(buildText({ grade: '(大)', height: { a: '1.5' } }, parts)).toBe('(大)H1.5m');
    expect(buildText({ grade: '(小)', height: { a: '0', b: '2' }, memo: '南側' }, parts)).toBe('(小)H0～2m、南側');
  });
  it('選ばなければ今までどおり', () => {
    expect(buildText({ height: { a: '1.5' } }, parts)).toBe('H1.5m');
  });
  it('高さがなく備考だけでも「、」なしでつなぐ', () => {
    expect(buildText({ grade: '(大)', memo: '南側' }, parts)).toBe('(大)南側');
  });
  it('設定の確かめ：glue は true か false', () => {
    const cfg = structuredClone(cfgJson);
    cfg.noteMeasures.parts.height.glue = 'yes';
    expect(validateConfig(cfg).errors.join('\n')).toMatch('glue');
  });
});

describe('打診音異常の(大)(小)：簡易の寸法で選んだ程度を、詳しい診断の有無の選択肢に入れる（valueFrom の choice）', () => {
  const withTap = () => {
    const c = structuredClone(cfgJson);
    c.noteMeasures.parts.tapGrade = { type: 'choice', label: '程度', options: ['(大)', '(小)'], glue: true };
    c.noteMeasures.kinds.find((k) => k.key === 'tap').parts = ['tapGrade', 'height'];
    c.initialSurvey.detailParts.tapGrade = { type: 'choice', label: '程度', options: ['(大)', '(小)'], glue: true };
    c.initialSurvey.forms.initial.sections[1].items.push({
      key: 't6',
      label: '打診音異常',
      type: 'weak',
      parts: ['tapGrade', 'height'],
      valueFrom: { choice: 'tapGrade', values: { '(大)': '有（大）', '(小)': '有（小）' } },
    });
    c.initialSurvey.fromMeasures.push({ kind: 'tap', item: 't6', parts: { tapGrade: 'tapGrade', height: 'height' } });
    return c;
  };
  const tap = (c, values) => measureRecord('tap', '幹', values, measureLine(c, 'tap', '幹', values));
  const tree = (ms) => ({ notes: ms.map((m) => `・${m.line}`).join('\n'), measures: ms, measuresV: 2 });

  it('設定の形を確かめる', () => {
    expect(validateConfig(withTap()).errors).toEqual([]);
    const c = withTap();
    c.initialSurvey.forms.initial.sections[1].items.at(-1).valueFrom = { choice: 'height', values: { '(大)': '有（大）' } };
    expect(validateConfig(c).errors.join()).toContain('valueFrom');
  });

  it('簡易の1行は「幹の打診音異常：(大)地上1.5m」', () => {
    expect(measureLine(withTap(), 'tap', '幹', { tapGrade: '(大)', height: { a: '1.5' } })).toBe('幹の打診音異常：(大)地上1.5m');
  });

  it('(大)なら「有（大）」、程度を選ばなければ有無は決めない', () => {
    const c = withTap();
    const big = measuresToInitial(tree([tap(c, { tapGrade: '(大)', height: { a: '0', b: '1.5' } })]), c);
    expect(big.values.t6Detail).toBe('(大)地上0～1.5m');
    expect(big.choices.t6Detail.value).toBe('有（大）');
    const none = measuresToInitial(tree([tap(c, { height: { a: '1' } })]), c);
    expect(none.choices?.t6Detail).toBeUndefined();
  });

  it('2か所で(小)と(大)なら、重い方（設定の values の先の方）の「有（大）」', () => {
    const c = withTap();
    const two = measuresToInitial(tree([tap(c, { tapGrade: '(小)', height: { a: '1' } }), tap(c, { tapGrade: '(大)', height: { a: '2' } })]), c);
    expect(two.values.t6Detail).toBe('①(小)地上1m ②(大)地上2m');
    expect(two.choices.t6Detail.value).toBe('有（大）');
  });
});

describe('芯未達を選んだら文にも出す（flag の offText）', () => {
  const withOff = () => {
    const c = structuredClone(cfgJson);
    Object.assign(c.noteMeasures.parts.core, { required: ['幹', '根株'], offLabel: '芯未達', offText: '（芯未達）' });
    c.initialSurvey.detailParts.core = { ...(c.initialSurvey.detailParts.core || { type: 'flag', label: '芯達', text: '（芯達）' }), required: true, offLabel: '芯未達', offText: '（芯未達）' };
    return c;
  };
  it('簡易の1行：芯未達（false）なら「（芯未達）」、選んでいなければ何も付けない', () => {
    const c = withOff();
    expect(measureLine(c, 'decay', '幹', { height: { a: '1' }, core: false })).toBe('幹の腐朽：地上1m（芯未達）');
    expect(measureLine(c, 'decay', '幹', { height: { a: '1' }, core: true })).toBe('幹の腐朽：地上1m（芯達）');
    expect(measureLine(c, 'decay', '枝', { height: { a: '1' } })).toBe('枝の腐朽：地上1m');
  });
  it('奥行などがなくても、芯未達だけで出す', () => {
    expect(buildText({ core: false }, [{ name: 'core', type: 'flag', label: '芯達', text: '（芯達）', offText: '（芯未達）' }])).toBe('（芯未達）');
  });
  it('詳しい診断にも芯未達を写し、文に「（芯未達）」を出す', () => {
    const c = withOff();
    c.initialSurvey.forms.initial.sections[1].items.push({ key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'core'] });
    c.initialSurvey.fromMeasures.push({ kind: 'decay', place: '幹', item: 't2', parts: { height: 'height', core: 'core' } });
    const v = { height: { a: '1' }, core: false };
    const m = measureRecord('decay', '幹', v, measureLine(c, 'decay', '幹', v));
    const r = measuresToInitial({ notes: `・${m.line}`, measures: [m], measuresV: 2 }, c);
    expect(r.values.t2Detail).toBe('地上1m（芯未達）');
  });
  it('設定の確かめ：offText は flag の文字', () => {
    const c = withOff();
    c.noteMeasures.parts.height.offText = '未達';
    expect(validateConfig(c).errors.join()).toContain('offText');
  });
});
