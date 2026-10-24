// 弱点の詳細の文を、部品から組み立てるテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { buildDetail, partText, partsOf, rebuildDetail, setDetailText, setPart } from '../src/core/detailParts.js';

const cfg = structuredClone(cfgJson);
const b4 = cfg.initialSurvey.forms.initial.sections[1].items[0];

describe('部品の文', () => {
  it('種類ごとの書き方（全角の数字は半角に。空の部品は出さない）', () => {
    const P = cfg.initialSurvey.detailParts;
    expect(partText(P.count, '１')).toBe('1本');
    expect(partText(P.height, { a: '2' })).toBe('地上2m');
    expect(partText(P.height, { a: '0', b: '0.7' })).toBe('地上0～0.7m');
    expect(partText(P.size, [{ w: '10', h: '5' }, { w: '7', h: '7' }])).toBe('10×5cm、7×7cm（2箇所）');
    expect(partText(P.size, [{ w: '20', h: '40' }, {}])).toBe('20×40cm');
    expect(partText(P.branchDia, '18')).toBe('枝直径18cm');
    expect(partText(P.ratio, '＜1/3')).toBe('周囲長比＜1/3');
    expect(partText(P.name, ' 菌の名前 ')).toBe('菌の名前');
    expect(partText({ type: 'pair', label: 'x', unit: 'cm' }, { a: '35', b: '100' })).toBe('35cm/100cm');
    expect(partText(P.height, {})).toBe('');
    // 縦×横×奥行・数ごとに単位（設定 depth・unitEach）
    expect(partText({ type: 'size', label: 'x', depth: true, unitEach: true }, [{ w: '20', h: '50', d: '15' }])).toBe('20cm×50cm×15cm');
    expect(partText({ type: 'size', label: 'x', unitEach: true }, [{ w: '20', h: '50' }])).toBe('20cm×50cm');
    expect(partText({ type: 'size', label: 'x', depth: true }, [{ w: '20', h: '50' }])).toBe('20×50cm'); // 奥行が空なら2つだけ
    // 印（芯達など）：押してあるときだけ、前の文に続けて付ける
    expect(partText({ type: 'flag', label: '芯達', text: '（芯達）' }, true)).toBe('（芯達）');
    expect(partText({ type: 'flag', label: '芯達', text: '（芯達）' }, false)).toBe('');
  });

  it('項目の部品（parts）か、なければ既定の部品で、並び順につなぐ', () => {
    expect(partsOf(b4, cfg).map((p) => p.name)).toEqual(['count', 'height', 'branchDia', 'branchLen']);
    expect(partsOf({ key: 'x', type: 'weak' }, cfg).map((p) => p.name)).toEqual(['height', 'size', 'name']);
    expect(buildDetail({ count: '1', height: { a: '2' }, branchDia: '18', branchLen: '4' }, partsOf(b4, cfg), cfg)).toBe('1本、地上2m、枝直径18cm、枝長4m');
    // 印は「、」でつながず、前の文のすぐ後ろに付ける
    const parts = [
      { name: 'rod', type: 'pair', label: '鋼棒', unit: 'cm' },
      { name: 'core', type: 'flag', label: '芯達', text: '（芯達）' },
    ];
    expect(buildDetail({ rod: { a: '29', b: '50' }, core: true }, parts, cfg)).toBe('29cm/50cm（芯達）');
    expect(buildDetail({ core: true }, parts, cfg)).toBe('（芯達）');
    expect(buildDetail({ len: '1.5', core: true }, [{ name: 'len', type: 'number', label: '長さ', prefix: '長さ', unit: 'm' }, { name: 'core', type: 'flag', label: '芯達', text: '芯達', attach: false }], cfg)).toBe('長さ1.5m、芯達');
  });
});

describe('記録の詳細の文', () => {
  it('部品を変えると文を作り直す。手で直した後は上書きしない。作り直すと戻る', () => {
    let r = { b4: '有（小）' };
    r = setPart(r, b4, 'b4Detail', 'count', '1', cfg);
    r = setPart(r, b4, 'b4Detail', 'height', { a: '2' }, cfg);
    expect(r.b4Detail).toBe('1本、地上2m');
    r = setDetailText(r, 'b4Detail', '1本、地上2m付近');
    r = setPart(r, b4, 'b4Detail', 'branchLen', '4', cfg);
    expect(r.b4Detail).toBe('1本、地上2m付近'); // 手で直した文はそのまま
    r = rebuildDetail(r, b4, 'b4Detail', cfg);
    expect(r.b4Detail).toBe('1本、地上2m、枝長4m');
    expect(r.b4DetailManual).toBeUndefined();
  });
});

