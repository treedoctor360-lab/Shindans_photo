// 入力画面の上に出す「前回」の欄：前回のカルテ（詳しい診断・周辺の環境・簡単な診断など、種類ごと）の
// 「有」の弱点・写真や図・評価を表示する。
//  写真は場所ごとに端末に入れておく（電波がなくても見られるように）。入っていなければ、受け取るボタンを出す
import { useState } from 'react';
import { getPreviousPhotos, photosOf, photoUrl, prevKey, prevOf } from '../store/previous.js';
import { usePrevIndex, usePrevPhotos } from './usePrevious.js';

const slash = (ymd) => String(ymd || '').replace(/-/g, '/');

// カルテ1枚分
function Karte({ k, photos, onBig }) {
  return (
    <div className="prev-karte" data-kind={k.kind}>
      <h3>
        {k.title || 'カルテ'} <small>{[slash(k.date), k.inspector].filter(Boolean).join('　')}</small>
      </h3>
      {k.info?.length > 0 && (
        <dl className="prev-info" data-testid="prev-info">
          {k.info.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd>{/^\d{4}-\d{2}-\d{2}$/.test(x.value) ? slash(x.value) : x.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {k.items?.length > 0 && (
        <div className="prev-items" data-testid="prev-items">
          <small>弱点など（有のもの）</small>
          <ul>
            {k.items.map((it, i) => (
              <li key={i}>
                <b>
                  {it.part && `${it.part} `}
                  {it.item}
                </b>{' '}
                {it.result}
                {it.grade && <span className="tag">{it.grade}</span>}
                {it.detail && <div className="hint">{it.detail}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {photos.length > 0 && (
        <div className="prev-photos" data-testid="prev-photos">
          {photos.map((p, i) => (
            <button key={i} type="button" className="prev-photo" onClick={() => onBig(p)}>
              <img src={photoUrl(p)} alt={p.caption} loading="lazy" />
              <small>{p.caption}</small>
            </button>
          ))}
        </div>
      )}
      {k.summary?.map((s) => (
        <div key={s.label} className="prev-sum">
          <small>{s.label}</small>
          {s.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function PrevPanel({ t, state, config: cfg, toast }) {
  const index = usePrevIndex();
  const hit = prevOf(t, index, cfg);
  const kartes = hit?.kartes || [];
  const packId = kartes.find((k) => k.packId)?.packId;
  const pack = usePrevPhotos(packId);
  const [showAnyway, setShowAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(null); // 大きく表示している写真
  if (!hit) return null;

  const label = cfg.previous?.label || '前回';
  const key = prevKey(kartes[0].code, kartes[0].treeNo);
  const nItems = kartes.reduce((n, k) => n + (k.items?.length || 0), 0);
  const nPhotos = kartes.reduce((n, k) => n + (k.photoCount || 0), 0);
  const packInfo = index.packs?.[packId];
  const species = kartes.find((k) => k.species)?.species;

  const onGet = async () => {
    setBusy(true);
    try {
      await getPreviousPhotos(state.server, packId);
      toast(`${packInfo?.code || ''} の${label}の写真を端末に入れました（${packInfo?.count ?? ''}枚）`);
    } catch (e) {
      toast(e.message || '写真を受け取れませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="sec prev" data-testid="prev">
      {/* 閉じていても「どの種類のカルテがあるか・いつ・弱点と写真の数」は見える。タップで開く */}
      <summary data-testid="prev-open">
        <b>{label}のカルテあり</b>
        <span className="prev-kinds">
          {kartes.map((k) => (
            <span key={k.kind} className="tag prev">
              {k.title || 'カルテ'}
              {k.date ? ` ${slash(k.date)}` : ''}
            </span>
          ))}
        </span>
        <span className="hint">
          弱点など{nItems}・写真{nPhotos}枚（タップで開く）
        </span>
      </summary>

      {hit.speciesMismatch && !showAnyway ? (
        <div className="alert warn" data-testid="prev-mismatch">
          <span>
            {label}のカルテがありますが、樹種が違います（{label}：{species}／今：{t.species}）。番号の付け替えなどで別の木の可能性があります。
          </span>
          <div className="acts">
            <button type="button" className="btn" onClick={() => setShowAnyway(true)}>
              それでも表示する
            </button>
          </div>
        </div>
      ) : (
        <>
          {hit.speciesMismatch && <p className="hint">※ 樹種が違います（{label}：{species}）</p>}
          {nPhotos > 0 && !pack && (
            <button type="button" className="btn" disabled={busy || !state.server?.url} onClick={onGet} data-testid="prev-get-photos">
              {busy ? '受け取り中…' : `写真・図${nPhotos}枚を見る（この場所の${label}の写真${packInfo?.count ?? ''}枚を端末に入れる）`}
            </button>
          )}
          {kartes.map((k) => (
            <Karte key={k.kind} k={k} photos={photosOf(pack, key, k.kind)} onBig={setBig} />
          ))}
        </>
      )}

      {big && (
        <button type="button" className="photo-big" onClick={() => setBig(null)} aria-label="閉じる">
          <img src={photoUrl(big)} alt={big.caption} />
          <span>{big.caption}（タップで閉じる）</span>
        </button>
      )}
    </details>
  );
}
