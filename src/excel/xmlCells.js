// シートの XML（xl/worksheets/sheetN.xml）のセルに、値を直接書き込む道具
//
// ExcelJS でブック全体を読み込んで書き出すと、入力規則（ドロップダウン）が二重になるなど、
// 書き込んでいない所まで作りが変わってしまう。別の仕組み（マクロなど）が読むブックでは、それが困るので、
// 書き込むセルの XML だけを書き換え、ほかの部分は1文字も変えない。
//
//  - セルの書式（s="…"）はそのまま残す
//  - 文字は「そのセルに直接書く形」（inlineStr）で入れる。共有の文字の表（sharedStrings.xml）には触らない
//  - 式の入ったセルには書かない（誤りにする）。replaceFormula: true を付けた書き込みだけ、式を値に置き換える
//  - style（書式の番号）を付けた書き込みは、その書式にする。keepValue: true なら値（式）は変えず、書式だけ変える

// 列の文字 → 番号（A=1, Z=26, AA=27）
export function colNumber(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// セルの番地 "AB12" → { col: 'AB', row: 12 }
export function splitAddress(addr) {
  const m = String(addr).match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`セルの番地が正しくありません：${addr}`);
  return { col: m[1], row: Number(m[2]) };
}

// XML に入れる文字の置き換え（< > & " と、XML で使えない制御文字）
const escapeXml = (s) =>
  String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// 1つのセルの XML を作る（書式の番号 style があれば残す）
function cellXml(addr, value, style) {
  const s = style != null ? ` s="${style}"` : '';
  if (value === '' || value == null) return `<c r="${addr}"${s}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${addr} に入れる数が正しくありません：${value}`);
    return `<c r="${addr}"${s}><v>${value}</v></c>`;
  }
  // 前後の空白・改行を残すため xml:space="preserve" を付ける
  return `<c r="${addr}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

// 行の中身（<c …>…</c> の並び）に、セルを入れる／置き換える
//  返す形：書き換えた行の中身
function setInRow(inner, addr, value, replaceFormula = false, styleOverride = null, keepValue = false) {
  const want = colNumber(splitAddress(addr).col);
  // <c r="X1" …/> または <c r="X1" …>…</c>
  const re = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(inner))) {
    const r = (m[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
    if (!r) throw new Error(`番地のないセルがあるため書き込めません（${addr} の行）`);
    const n = colNumber(r);
    if (n === want) {
      const style = styleOverride ?? (m[1].match(/\bs="(\d+)"/) || [])[1];
      if (keepValue) {
        // 値・式はそのまま、書式の番号だけ置き換える
        const attrs = m[1].replace(/\s+s="\d+"/, '') + (style != null ? ` s="${style}"` : '');
        return inner.slice(0, m.index) + `<c${attrs}${m[2]}` + inner.slice(m.index + m[0].length);
      }
      if (/<f\b/.test(m[3] || '') && !replaceFormula) throw new Error(`${addr} には式が入っているため書き込みません`);
      return inner.slice(0, m.index) + cellXml(addr, value, style) + inner.slice(m.index + m[0].length);
    }
    if (n > want) return inner.slice(0, m.index) + cellXml(addr, keepValue ? '' : value, styleOverride) + inner.slice(m.index); // 列の順に入れる
  }
  return inner + cellXml(addr, keepValue ? '' : value, styleOverride);
}

// シートの XML に、まとめて書き込む
//  edits：[{ addr: 'F10', value: 'AB001' }, …]
//  返す形：書き換えた XML
export function setCells(sheetXml, edits) {
  const byRow = new Map();
  for (const e of edits) {
    const { row } = splitAddress(e.addr);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(e);
  }
  const start = sheetXml.indexOf('<sheetData');
  if (start < 0) throw new Error('シートの中身（sheetData）が見つかりません');
  let xml = sheetXml;
  // <sheetData/>（空のシート）は、中身を入れられる形にする
  xml = xml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');

  for (const [row, list] of [...byRow].sort((a, b) => a[0] - b[0])) {
    const open = xml.indexOf('<sheetData');
    const dataStart = xml.indexOf('>', open) + 1;
    const dataEnd = xml.indexOf('</sheetData>', dataStart);
    const data = xml.slice(dataStart, dataEnd);
    // その行：<row r="10" …>…</row> または <row r="10" …/>
    const rowRe = new RegExp(`<row\\b[^>]*?\\br="${row}"[^>]*?(\\/>|>([\\s\\S]*?)<\\/row>)`);
    const m = data.match(rowRe);
    let next;
    if (m) {
      const head = m[0].slice(0, m[0].indexOf('>') + 1).replace(/\/>$/, '>');
      let inner = m[1] === '/>' ? '' : m[2];
      for (const e of list) inner = setInRow(inner, e.addr, e.value, e.replaceFormula, e.style, e.keepValue);
      next = data.slice(0, m.index) + head + inner + '</row>' + data.slice(m.index + m[0].length);
    } else {
      // 行がなければ、行の番号の順になる位置に足す
      let inner = '';
      for (const e of [...list].sort((a, b) => colNumber(splitAddress(a.addr).col) - colNumber(splitAddress(b.addr).col)))
        inner = setInRow(inner, e.addr, e.value, e.replaceFormula, e.style, e.keepValue);
      const rowXml = `<row r="${row}">${inner}</row>`;
      let at = data.length;
      for (const rm of data.matchAll(/<row\b[^>]*?\br="(\d+)"/g)) {
        if (Number(rm[1]) > row) {
          at = rm.index;
          break;
        }
      }
      next = data.slice(0, at) + rowXml + data.slice(at);
    }
    xml = xml.slice(0, dataStart) + next + xml.slice(dataEnd);
  }
  return xml;
}
