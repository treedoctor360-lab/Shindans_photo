// ExcelJS が書き出したファイルの補正（ExcelJS の既知の落とし穴への対策）
//  xlsx ファイルの中身は、XML ファイルを ZIP でまとめたもの。JSZip で開いて XML を直接直す。

import JSZip from 'jszip';

// 罫線の色「自動」は ExcelJS が書き出さず、Excel で線が消える。色のない罫線に「自動」を付け直す
export function fixBorderXml(stylesXml) {
  return stylesXml.replace(/<(left|right|top|bottom|diagonal) style="([A-Za-z]+)"\/>/g, '<$1 style="$2"><color auto="1"/></$1>');
}

// 書き出し後の補正をまとめて行う
export async function finishXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('xl/styles.xml');
  if (f) zip.file('xl/styles.xml', fixBorderXml(await f.async('string')));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// 名前付き範囲（オートフィルターの範囲・印刷範囲・名前を付けた範囲など）を、元のファイルのとおりに戻す
//  ExcelJS は読み書きの途中で名前付き範囲を崩す（シートの指定が消える・式や外部の参照が壊れる・一部が消える）。
//  Excel で開くと「修復」になるので、シートの並びが元と同じファイルに限り、workbook.xml の definedNames を元の文字のまま入れ直す
export async function restoreDefinedNames(outBuffer, origBuffer) {
  const [zo, zn] = await Promise.all([JSZip.loadAsync(origBuffer), JSZip.loadAsync(outBuffer)]);
  const wbO = await zo.file('xl/workbook.xml').async('string');
  const wbN = await zn.file('xl/workbook.xml').async('string');
  const sheetsOf = (xml) => [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]).join('\n');
  if (sheetsOf(wbO) !== sheetsOf(wbN)) throw new Error('シートの並びが元のファイルと違うため、名前付き範囲を戻せません');
  const block = (xml) => (xml.match(/<definedNames>[\s\S]*?<\/definedNames>|<definedNames\/>/) || [''])[0];
  const orig = block(wbO);
  let fixed = wbN.replace(/<definedNames>[\s\S]*?<\/definedNames>|<definedNames\/>/, '');
  // 元にあれば、元と同じ場所（シートの一覧の後ろ）に入れる
  //  （置き換えは関数で行う。名前の中の「$1」などを置き換えの記号として読ませないため）
  if (orig) fixed = fixed.replace('</sheets>', () => `</sheets>${orig}`);
  zn.file('xl/workbook.xml', fixed);
  return zn.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// workbook.xml の名前付き範囲の部分（照合用。なければ空の文字）
export async function definedNamesXml(buffer) {
  const z = await JSZip.loadAsync(buffer);
  const xml = await z.file('xl/workbook.xml').async('string');
  return (xml.match(/<definedNames>[\s\S]*?<\/definedNames>/) || [''])[0];
}

// シートの並び順どおりに、中のファイル名（xl/worksheets/sheetN.xml）を返す
//  並び順と N は一致しないことがあるので、workbook.xml とその関連付け（rels）から対応を取る
export async function sheetFiles(zip) {
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const targets = {};
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
    const tg = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && tg) targets[id] = tg.replace(/^\/?(xl\/)?/, 'xl/');
  }
  return [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = (m[0].match(/\bname="([^"]+)"/) || [])[1];
    const rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
    return { name, file: targets[rid] };
  });
}

