// テスト用の架空の「前回の診断カルテ」の PDF（test/fixtures/karte-sample.pdf）を作る
//  実在の番号・地名・様式の言葉は使わない。見出しは test/fixtures/sample-config.json の previous.kartes に合わせる。
//  Excel のカルテを印刷した PDF の癖を入れる：
//   ・見出しと値が1つの文字にくっついている（「架空公園 木の番号」）
//   ・「□無」「■有」が別々の文字
//   ・部位の見出しが部位の行の真ん中にある（1字）。縦書きの見出し（1字ずつ縦に並ぶ）
//   ・2行にまたがる見出しが、上下の行の真ん中にある。折り返した所見が、見出しの行をはさんで上下にある
//   ・写真が上下2つに分かれて入っている。写真の見出しが写真の真ん中の上にある
//   ・カルテでないページ
//
// 作り直すときだけ使う（日本語の字の形が要るため、IPA ゴシックなどの日本語の字の形のファイルを指定する）：
//   node test/helpers/makeKartePdf.mjs /usr/share/fonts/opentype/ipafont-gothic/ipag.ttf
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { TINY_JPEG } from './makeKarte.js';

const fontPath = process.argv[2];
if (!fontPath) throw new Error('日本語の字の形のファイル（.ttf）を指定してください');

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(fs.readFileSync(fontPath), { subset: true });
const jpg = await doc.embedJpg(new Uint8Array(TINY_JPEG)); // Buffer のままだと読めないことがあるため、ただのバイト列にする
const A4 = [595, 842];

const put = (page, text, x, y, size = 8) => page.drawText(text, { x, y, size, font });
const vertical = (page, text, x, yTop, step = 11) => [...text].forEach((ch, i) => put(page, ch, x, yTop - i * step));
const check = (page, y, yes) => {
  put(page, yes ? '□無' : '■無', 207, y);
  put(page, yes ? `■${yes}` : '□有', 228, y);
  put(page, '[', 318, y);
  put(page, ']', 343, y);
};

// 1ページ目：前回の詳しい診断
{
  const p = doc.addPage(A4);
  put(p, '前回の詳しい診断', 40, 806, 10);
  put(p, '調べた日： 2099年4月5日', 250, 806);
  put(p, '調べた人： 試験 一郎', 400, 806);
  vertical(p, '基本情報', 30, 790);
  put(p, '場所コード', 50, 780);
  put(p, 'K01', 110, 780);
  put(p, '架空公園 木の番号', 150, 780);
  put(p, 'AB001', 300, 780);
  put(p, '全体の写真', 470, 780);
  put(p, '木の種類', 50, 768);
  put(p, 'テストノキ', 110, 768);
  put(p, '植えた年', 50, 756);
  put(p, '1990', 110, 756);
  put(p, '手入れ', 50, 744);
  put(p, '毎年', 110, 744);

  // 枝（見出しは真ん中の行）
  put(p, '①枯れ枝', 86, 600);
  check(p, 600);
  put(p, '②腐朽', 86, 588);
  check(p, 588, '有（小）');
  put(p, 'C', 330, 588);
  put(p, '地上2m、10×5cm', 353, 588);
  put(p, '③亀裂', 86, 576);
  check(p, 576);
  put(p, '枝', 54, 588);
  put(p, '弱点の図', 455, 600);
  // 幹
  put(p, '①空洞', 86, 560);
  check(p, 560);
  put(p, '②腐朽', 86, 548);
  check(p, 548, '有(大)');
  put(p, 'D', 330, 548);
  put(p, '芯達', 353, 548);
  put(p, '③亀裂', 86, 536);
  check(p, 536);
  put(p, '幹', 54, 548);
  // 根
  put(p, '①腐朽', 86, 520);
  check(p, 520);
  put(p, '②鋼棒', 86, 508);
  check(p, 508, '有');
  put(p, '18/28cm', 353, 508);
  put(p, '③揺れ', 86, 496);
  check(p, 496);
  put(p, '根', 54, 508);
  vertical(p, '弱点', 36, 560, 14);

  // 評価：2行にまたがる見出し（上下の行の真ん中）と、折り返した所見
  put(p, '生育', 109, 460);
  put(p, 'B', 176, 460);
  put(p, '見た目の評価', 40, 454);
  put(p, '危険度', 109, 448);
  put(p, 'D', 176, 448);
  put(p, '(理由)', 225, 448);
  put(p, '前回より', 207, 426);
  put(p, 'まとめ', 34, 420);
  put(p, 'C', 133, 420);
  put(p, '飾り', 179, 420);
  put(p, '悪化している。', 207, 415);

  // 写真：全体の写真（上下2つに分かれている）と、弱点の図
  p.drawImage(jpg, { x: 444, y: 660, width: 114, height: 116 });
  p.drawImage(jpg, { x: 444, y: 646, width: 114, height: 14 });
  p.drawImage(jpg, { x: 443, y: 520, width: 116, height: 75 });
}

// 2ページ目：周りの様子（写真の名前は写真の下の文字。部位は縦書き）
{
  const p = doc.addPage(A4);
  put(p, '周りの様子', 181, 782, 10);
  put(p, '木の番号', 155, 759);
  put(p, 'AB001', 328, 759);
  put(p, '場所コード', 149, 742);
  put(p, 'K01', 329, 742);
  put(p, '架空公園', 429, 742);
  put(p, '配置の図', 149, 720);
  put(p, '周りの写真', 386, 720);
  p.drawImage(jpg, { x: 57, y: 556, width: 237, height: 159 });
  p.drawImage(jpg, { x: 305, y: 556, width: 227, height: 159 });
  put(p, '北側から', 350, 545);
  put(p, '人の通り', 105, 410);
  check(p, 410, '有');
  put(p, '歩行者', 420, 410);
  put(p, '建物', 105, 398);
  check(p, 398);
  put(p, '車', 105, 386);
  check(p, 386);
  vertical(p, 'まわり', 62, 410, 12);
  put(p, '土地の使われ方', 105, 340);
  put(p, '住宅地', 375, 340);
}

// 3ページ目：カルテでないページ
{
  const p = doc.addPage(A4);
  put(p, 'メモ', 40, 800, 10);
}

const out = new URL('../fixtures/karte-sample.pdf', import.meta.url);
fs.writeFileSync(out, await doc.save());
console.log('作りました：', out.pathname);
