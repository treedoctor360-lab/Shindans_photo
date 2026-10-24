// 本番の野帳アプリと同じドメイン（github.io）に置くので、端末内の置き場所が混ざらないことを確かめる
//  ・IndexedDB（端末内のデータベース）の名前が本番（'shindans'）と違う
//  ・オフライン用の控え（キャッシュ）の名前が 'shindans-' で始まらない（本番が古い控えとして消してしまうため）
//  ・データベースを丸ごと消す処理（deleteDatabase）や、全部消す処理（clear）をアプリの中で使っていない
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

describe('本番の野帳アプリと置き場所が混ざらない', () => {
  it('データベースの名前が本番と違う', () => {
    const name = read('src/store/idb.js').match(/const DB_NAME = '([^']+)'/)[1];
    expect(name).not.toBe('shindans');
  });
  it('オフライン用の控えの名前が shindans- で始まらない', () => {
    const prefix = read('public/sw.js').match(/const PREFIX = '([^']+)'/)[1];
    expect(prefix.startsWith('shindans-')).toBe(false);
  });
  it('アプリの中でデータベース・保存場所を丸ごと消していない', () => {
    const files = [...walk('src'), 'public/sw.js'].filter((f) => /\.(js|jsx)$/.test(f));
    for (const f of files) {
      const s = read(f);
      expect(s, f).not.toMatch(/deleteDatabase|\.clear\(\)|localStorage\.clear|storage\.clear/);
    }
  });
});
