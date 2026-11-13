// 写真の画面：デジカメの写真を取り込み、木ごとに区切って、カルテに貼る写真を選ぶ（設定 karte.photos があるとき）
//  ① 写真を入れる（ドロップか選ぶ）→ 撮った順に並ぶ
//  ② 番号の写真を押して選ぶ → そこから次の番号の写真の手前までが1本分
//  ③ 木ごとに、カルテに貼る写真を押して選ぶ（全景は最初の縦の写真を自動で入れる）。見出しは候補から選ぶか書く
//  選んだ内容はこの端末の中に置く（src/store/kphotos.js）。カルテの出力のときに貼る（出力の画面）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { groupLabel, treesOfGroup } from '../core/groups.js';
import { photoPlan } from '../core/photo.js';
import { segmentsOf, setFull, slotPhotos, sortPhotos, togglePick } from '../core/kartePhotoPlan.js';
import { deleteKPhotoData, emptyKPhotos, getKPhotoData, loadKPhotos, putKPhotoData, saveKPhotos } from '../store/kphotos.js';
import { simpleKey } from '../store/surveys.js';
import { toHalf } from '../core/text.js';
import { activeGroup } from './ListView.jsx';
import { readPhotoFile } from './photoFile.js';

const timeOf = (p) => String(p.shotAt || '').replace('T', ' ').slice(5, 16);

// 写真1枚（一覧用の絵・時刻・印）
function Thumb({ p, url, badge, on, onClick, children }) {
  return (
    <div className={`kp-item${on ? ' on' : ''}`} data-testid={`kp-${p.name}`}>
      <button type="button" className="kp-img" onClick={onClick} title={`${p.name}　${String(p.shotAt || '').replace('T', ' ')}`}>
        {url ? <img src={url} alt={p.name} /> : <span className="hint">読み込み中</span>}
        {badge && <span className="kp-badge">{badge}</span>}
      </button>
      <div className="kp-cap">
        <span>{timeOf(p)}</span>
        {children}
      </div>
    </div>
  );
}

