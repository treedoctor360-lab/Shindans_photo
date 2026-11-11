// 木の位置（設定 location）のテスト
import { describe, expect, it } from 'vitest';
import cfgJson from './fixtures/sample-config.json';
import { validateConfig } from '../src/core/config.js';
import { clearLoc, goodFix, hasLoc, locText, withLoc } from '../src/core/location.js';
import { columns } from '../src/excel/listColumns.js';

const TILE = { label: '架空の地図', url: 'https://tiles.example.invalid/{z}/{x}/{y}.png', attribution: '架空の出典' };
const withLocation = (location) => ({ ...structuredClone(cfgJson), location });

describe('木の位置', () => {
  it('入れる・消す・画面の1行', () => {
    const t = withLoc({ treeNo: '1' }, { lat: 34.1234567, lng: 135.7654321, acc: 7.6, at: '2099-01-02T03:04:05Z' }, 'gps');
    expect(t).toMatchObject({ lat: 34.123457, lng: 135.765432, locAcc: 8, locSrc: 'gps', locAt: '2099-01-02T03:04:05Z' });
    expect(hasLoc(t)).toBe(true);
    expect(locText(t)).toBe('34.123457, 135.765432（GPS ±8m）');
    const m = withLoc(t, { lat: 34.2, lng: 135.1 }, 'map', 'now');
    expect(m).toMatchObject({ locAcc: '', locSrc: 'map', locAt: 'now' });
    expect(locText(m)).toBe('34.200000, 135.100000（地図で置いた位置）');
    expect(hasLoc(clearLoc(m))).toBe(false);
    expect(hasLoc({ lat: '', lng: '' })).toBe(false);
  });

  it('保存のときに自動で入れるのは精度が上限以内のときだけ（既定 30m）', () => {
    const cfg = withLocation({ tiles: [TILE] });
    expect(goodFix({ lat: 1, lng: 2, acc: 30 }, cfg)).toBe(true);
    expect(goodFix({ lat: 1, lng: 2, acc: 31 }, cfg)).toBe(false);
    expect(goodFix({ lat: 1, lng: 2, acc: 80 }, withLocation({ tiles: [TILE], autoMaxAcc: 100 }))).toBe(true);
    expect(goodFix(null, cfg)).toBe(false);
  });

  it('設定の確かめ', () => {
    expect(validateConfig(withLocation({ auto: true, start: { lat: 34, lng: 135, zoom: 14 }, tiles: [TILE] })).errors).toEqual([]);
    const bad = (loc) => validateConfig(withLocation(loc)).ok;
    expect(bad({ tiles: [] })).toBe(false);
    expect(bad({ tiles: [{ ...TILE, url: 'http://x/{z}/{x}/{y}' }] })).toBe(false);
    expect(bad({ tiles: [{ ...TILE, url: 'https://x/{z}/{x}' }] })).toBe(false);
    expect(bad({ tiles: [{ ...TILE, attribution: '' }] })).toBe(false);
    expect(bad({ tiles: [TILE], start: { lat: 99, lng: 0 } })).toBe(false);
    expect(bad({ tiles: [TILE], autoMaxAcc: 0 })).toBe(false);
    // 計測に足す欄は、位置の項目の名前を使えない
    expect(validateConfig({ ...structuredClone(cfgJson), extraFields: [{ key: 'lat', label: '緯度' }] }).ok).toBe(false);
  });

  it('一覧表形式の見出し：緯度・経度', () => {
    const cfg = structuredClone(cfgJson);
    cfg.dbFormat.columns = { ...cfg.dbFormat.columns, lat: '^緯度$', lng: '^経度$' };
    cfg.dbFormat.writeKeys = [...cfg.dbFormat.writeKeys, 'lat', 'lng'];
    const cols = columns(cfg, cfg.dbFormat.sheets[0].type, null, []);
    expect(cols.slice(-2)).toEqual([
      ['lat', '緯度'],
      ['lng', '経度'],
    ]);
  });
});
