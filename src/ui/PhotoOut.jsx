// 出力画面の「写真」：送信の状態と、納品の形（公園・路線ごとのフォルダ）の ZIP 出力
//  ZIP に入れるのは、各木の「撮る写真」の枠の、撮り直していない最新の1枚だけ
//  ZIP を作った後に読み直して、入れた写真の名前・大きさ・中身が元と同じことを確かめる（違えば保存しない）
import { useState } from 'react';
import JSZip from 'jszip';
import { groupLabel, groupKeys, treesOfGroup } from '../core/groups.js';
import { photoPlan } from '../core/photo.js';
import { currentPhotos, sizeText, unsentPhotos } from '../core/photoShots.js';
import { toHalf } from '../core/text.js';
import { photoBytes } from '../store/photos.js';
import { simpleKey } from '../store/surveys.js';

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();

// ZIP に入れる写真の一覧と、まだ撮っていない写真の一覧
export function photoPack(state, cfg, keys) {
  const files = [];
  const missing = [];
  for (const gk of keys) {
    const folder = safe(groupLabel(state.trees, gk, cfg)) || '場所なし';
    for (const t of treesOfGroup(state.trees, gk, cfg)) {
      if (t.deleted || !t.done || t.source !== 'app') continue;
      const plan = photoPlan(t, cfg);
      const cur = currentPhotos(state.photos, simpleKey(t, cfg));
      for (const slot of plan.slots) {
        const p = cur[slot.key];
        if (p) files.push({ path: `写真/${folder}/${safe(p.name)}.jpg`, photo: p });
        else missing.push(`${toHalf(t.treeNo) || '(番号なし)'} ${slot.name}`);
      }
    }
  }
  return { files, missing };
}

const sameBytes = (a, b) => {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

function download(filename, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function PhotoOut({ state, config: cfg, group, photoStatus, persisted, toast, yymmdd }) {
  const [busy, setBusy] = useState('');
  const [report, setReport] = useState(null); // { errors, missing }
  const [all, setAll] = useState(false);
  const photos = state.photos || [];
  const unsent = unsentPhotos(photos);
  const current = photos.filter((p) => !p.retired);

  const onZip = async () => {
    setBusy('zip');
    setReport(null);
    try {
      const keys = all ? groupKeys(state.trees, cfg) : [group];
      const pack = photoPack(state, cfg, keys);
      if (!pack.files.length) throw new Error('ZIP に入れる写真がありません（入力済みの木の写真がまだありません）');
      const zip = new JSZip();
      const bytesOf = {};
      for (const f of pack.files) {
        setBusy(`zip:${Object.keys(bytesOf).length + 1}/${pack.files.length}`);
        const b = await photoBytes(state.server, f.photo);
        bytesOf[f.path] = b;
        zip.file(f.path, b);
      }
      const out = await zip.generateAsync({ type: 'arraybuffer' });
      // 読み直して確かめる
      const back = await JSZip.loadAsync(out);
      const errors = [];
      const names = Object.keys(back.files).filter((n) => !back.files[n].dir);
      if (names.length !== pack.files.length) errors.push(`ZIP の写真の数が違います（${names.length}枚／${pack.files.length}枚）`);
      for (const f of pack.files) {
        const e = back.file(f.path);
        if (!e) errors.push(`${f.path} が ZIP にありません`);
        else if (!sameBytes(await e.async('arraybuffer'), bytesOf[f.path])) errors.push(`${f.path} の中身が元の写真と違います`);
      }
      if (errors.length) return setReport({ errors, missing: pack.missing });
      const label = all ? 'すべて' : safe(groupLabel(state.trees, group, cfg));
      download(`写真_${label}_${yymmdd()}.zip`, out);
      toast(`写真 ${pack.files.length}枚を ZIP に出しました（検査済み）`);
      setReport({ errors: [], missing: pack.missing });
    } catch (e) {
      setReport({ errors: [e.message || String(e)], missing: [] });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="sec" data-testid="photo-out">
      <h2>写真</h2>
      <div className="lbl" data-testid="photo-status">
        撮った写真 {current.length}枚 ／ この端末の未送信 {unsent.length}枚
      </div>
      {photoStatus?.error && <div className="alert warn">写真を送れませんでした：{photoStatus.error}（写真は端末に残っています）</div>}
      {persisted === false && (
        <div className="alert warn" data-testid="persist-warn">
          このブラウザは、端末の空きが少なくなるとデータを消すことがあります。写真はこまめに送信し、スマホはホーム画面に追加したアプリから使ってください。
        </div>
      )}
      <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="photo-all" />
        すべての公園・路線をまとめて出す
      </label>
      <button type="button" className="btn big" disabled={!!busy} onClick={onZip} data-testid="photo-zip">
        {busy.startsWith('zip') ? `ZIP を作成中… ${busy.slice(4)}` : `写真を ZIP で出す（${all ? 'すべて' : groupLabel(state.trees, group, cfg)}）`}
      </button>
      <p className="hint">公園・路線ごとのフォルダに分けて入れます。入れるのは入力済みの木の、撮る写真の枠ごとに最新の1枚です（撮り直す前の写真はサーバーに残っています）。</p>
      {report && (
        <div className={`alert ${report.errors.length ? 'danger' : 'info'}`} data-testid="photo-report">
          <span>
            {report.errors.length ? `ZIP を保存しませんでした：${report.errors.join('／')}` : 'ZIP を検査して保存しました。'}
            {report.missing.length > 0 && ` まだ撮っていない写真：${report.missing.slice(0, 10).join('、')}${report.missing.length > 10 ? `ほか（全${report.missing.length}枚）` : ''}`}
          </span>
        </div>
      )}
      <p className="hint">1枚の大きさの目安：{sizeText((cfg.photo?.camera?.maxKB || 100) * 1024)}</p>
    </div>
  );
}

