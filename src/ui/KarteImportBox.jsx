// 記入済みの簡易診断カルテ（Excel。1本1シート）を読み込んで、木と写真にする（設定の画面。調査者だけ）
//  1. ファイルを選ぶ（いくつでも）→ シートを読み、木の数・写真の数・路線の候補を見せる（写真の中身はまだ読まない）
//  2. 「読み込む」→ 木を作る（src/core/karteImport.js。入力済み・番号の順・すでにある番号は読み込まない）
//  3. 貼ってある写真を1枚ずつ小さくして（長い辺 karte.photos.maxPx、既定 1000px）、その路線の「写真」に入れる。
//     木ごとに「番号の写真」の代わりの札（No.番号）を作り、写真は元の枠（全景・写真1…）と見出しのまま選んだ状態にする。
//     写真の大きいブックでも、写真は1枚ずつ取り出して小さくするので、まとめて読み込むより軽い
import { useRef, useState } from 'react';
import { openXlsx, rangeOf } from '../excel/xlsxRead.js';
import { isKarteSheet, readKarteCells, karteGroupChoices, karteImageSlots } from '../core/karteImport.js';
import { importKarte } from '../store/actions.js';
import { simpleKey } from '../store/surveys.js';
import { loadKPhotos, putKPhotoData, saveKPhotos } from '../store/kphotos.js';
import { readPhotoFile } from './photoFile.js';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
const pad = (n) => String(n).padStart(2, '0');
const localTime = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 「番号の写真」の代わりの札（白地に No.番号）
async function numberCard(treeNo) {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 400, 300);
  g.strokeStyle = '#7a4a14';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 380, 280);
  g.fillStyle = '#1b2420';
  g.textAlign = 'center';
  g.font = 'bold 96px sans-serif';
  g.fillText(`No.${treeNo}`, 200, 160);
  g.font = '32px sans-serif';
  g.fillText('カルテから', 200, 230);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
  return new File([blob], `No${treeNo}.jpg`, { type: 'image/jpeg' });
}