describe('設定の確かめ', () => {
  it('部品の定義の誤りを知らせる。部品は省略してもよい', () => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const bad = (fn) => {
      const c = structuredClone(cfgJson);
      fn(c.initialSurvey);
      return validateConfig(c).errors.join('\n');
    };
    expect(bad((s) => (s.detailParts.count.type = 'slider'))).toContain('initialSurvey.detailParts.count');
    expect(bad((s) => delete s.detailParts.ratio.options)).toContain('choice には options');
    expect(bad((s) => (s.detailParts.core = { type: 'flag', label: '芯達' }))).toContain('flag には text');
    expect(bad((s) => s.detailPartsDefault.push('nothing'))).toContain('detailPartsDefault');
    expect(bad((s) => (s.forms.initial.sections[0].items[0].parts = ['count']))).toContain('弱点の項目（weak）にだけ');
    expect(bad((s) => (s.forms.initial.sections[1].items[0].parts = ['nothing']))).toContain('.parts に、detailParts にない部品');
    expect(bad((s) => delete s.detailParts)).toContain('detailParts（部品の定義）が必要');
    expect(bad((s) => {
      delete s.detailParts;
      delete s.detailPartsDefault;
    })).toContain('detailParts（部品の定義）が必要'); // 項目の parts だけ残っている
    expect(bad((s) => {
      delete s.detailParts;
      delete s.detailPartsDefault;
      delete s.forms.initial.sections[1].items[0].parts;
      delete s.fromMeasures; // 寸法から写す先の数値もなくなるので、写す設定も外す
    })).toBe('');
  });
});

describe('自動で決まる値（周囲長から直径・芯達）', () => {
  it('周囲長から直径（既定は整数）。a が b の半分以上なら芯達', async () => {
    const { coreReached, diameterOf, withAuto } = await import('../src/core/detailParts.js');
    expect(diameterOf('157', 3.14)).toBe('50');
    expect(diameterOf('100', 3.14)).toBe('32'); // 既定は整数
    expect(diameterOf('100', 3.14, 1)).toBe('31.8');
    expect(diameterOf('', 3.14)).toBe('');
    expect(coreReached({ a: '25', b: '50' })).toBe(true); // ちょうど半径は芯達
    expect(coreReached({ a: '24.9', b: '50' })).toBe(false);
    expect(coreReached({ a: '25' })).toBeNull();
    const parts = [
      { name: 'rod', type: 'pair' },
      { name: 'core', type: 'flag', text: '（芯達）', coreFrom: 'rod' },
    ];
    expect(withAuto({ rod: { a: '29', b: '50' } }, parts, 'rod')).toEqual({ rod: { a: '29', b: '50' }, core: true });
    expect(withAuto({ rod: { a: '10', b: '50' }, core: true }, parts, 'rod').core).toBe(false);
    // 印を手で変えたときは決め直さない
    expect(withAuto({ rod: { a: '10', b: '50' }, core: true }, parts, 'core').core).toBe(true);
  });

  it('詳しい診断の数値を入れると、芯達の印と詳細の文が決まる。設定の形を確かめる', async () => {
    const { setPart } = await import('../src/core/detailParts.js');
    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.rod = { type: 'pair', label: '貫入深／直径', unit: 'cm', circ: '周囲長' };
    c.initialSurvey.detailParts.core.coreFrom = 'rod';
    const item = { key: 'r2', label: '鋼棒', type: 'weak', parts: ['rod', 'core'] };
    c.initialSurvey.forms.initial.sections[1].items.push(item);
    expect(validateConfig(c).errors).toEqual([]);
    const r = setPart({}, item, 'r2Detail', 'rod', { a: '29', b: '50', c: '157' }, c);
    expect(r.r2DetailParts.core).toBe(true);
    expect(r.r2Detail).toBe('29cm/50cm（芯達）');
    const bad = structuredClone(c);
    bad.initialSurvey.detailParts.core.coreFrom = 'height';
    expect(validateConfig(bad).errors.join('\n')).toContain('coreFrom');
  });
});