// 外部リンク（別のブックを参照する部品）を、元のファイルから戻す
//  ExcelJS は外部リンクの部品（xl/externalLinks/…）と workbook.xml の externalReferences を書き出さない。
//  すると「[1]シート!$A$1」のように外部のブックを指す名前付き範囲の参照先がなくなり、Excel で開くと「修復」になる。
//  元のファイルの外部リンクの部品・関連付け（rels）・ファイルの種類（[Content_Types].xml）をそのまま入れ直す
export async function restoreExternalLinks(outBuffer, origBuffer) {
  const [zo, zn] = await Promise.all([JSZip.loadAsync(origBuffer), JSZip.loadAsync(outBuffer)]);
  const wbO = await zo.file('xl/workbook.xml').async('string');
  const refs = wbO.match(/<externalReferences>[\s\S]*?<\/externalReferences>/);
  if (!refs) return outBuffer; // 元に外部リンクがなければ何もしない
  let wbN = await zn.file('xl/workbook.xml').async('string');
  if (/<externalReferences>/.test(wbN)) throw new Error('書き出したファイルに外部リンクが残っているため、戻し方が決められません');

  const relO = await zo.file('xl/_rels/workbook.xml.rels').async('string');
  let relN = await zn.file('xl/_rels/workbook.xml.rels').async('string');
  let ctN = await zn.file('[Content_Types].xml').async('string');
  const ctO = await zo.file('[Content_Types].xml').async('string');
  const usedIds = new Set([...relN.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
  const newId = () => {
    let n = 1;
    while (usedIds.has(`rIdExt${n}`)) n++;
    usedIds.add(`rIdExt${n}`);
    return `rIdExt${n}`;
  };

  // 元の並び（[1]・[2]…の番号は externalReference の並び順）を変えずに、関連付けの番号だけ付け直す
  const ids = [...refs[0].matchAll(/<externalReference\b[^>]*\br:id="([^"]+)"[^>]*\/>/g)].map((m) => m[1]);
  const newRefs = [];
  for (const id of ids) {
    const rel = [...relO.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => (r.match(/\bId="([^"]+)"/) || [])[1] === id);
    if (!rel) throw new Error(`元のファイルの外部リンク（${id}）の関連付けが見つかりません`);
    const target = (rel.match(/\bTarget="([^"]+)"/) || [])[1];
    const part = target.replace(/^\/?(xl\/)?/, 'xl/'); // 例 xl/externalLinks/externalLink1.xml
    const file = zo.file(part);
    if (!file) throw new Error(`元のファイルに外部リンクの部品（${part}）がありません`);
    zn.file(part, await file.async('uint8array'));
    const relsPart = part.replace(/([^/]+)$/, '_rels/$1.rels');
    const relsFile = zo.file(relsPart);
    if (relsFile) zn.file(relsPart, await relsFile.async('uint8array'));
    const nid = newId();
    relN = relN.replace('</Relationships>', () => rel.replace(/\bId="[^"]+"/, `Id="${nid}"`) + '</Relationships>');
    newRefs.push(`<externalReference r:id="${nid}"/>`);
    // ファイルの種類の登録（元の書き方のまま）
    const ov = [...ctO.matchAll(/<Override\b[^>]*>/g)].map((m) => m[0]).find((o) => o.includes(`PartName="/${part}"`));
    if (ov && !ctN.includes(`PartName="/${part}"`)) ctN = ctN.replace('</Types>', () => ov + '</Types>');
  }
  // 置く場所はシートの一覧の直後（名前付き範囲より前。Excel の決まった並び）
  wbN = wbN.replace('</sheets>', () => `</sheets><externalReferences>${newRefs.join('')}</externalReferences>`);
  zn.file('xl/workbook.xml', wbN);
  zn.file('xl/_rels/workbook.xml.rels', relN);
  zn.file('[Content_Types].xml', ctN);
  return zn.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// 外部リンクの部品の中身（照合用）：[{ part, xml }]（externalReference の並び順）
export async function externalLinkParts(buffer) {
  const z = await JSZip.loadAsync(buffer);
  const wb = await z.file('xl/workbook.xml').async('string');
  const rels = await z.file('xl/_rels/workbook.xml.rels').async('string');
  const refs = (wb.match(/<externalReferences>[\s\S]*?<\/externalReferences>/) || [''])[0];
  const out = [];
  for (const m of refs.matchAll(/\br:id="([^"]+)"/g)) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((r) => (r.match(/\bId="([^"]+)"/) || [])[1] === m[1]);
    const target = rel ? (rel.match(/\bTarget="([^"]+)"/) || [])[1] : '';
    const part = target ? target.replace(/^\/?(xl\/)?/, 'xl/') : '';
    out.push({ part, xml: part && z.file(part) ? await z.file(part).async('string') : null });
  }
  return out;
}
