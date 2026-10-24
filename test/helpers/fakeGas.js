// テスト用の「にせの Google」：gas/Code.js をそのまま Node で動かすための代わりの部品
//  スプレッドシート・スクリプトのプロパティ・Drive・ロックを、メモリの中で真似る
import fs from 'node:fs';
import vm from 'node:vm';

// bound: スクリプトがスプレッドシートに付いているか（false なら getActiveSpreadsheet が null を返す）
export function makeFakeGas({ passphrase = 'ひみつ', bound = true } = {}) {
  const props = new Map(passphrase ? [['PASSPHRASE', passphrase]] : []);
  const sheets = new Map();
  const files = new Map();
  let fileSeq = 0;
  let lockHeld = false;

  // シート：二次元の配列で持つ
  const makeSheet = () => {
    const cells = [];
    const api = {
      cells,
      getLastRow: () => cells.length,
      getMaxRows: () => Math.max(1000, cells.length),
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') return { setNumberFormat: () => {} };
        const [row, col, nRows, nCols] = [a, b, c ?? 1, d ?? 1];
        return {
          setNumberFormat: () => {},
          setValues: (vals) => {
            for (let i = 0; i < nRows; i++) {
              while (cells.length < row + i) cells.push([]);
              for (let j = 0; j < nCols; j++) cells[row + i - 1][col - 1 + j] = vals[i][j];
            }
          },
          getValues: () => Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, j) => cells[row + i - 1]?.[col - 1 + j] ?? '')),
        };
      },
      setFrozenRows: () => {},
    };
    return api;
  };

  // フォルダ：名前と子のフォルダを持つ（写真の置き場所を確かめるため、ファイルには置いたフォルダの道筋を付ける）
  const folders = new Map();
  const makeFolder = (name, path = name) => {
    const id = `folder${folders.size + 1}`;
    const kids = new Map();
    const fo = {
      getId: () => id,
      getName: () => name,
      path,
      createFile: (blob) => makeFile(blob.bytes, blob.name, path),
      createFolder: (n) => {
        const k = makeFolder(n, `${path}/${n}`);
        kids.set(n, k);
        return k;
      },
      getFoldersByName: (n) => {
        let done = !kids.has(n);
        return { hasNext: () => !done, next: () => ((done = true), kids.get(n)) };
      },
    };
    folders.set(id, fo);
    return fo;
  };

  const makeFile = (bytes, name, folder = '') => {
    const id = `file${++fileSeq}`;
    const f = {
      bytes,
      name,
      folder,
      trashed: false,
      getSize: () => bytes.length,
      getId: () => id,
      getName: () => name,
      getLastUpdated: () => new Date('2099-01-01T00:00:00Z'),
      getBlob: () => ({ getBytes: () => [...bytes] }),
      setTrashed: (v) => (f.trashed = v),
      getParents: () => ({ hasNext: () => false }),
    };
    files.set(id, f);
    return f;
  };

  const ss = {
    getId: () => 'ss',
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => {
      const s = makeSheet();
      sheets.set(n, s);
      return s;
    },
  };

  const context = {
    module: { exports: {} },
    JSON,
    String,
    Date,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (lockHeld) throw new Error('ロック中');
          lockHeld = true;
        },
        releaseLock: () => (lockHeld = false),
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (bound ? ss : null),
      openById: (id) => {
        if (id !== 'ss') throw new Error('スプレッドシートがありません');
        return ss;
      },
    },
    DriveApp: {
      getFileById: (id) => {
        if (id === 'ss') return makeFile(new Uint8Array(), 'ss');
        if (!files.has(id)) throw new Error('ファイルがありません');
        return files.get(id);
      },
      getFolderById: (id) => {
        if (!folders.has(id)) throw new Error('フォルダがありません');
        return folders.get(id);
      },
      getRootFolder: () => ({ createFolder: (n) => makeFolder(n) }),
    },
    Utilities: {
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes: Uint8Array.from(bytes), name }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../../gas/Code.js', import.meta.url), 'utf8'), context);

  // ブラウザの fetch の代わり：doPost に渡して、返事を Response の形で返す
  const fetchFn = async (url, init) => {
    const out = context.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(out.text) };
  };
  return { context, fetchFn, props, sheets, files, folders, lib: context.module.exports };
}