describe('比から決まる選択肢（pair の ratio）と、文に出さない欄（noText）', () => {
  it('周囲長／幹周を入れると周囲長比の選択肢が決まる。周囲長・幹周の数は詳細の文に出さない', async () => {
    const { ratioChoice, setPart } = await import('../src/core/detailParts.js');
    const r = { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3' };
    expect(ratioChoice({ a: '50', b: '150' }, r)).toBe('≧1/3'); // ちょうど1/3は「以上」
    expect(ratioChoice({ a: '49', b: '150' }, r)).toBe('＜1/3');
    expect(ratioChoice({ a: '50' }, r)).toBe('');

    const c = structuredClone(cfgJson);
    c.initialSurvey.detailParts.circ = { type: 'pair', label: '腐朽部分の周囲長／腐朽部位の幹周', unit: 'cm', noText: true, ratio: { ...r, to: 'ratio' } };
    const item = { key: 't2', label: '腐朽', type: 'weak', parts: ['height', 'circ', 'ratio', 'core'] };
    c.initialSurvey.forms.initial.sections[1].items.push(item);
    expect(validateConfig(c).errors).toEqual([]);
    let rec = setPart({}, item, 't2Detail', 'height', { a: '2' }, c);
    rec = setPart(rec, item, 't2Detail', 'circ', { a: '110', b: '150' }, c);
    expect(rec.t2DetailParts.ratio).toBe('≧1/3');
    expect(rec.t2Detail).toBe('地上2m、周囲長比≧1/3');
    // 選択肢を手で変えてもよい（周囲長を変えるまでは決め直さない）
    rec = setPart(rec, item, 't2Detail', 'ratio', '＜1/3', c);
    expect(rec.t2DetailParts.ratio).toBe('＜1/3');

    const bad = (fn) => {
      const x = structuredClone(c);
      fn(x.initialSurvey.detailParts.circ);
      return validateConfig(x).errors.join('\n');
    };
    expect(bad((p) => (p.ratio.to = 'height'))).toContain('ratio.to');
    expect(bad((p) => (p.ratio.ge = '≧1/2'))).toContain('ratio.to');
    expect(bad((p) => (p.ratio = { num: 1 }))).toContain('ratio');
    expect(bad((p) => (p.noText = 'yes'))).toContain('noText');
  });
});

describe('確認用の数（文に出さない欄・周囲長）', () => {
  it('確認用カルテ用に、文に出さない数と、直径を出すのに入れた周囲長を出す', async () => {
    const { checkNumbers, partText } = await import('../src/core/detailParts.js');
    const circ = { name: 'circ', type: 'pair', unit: 'cm', noText: true, ratio: { num: 1, den: 3, lt: '＜1/3', ge: '≧1/3' } };
    expect(partText(circ, { a: '110', b: '210' })).toBe(''); // 文には出さない
    const rod = { name: 'rod', type: 'pair', unit: 'cm', circ: '貫入部の周囲長' };
    expect(checkNumbers({ circ: { a: '110', b: '210' }, rod: { a: '15', b: '45', c: '141' } }, [circ, rod])).toEqual(['110cm/210cm', '貫入部の周囲長141cm']);
    expect(checkNumbers({}, [circ, rod])).toEqual([]);
  });
});

describe('数値の欄ができる前に書いた詳細の文', () => {
  it('数値を入れても、前に書いた文は消さない（手で直した扱いにする）', () => {
    const c = structuredClone(cfgJson);
    const item = c.initialSurvey.forms.initial.sections[1].items[0];
    const rec = setPart({ b4Detail: '前に書いた文' }, item, 'b4Detail', 'count', '2', c);
    expect(rec.b4Detail).toBe('前に書いた文');
    expect(rec.b4DetailManual).toBe(true);
    expect(rec.b4DetailParts).toEqual({ count: '2' });
    // 文が空なら今までどおり数値から作る
    expect(setPart({}, item, 'b4Detail', 'count', '2', c).b4Detail).toBe('2本');
  });
});
