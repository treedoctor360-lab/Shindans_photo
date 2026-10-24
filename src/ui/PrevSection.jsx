// 設定画面の「前回の調査」欄：前回のカルテ（Excel・PDF）をまとめて読み込む（事務所の PC 用）
//  何百ファイルでも、まとめて選ぶ（またはフォルダごと選ぶ）だけでよい。
//  読み込んだ要点と写真は、この端末に置き、「サーバーに置く」でスマホに渡す。元の Excel・PDF はサーバーに上げない
import { useState } from 'react';
import { karteSpecs, readKarteBook } from '../excel/karte.js';
import { readKartePdf } from '../excel/kartePdf.js';
import { buildPrevious, clearPrevious, loadAllPrevious, prevCount, savePrevious } from '../store/previous.js';
import { compressPhoto } from './compressPhoto.js';
import { usePrevIndex } from './usePrevious.js';

// 複数ファイルを選ぶボタン（folder=true ならフォルダごと）
function FilesButton({ label, folder, onFiles, disabled, testId }) {
  return (
    <label className={`btn big file-btn${disabled ? ' disabled' : ''}`} aria-disabled={disabled}>
      {label}
      <input
        type="file"
        multiple
        accept=".xlsx,.xlsm,.pdf"
        hidden
        disabled={disabled}
        data-testid={testId}
        {...(folder ? { webkitdirectory: '' } : {})}
        onChange={(e) => {
          const fs = [...(e.target.files || [])].filter((f) => /\.(xls[xm]|pdf)$/i.test(f.name) && !f.name.startsWith('~$'));
          e.target.value = '';
          if (fs.length) onFiles(fs);
        }}
      />
    </label>
  );
}

export default function PrevSection({ config: cfg, toast }) {
  const index = usePrevIndex();
  const [progress, setProgress] = useState('');
  const [problems, setProblems] = useState([]);
  const label = cfg?.previous?.label || '前回';
  const specs = cfg ? karteSpecs(cfg) : [];
  const can = specs.length > 0;
  const [askClear, setAskClear] = useState(false);

  const onFiles = async (files) => {
    const all = [];
    const bad = [];
    const skipped = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`読み込み中 ${i + 1} / ${files.length}：${files[i].name}`);
        try {
          // Excel も PDF（Excel のカルテを印刷したもの）も、同じ形で読む
          const read = /\.pdf$/i.test(files[i].name) ? readKartePdf : readKarteBook;
          const r = await read(await files[i].arrayBuffer(), cfg, files[i].name);
          // 写真は小さくしてから持つ（スマホに入れる量を減らす）
          for (const t of r.trees) t.photos = await Promise.all(t.photos.map((p) => compressPhoto(p)));
          all.push(...r.trees);
          skipped.push(...r.skipped);
        } catch (e) {
          bad.push(`${files[i].name}：${e.message || '読めませんでした'}`);
        }
      }
      if (!all.length) {
        setProblems(bad);
        toast('カルテが見つかりませんでした（樹木番号の欄があるシートがありません）');
        return;
      }
      setProgress('端末に保存中…');
      // 前に読み込んだ分に足す（同じ木・同じ種類のカルテは、今回の方に入れ替える）
      const p = buildPrevious(all, new Date().toISOString(), specs.map((x) => x.id), await loadAllPrevious());
      await savePrevious(p);
      const nPhotos = all.reduce((n, t) => n + t.photos.length, 0);
      const kinds = specs.map((x) => [x.title || x.id, all.filter((t) => t.kind === x.id).length]).filter(([, n]) => n);
      setProblems([...bad, ...(p.duplicates.length ? [`同じ木のカルテが2つ以上（後から読んだ方を使います）：${p.duplicates.join('・')}`] : [])]);
      toast(
        `${files.length}ファイルから読み込みました（${kinds.map(([k, n]) => `${k}${n}本`).join('・')}、写真${nPhotos}枚）。` +
          `合わせて${prevCount(p.index)}本分あります。「サーバーに置く」でスマホに渡せます`,
      );
      if (skipped.length) console.info('カルテでないシート', skipped);
    } finally {
      setProgress('');
    }
  };

  return (
    <div className="sec">
      <h2>{label}の調査（カルテ）</h2>
      <div className="hint" data-testid="prev-status">
        {index ? (
          <>
            <span className="ok">読み込み済み</span>：{prevCount(index)}本・{Object.keys(index.packs || {}).length}か所（
            {String(index.updated || '').slice(0, 10)}）
          </>
        ) : (
          'まだ読み込んでいません。'
        )}
      </div>
      {can ? (
        <>
          <FilesButton label={progress ? '読み込み中…' : 'カルテのファイルを選ぶ（複数可）'} onFiles={onFiles} disabled={!!progress} testId="prev-files" />
          <FilesButton label="フォルダごと選ぶ" folder onFiles={onFiles} disabled={!!progress} testId="prev-folder" />
          {progress && <p className="hint">{progress}</p>}
          {problems.length > 0 && (
            <div className="alert warn">
              <ul className="err">
                {problems.slice(0, 10).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              {problems.length > 10 && <span>ほか{problems.length - 10}件</span>}
            </div>
          )}
          <p className="hint">
            事務所の PC で行います。読み込むと、入力画面にその木の{label}の弱点・評価・写真・図が出ます。読めるカルテ：{specs.map((x) => x.title || x.id).join('・')}（Excel と、Excel から作った PDF）。
            何回かに分けて読み込めます（同じ木・同じ種類のカルテは、新しく読んだ方に入れ替えます）。スマホでは「サーバーから受け取る」で受け取ります。
          </p>
          {index &&
            (askClear ? (
              <div className="alert warn">
                <span>この端末の{label}の調査を全部消します（サーバーの分は、次に「サーバーに置く」を押すまで残ります）。</span>
                <div className="acts">
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      await clearPrevious();
                      setAskClear(false);
                      toast(`${label}の調査を消しました`);
                    }}
                  >
                    消す
                  </button>
                  <button type="button" className="btn" onClick={() => setAskClear(false)}>
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setAskClear(true)}>
                {label}の調査を消して読み込み直す
              </button>
            ))}
        </>
      ) : (
        <div className="alert warn" data-testid="prev-no-spec">
          <span>
            {cfg
              ? `いま使っている設定ファイル（${cfg.job?.title || '名前なし'}・版${cfg.version}）には、カルテの読み方（previous.kartes）が入っていません。カルテの読み方を入れた新しい設定ファイルを、上の「設定ファイル（JSON）を読み込む」で読み込み直してください。`
              : '先に設定ファイルを読み込んでください。'}
          </span>
        </div>
      )}
    </div>
  );
}
