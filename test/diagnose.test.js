// 調べるためのデータの書き出しのテスト
import { describe, expect, it } from 'vitest';
import { initialState, migrate } from '../src/store/state.js';
import { diagnosticDump } from '../src/store/diagnose.js';

describe('調べるためのデータ', () => {
  it('合言葉は書き出さず、URL は途中を伏せる。端末の状態はそのまま入る', () => {
    const s = { ...migrate(initialState()), trees: [{ id: 'a', treeNo: 'AB001' }], server: { url: 'https://script.google.com/macros/s/ABCDEFG123/exec', pass: 'ひみつ', deviceId: 'd1', lastSeq: 5 } };
    const d = diagnosticDump(s, { version: 6 }, '0.2.0', 'now');
    expect(d).toMatchObject({ kind: 'shindans-photo-diagnostic', at: 'now', appVersion: '0.2.0', configVersion: 6 });
    expect(d.state.server).toEqual({ url: 'https://script.google.com/macros/s/…/exec', deviceId: 'd1', lastSeq: 5 });
    expect(JSON.stringify(d)).not.toContain('ひみつ');
    expect(d.state.trees).toEqual(s.trees);
    expect(s.server.pass).toBe('ひみつ'); // 元の状態は変えない
  });
});