export default function PhotoView({ state, config: cfg, toast }) {
  const group = cfg && state.trees.length ? activeGroup(state, cfg) : '';
  const [store, setStore] = useState(emptyKPhotos());
  const [loaded, setLoaded] = useState('');
  const [thumbs, setThumbs] = useState({}); // 写真の id → 一覧用の絵の URL
  const [mode, setMode] = useState('number'); // 'number' 番号の写真を選ぶ / 'pick' カルテに貼る写真を選ぶ
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const urls = useRef([]);
  const pc = cfg?.karte?.photos;

  // まとまりを変えたら、その写真の一覧を読む
  useEffect(() => {
    let alive = true;
    setLoaded('');
    if (!group) return undefined;
    loadKPhotos(group).then((v) => {
      if (!alive) return;
      setStore(v);
      setLoaded(group);
      if (v.photos.some((p) => p.number)) setMode('pick');
    });
    return () => {
      alive = false;
    };
  }, [group]);

  // 一覧用の絵を読む（まだ読んでいない写真だけ）
  useEffect(() => {
    let alive = true;
    const need = store.photos.filter((p) => !p.removed && !thumbs[p.id]);
    if (!need.length) return undefined;
    (async () => {
      const add = {};
      for (const p of need) {
        const d = await getKPhotoData(p.id);
        if (!d?.thumb) continue;
        const url = URL.createObjectURL(new Blob([d.thumb], { type: 'image/jpeg' }));
        urls.current.push(url);
        add[p.id] = url;
      }
      if (alive) setThumbs((t) => ({ ...t, ...add }));
    })();
    return () => {
      alive = false;
    };
  }, [store.photos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const trees = useMemo(
    () => (group ? treesOfGroup(state.trees, group, cfg).filter((t) => !t.deleted).map((t) => ({ key: simpleKey(t, cfg), treeNo: toHalf(t.treeNo).trim(), tree: t })) : []),
    [state.trees, group, cfg],
  );

  if (!cfg || !pc) return <section className="view"><p className="hint">この設定では、写真をカルテに貼る機能を使いません。</p></section>;
  if (!group) return <section className="view"><p className="hint">先に、木を入れてください（一覧で路線を足すか、入力表を読み込みます）。</p></section>;

  // 一覧を書き換えて保存する
  const change = (fn) => {
    setStore((cur) => {
      const next = fn(cur);
      saveKPhotos(group, next).catch(() => toast('写真の一覧を保存できませんでした'));
      return next;
    });
  };

  // 写真を入れる
  const addFiles = async (files) => {
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    if (!list.length) return toast('写真のファイルがありません');
    const have = new Set(store.photos.filter((p) => !p.removed).map((p) => `${p.name}|${p.shotAt}`));
    const added = [];
    let dup = 0;
    let bad = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`写真を読み込み中… ${i + 1}／${list.length}`);
      try {
        const r = await readPhotoFile(list[i], { maxPx: pc.maxPx ?? 1000 });
        if (have.has(`${r.name}|${r.shotAt}`)) {
          dup += 1; // 同じ名前・同じ撮影日時の写真は入れない
          continue;
        }
        have.add(`${r.name}|${r.shotAt}`);
        const id = `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        await putKPhotoData(id, { data: r.data, thumb: r.thumb }); // 中身を先に置いてから一覧に足す
        added.push({ id, name: r.name, shotAt: r.shotAt, w: r.w, h: r.h });
      } catch {
        bad += 1;
      }
    }
    setBusy('');
    if (added.length) change((cur) => ({ ...cur, photos: [...cur.photos, ...added] }));
    toast(`${added.length}枚を入れました` + (dup ? `（同じ写真${dup}枚は入れていません）` : '') + (bad ? `。読めなかった写真が${bad}枚あります` : ''));
  };

  const photos = sortPhotos(store.photos);
  const { before, segments } = segmentsOf(store.photos, trees);
  const treeOf = (key) => trees.find((t) => t.key === key);
  const noOf = (key) => treeOf(key)?.treeNo || '';
  const segByNumber = new Map(segments.map((s) => [s.number.id, s]));

  const toggleNumber = (id) => change((cur) => ({ ...cur, photos: cur.photos.map((p) => (p.id === id ? { ...p, number: !p.number, treeKey: '' } : p)) }));
  const setSegTree = (id, key) => change((cur) => ({ ...cur, photos: cur.photos.map((p) => (p.id === id ? { ...p, treeKey: key } : p)) }));
  const setPick = (treeKey, fn) => change((cur) => ({ ...cur, picks: { ...cur.picks, [treeKey]: fn(cur.picks[treeKey] || {}) } }));
  const removePhoto = (p) => {
    if (!window.confirm(`写真「${p.name}」を外します。この端末に入れた写真の中身も消します（元のファイルは消えません）。`)) return;
    change((cur) => ({ ...cur, photos: cur.photos.map((x) => (x.id === p.id ? { ...x, removed: true, number: false } : x)) }));
    deleteKPhotoData(p.id).catch(() => {});
  };

  // 見出しの候補：その木の「撮る写真」の名前（全景を除く）＋設定の候補
  const captionsOf = (t) => {
    const names = t ? photoPlan(t, cfg).shoot.map((s) => s.name).filter((n) => n && n !== cfg.photo?.fullName) : [];
    return [...new Set([...names, ...(pc.captions || [])])];
  };

  const numbers = segments.length;
  const noTree = segments.filter((s) => !s.treeKey).length;

  return (
    <section className="view">
      <div className="sec">
        <h2>写真：{groupLabel(state.trees, group, cfg)}</h2>
        <label
          className={`kp-drop${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!busy) addFiles(e.dataTransfer.files);
          }}
        >
          {busy || 'ここに写真をまとめてドロップ（または押して選ぶ）'}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={!!busy}
            data-testid="kp-files"
            onChange={(e) => {
              const fs = [...e.target.files];
              e.target.value = '';
              addFiles(fs);
            }}
          />
        </label>
        <p className="hint">
          この路線の写真を入れると、撮った順に並びます。写真は小さくしてこの端末の中に置きます（元のファイルはそのまま。サーバーには送りません）。
          {loaded === group && ` 今 ${photos.length}枚。`}
        </p>
      </div>

      {photos.length > 0 && (
        <div className="sec">
          <div className="seg" role="tablist">
            <button type="button" className={`seg-b${mode === 'number' ? ' on' : ''}`} onClick={() => setMode('number')} data-testid="kp-mode-number">
              ① 番号の写真を選ぶ（{numbers}枚）
            </button>
            <button type="button" className={`seg-b${mode === 'pick' ? ' on' : ''}`} onClick={() => setMode('pick')} disabled={!numbers} data-testid="kp-mode-pick">
              ② カルテに貼る写真を選ぶ
            </button>
          </div>

          {mode === 'number' && (
            <>
              <p className="hint">
                樹木番号が写っている写真を押してください。そこから次の番号の写真の手前までが、1本の木の写真になります。木は並び順に1本ずつ当てます（違うときは②で木を選び直せます）。
              </p>
              <div className="kp-grid">
                {photos.map((p) => (
                  <Thumb key={p.id} p={p} url={thumbs[p.id]} on={!!p.number} badge={p.number ? `No.${noOf(segByNumber.get(p.id)?.treeKey) || '？'}` : ''} onClick={() => toggleNumber(p.id)}>
                    <button type="button" className="kp-x" onClick={() => removePhoto(p)} aria-label="この写真を外す">外す</button>
                  </Thumb>
                ))}
              </div>
            </>
          )}

          {mode === 'pick' && (
            <>
              <p className="hint">
                木ごとに、カルテに貼る写真を押して選びます（もう一度押すと外れます）。全景には最初の縦の写真が入っています。変えるときは写真の「全景に」を押します。
                {noTree > 0 && ` 番号の写真が木の数より${noTree}枚多くなっています。`}
                {before.length > 0 && ` 最初の番号の写真より前の${before.length}枚は、どの木にも入りません。`}
              </p>
              {segments.map((s) => {
                const t = treeOf(s.treeKey);
                const pick = store.picks[s.treeKey] || {};
                const cur = s.treeKey ? slotPhotos(s.photos, pc.slots, pick) : [];
                const slotOf = (id) => cur.find((x) => x.photo?.id === id);
                const caps = captionsOf(t?.tree);
                return (
                  <div key={s.number.id} className="kp-tree" data-testid={`kp-tree-${t?.treeNo || 'none'}`}>
                    <div className="kp-head">
                      {thumbs[s.number.id] && <img className="kp-num" src={thumbs[s.number.id]} alt="番号の写真" />}
                      <label>
                        木：
                        <select value={s.treeKey} onChange={(e) => setSegTree(s.number.id, e.target.value)}>
                          {!s.treeKey && <option value="">（木がありません）</option>}
                          {trees.map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.treeNo || '番号なし'} {x.tree.species}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="hint">
                        {cur.filter((x) => x.photo).map((x) => x.slot.label).join('・') || '写真なし'}
                      </span>
                    </div>
                    <div className="kp-grid">
                      {s.photos.map((p) => {
                        const hit = slotOf(p.id);
                        return (
                          <Thumb key={p.id} p={p} url={thumbs[p.id]} on={!!hit} badge={hit ? hit.slot.label : ''} onClick={() => s.treeKey && setPick(s.treeKey, (k) => togglePick(k, pc.slots, s.photos, p.id))}>
                            {s.treeKey && !hit?.slot.full && pc.slots.some((x) => x.full) && (
                              <button type="button" className="kp-x" onClick={() => setPick(s.treeKey, (k) => setFull(k, pc.slots, p.id))}>全景に</button>
                            )}
                          </Thumb>
                        );
                      })}
                      {!s.photos.length && <span className="hint">この木の写真はありません。</span>}
                    </div>
                    {cur.filter((x) => x.slot.caption && x.photo).map((x) => (
                      <label key={x.slot.key} className="kp-caption">
                        {x.slot.label}の見出し：
                        <input
                          list={`kp-caps-${s.number.id}`}
                          value={x.caption}
                          onChange={(e) => setPick(s.treeKey, (k) => ({ ...k, [x.slot.key]: { ...k[x.slot.key], caption: e.target.value } }))}
                          data-testid={`kp-caption-${t?.treeNo}-${x.slot.key}`}
                        />
                      </label>
                    ))}
                    <datalist id={`kp-caps-${s.number.id}`}>
                      {caps.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                );
              })}
              <p className="hint">選び終わったら、「出力」の画面でカルテを出すと、写真が入ります。</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