export default function KarteImportBox({ state, update, cfg, toast }) {
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState(null); // [{ file, read: [...], images: { シート名: [...] }, choices, pick, skip }]
  const [result, setResult] = useState(null);
  const books = useRef({}); // ファイル名 → 開いたブック（写真の中身を後で取り出す）
  const pc = cfg.karte?.photos;

  // 1. ファイルを選んだら、シートを読んで見せる
  const onFiles = async (files) => {
    setResult(null);
    const out = [];
    try {
      for (const [i, f] of [...files].entries()) {
        setBusy(`カルテを読んでいます… ${i + 1}／${files.length}（${f.name}）`);
        const book = await openXlsx(await f.arrayBuffer());
        books.current[f.name] = book;
        const read = [];
        const images = {};
        let blank = 0;
        let other = 0;
        const karte = [];
        for (const s of book.sheets) {
          const sh = await book.readSheet(s);
          if (isKarteSheet(sh.cells, cfg)) karte.push({ s, sh });
          else other += 1;
        }
        // 様式のままのシート（樹木番号が空）は木にせず、印字された文字を見分けるのに使う
        const printed = karte.find(({ sh }) => !readKarteCells(sh.cells, cfg).treeNo)?.sh.cells || {};
        for (const { s, sh } of karte) {
          const r = readKarteCells(sh.cells, cfg, printed);
          if (!r.treeNo) {
            blank += 1;
            continue;
          }
          read.push({ sheet: s.name, ...r });
          images[s.name] = sh.images;
        }
        const g = karteGroupChoices(state, cfg, read);
        out.push({ file: f.name, read, images, choices: g.choices, pick: g.pick, blank, other });
      }
      setPlan(out);
    } catch (e) {
      toast(`カルテを読めませんでした：${e.message || e}`);
    } finally {
      setBusy('');
    }
  };

  const setPick = (i, key) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, pick: key } : x)));

  // 2・3. 読み込む
  const run = async () => {
    const slots = (pc?.slots || []).map((s) => ({ ...s, r: rangeOf(s.range) }));
    const sum = { trees: 0, photos: 0, badPhotos: 0, skipped: [], check: [] };
    try {
      for (const p of plan) {
        const choice = p.choices.find((c) => c.key === p.pick);
        if (!choice || !p.read.length) continue;
        let stats;
        await update((cur) => {
          const r = importKarte(cur, cfg, p.read, choice.info, { file: p.file, now: Date.now() }); // その時点の最新の状態に足す
          stats = r.stats;
          return r.state;
        }, { now: true });
        sum.trees += stats.added.length;
        sum.skipped.push(...stats.skipped.map((s) => `${p.file} ${s}`));
        sum.check.push(...stats.check.map((c) => ({ ...c, file: p.file })));
        if (!pc || !stats.added.length) continue;
        // 写真：読み込んだ木の分だけ
        const store = await loadKPhotos(choice.key);
        const photos = [...store.photos];
        const picks = { ...store.picks };
        const total = stats.added.reduce((n, a) => n + (p.images[a.sheet]?.length || 0), 0);
        let done = 0;
        let clock = Date.now();
        const add = async (file, extra) => {
          const r = await readPhotoFile(file, { maxPx: pc.maxPx ?? 1000 });
          const id = `${Date.now().toString(36)}-${photos.length}-${Math.random().toString(36).slice(2, 8)}`;
          await putKPhotoData(id, { data: r.data, thumb: r.thumb });
          clock += 1000; // 取り込んだ順に並ぶよう、1秒ずつずらした時刻を撮影日時の代わりにする
          photos.push({ id, name: r.name, shotAt: localTime(clock), w: r.w, h: r.h, fromKarte: true, ...extra });
          return id;
        };
        for (const a of stats.added) {
          const imgs = p.images[a.sheet] || [];
          if (!imgs.length) continue;
          const treeKey = simpleKey(a.tree, cfg);
          const captions = p.read.find((r) => r.sheet === a.sheet)?.captions || {};
          await add(await numberCard(a.treeNo), { number: true, treeKey });
          const pick = {};
          for (const [n, x] of karteImageSlots(imgs, slots).entries()) {
            done += 1;
            setBusy(`写真を小さくしています… ${done}／${total}`);
            try {
              const bytes = await books.current[p.file].media(x.image.path);
              const name = `${a.sheet}_${x.slot || `写真${n + 1}`}.${x.image.ext}`;
              const id = await add(new File([bytes], name, { type: MIME[x.image.ext] || 'application/octet-stream' }));
              sum.photos += 1;
              const slot = slots.find((s) => s.key === x.slot);
              if (slot) pick[slot.key] = slot.full ? { id } : { id, caption: (slot.caption && captions[slot.caption]) || '' };
            } catch {
              sum.badPhotos += 1; // 読めない形の画像（図形・EMF など）
            }
          }
          picks[treeKey] = { ...(picks[treeKey] || {}), ...pick };
        }
        await saveKPhotos(choice.key, { photos, picks });
      }
      setResult(sum);
      setPlan(null);
      books.current = {}; // 開いたブック（ファイルの中身）を手放す
      toast(`${sum.trees}本を読み込みました` + (pc ? `（写真${sum.photos}枚）` : ''));
    } catch (e) {
      toast(`読み込みの途中で止まりました：${e.message || e}`);
    } finally {
      setBusy('');
    }
  };

  const ready = plan && plan.some((p) => p.read.length && p.choices.some((c) => c.key === p.pick));
  return (
    <div className="sec" data-testid="karte-import-sec">
      <h2>記入済みのカルテ（Excel）</h2>
      <label className={`btn big file-btn${busy ? ' disabled' : ''}`} aria-disabled={!!busy}>
        {busy || '記入済みのカルテ（Excel）を読み込む'}
        <input
          type="file"
          accept=".xlsx"
          multiple
          hidden
          disabled={!!busy}
          data-testid="karte-import-file"
          onChange={(e) => {
            const fs = [...(e.target.files || [])];
            e.target.value = '';
            if (fs.length) onFiles(fs);
          }}
        />
      </label>
      <p className="hint">
        Excel に直接打ち込んだカルテ（1本1シート）を、木として読み込みます（入力済み）。すでにある番号の木は読み込みません。{pc ? '貼ってある写真は小さくして、その路線の「写真」に入れます（元のファイルはそのまま）。' : ''}
      </p>
      {plan && (
        <div className="alert info" data-testid="karte-import-plan">
          {plan.map((p, i) => (
            <div key={p.file} data-testid="karte-import-file-plan">
              <b>{p.file}</b>：カルテ {p.read.length}本
              {pc ? `・写真 ${Object.values(p.images).reduce((n, x) => n + x.length, 0)}枚` : ''}
              {p.blank ? `（様式のままのシート ${p.blank}枚は除く）` : ''}
              {p.read.length > 0 &&
                (p.choices.length ? (
                  <label className="row">
                    路線：
                    <select value={p.pick} onChange={(e) => setPick(i, e.target.value)} data-testid="karte-import-group">
                      <option value="">選んでください</option>
                      {p.choices.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span>：路線の一覧に合う路線がありません（路線番号を確かめてください）</span>
                ))}
            </div>
          ))}
          <div className="acts">
            <button type="button" className="btn" onClick={() => { setPlan(null); books.current = {}; }} disabled={!!busy}>
              やめる
            </button>
            <button type="button" className="btn fill" onClick={run} disabled={!ready || !!busy} data-testid="karte-import-run">
              読み込む
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="alert info" data-testid="karte-import-result">
          <span>
            読み込んだ木：{result.trees}本{pc ? `・写真 ${result.photos}枚` : ''}
          </span>
          {result.badPhotos > 0 && <span>読めない形の画像が {result.badPhotos}枚ありました（入れていません）</span>}
          {result.skipped.length > 0 && <span>すでにある番号のため読み込まなかったシート：{result.skipped.join('、')}</span>}
          {result.check.length > 0 && (
            <span>
              確かめる木（入力中のままにしました。一覧の「入力表で止まった木」で探せます）：
              {result.check.map((c) => `${c.sheet}：${c.why.join('／')}`).join('　')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
