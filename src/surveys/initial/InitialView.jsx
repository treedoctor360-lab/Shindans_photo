// 詳しい診断（初期診断など）の入力画面
//  並びは設定 initialSurvey.forms（紙のカルテと同じ順にする）。書式（initial／environment）ごとに切り替える。
//  選択肢は設定かデータ入力用ブックの入力規則から。簡易診断から引き継いだ項目には「簡易から」と出す。
//  事務の端末では表示だけ（直すのは調査者）。
//  データ入力用ブックに手で入力済みの木は、ブックの内容を表示だけする（「アプリで入力し直す」でブックの値を下書きにできる）。
import { Fragment, useEffect, useState } from 'react';
import { useBarHeight } from '../../ui/useTopHeight.js';
import { toHalf } from '../../core/text.js';
import KarteView from '../../ui/KarteView.jsx';
import {
  INITIAL_STATUS_LABEL,
  bookEntry,
  bookValues,
  detailKeyOf,
  discardInitial,
  fillNone,
  formOf,
  initialOf,
  initialStatus,
  initialWarnings,
  isInitialTarget,
  missingInitial,
  initialWordingIssues,
  fixInitialWording,
  optionsOf,
  applyMeasures,
  matchPreview,
  measureStatus,
  syncInitialOfTree,
  saveInitial,
  startInitial,
  updateInitial,
  withdrawInitial,
  simpleNotesStatus,
} from '../../store/initial.js';
import { addEntry, checkNumbers, circled, entriesOf, manualKeyOf, partsKeyOf, partsOf, rebuildDetail, removeEntry, requiredFlags, setDetailText, setPart } from '../../core/detailParts.js';
import PartsInputs from '../../ui/PartsInputs.jsx';
import PrevPanel from '../../ui/PrevPanel.jsx';
import SessionStamp from '../../ui/SessionStamp.jsx';
import ReviewPanel from '../../ui/ReviewPanel.jsx';
import { INITIAL } from '../../store/surveys.js';

const isNone = (v, cfg) => v === (cfg.initialSurvey?.noneValue || '無');

// 選択肢のボタン（もう一度押すと外す）
function Choice({ k, opts, value, onPress }) {
  return (
    <div className="seg wrap" role="group" data-group={k}>
      {opts.map((o) => (
        <button key={o} type="button" className={`seg-b${value === o ? ' on' : ''}`} data-v={o} aria-pressed={value === o} onClick={() => onPress(k, o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// 弱点の詳細の数値（本数・高さ・大きさなど）。入れると、下の詳細の文を組み立てる
//  箇所が2つ以上なら（例 幹の腐朽が3か所。簡易診断の寸法から写したとき・「別の箇所を足す」を押したとき）、①②…ごとに数値の欄を並べる。
//  項目全体の部品（whole。例 子実体の種名）は①の欄にだけ出す
function DetailParts({ it, dk, rec, cfg, edit }) {
  const parts = partsOf(it, cfg);
  const es = entriesOf(rec[partsKeyOf(dk)]);
  const many = es.length > 1;
  // 必ず選ぶ印（例 芯達か芯未達か。部品の required: true）は2つのボタンで選ぶ
  const required = requiredFlags(parts, '');
  return (
    <div className="entries" data-entries={dk}>
      {es.map((e, i) => (
        <div className="entry" key={i} data-entry={i}>
          {many && (
            <div className="entry-head">
              <b>{circled(i)}</b>
              <button type="button" className="btn" onClick={() => edit((r) => removeEntry(r, it, dk, i, cfg))} data-remove-entry={i}>
                この箇所を消す
              </button>
            </div>
          )}
          <PartsInputs
            parts={i === 0 ? parts : parts.filter((p) => !p.whole)}
            values={e}
            onPut={(name, v) => edit((r) => setPart(r, it, dk, name, v, cfg, i))}
            testId={i === 0 ? dk : `${dk}.${i}`}
            Choice={Choice}
            pi={cfg.calc?.pi}
            required={required}
            rows
            noAddSize
          />
        </div>
      ))}
      <button type="button" className="more" onClick={() => edit((r) => addEntry(r, it, dk, cfg))} data-add-entry={dk}>
        ＋ 別の箇所を足す（{circled(es.length)}）
      </button>
    </div>
  );
}

// 簡易診断の特記事項（と⑦などの入力）が、詳しい診断に反映されているか。弱点の入力の手前に1か所にまとめて出す
//  反映されていないもの（黄）を先に、反映済み（緑）・手で書いた行（灰）を後に
function SimpleNotes({ rows }) {
  if (!rows.length) return null;
  const miss = rows.filter((x) => x.state === 'missing' || x.state === 'none').length;
  return (
    <div className="sec simple-notes" data-testid="simple-notes">
      <h2>
        簡易の特記事項{miss > 0 && <small className="tag w" data-testid="simple-notes-miss">未反映 {miss}</small>}
      </h2>
      <ul className="sn-list">
        {rows.map((x, i) => (
          <li key={i} className={`sn ${x.state}`} data-sn={x.state} data-kind={x.kind}>
            <span>{x.text}</span>
            <small>{x.note}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 選択肢が多い・長い項目は、見出しの下にボタンを並べる（見出しの横だと、どの項目のボタンか分かりにくいため）
const isWide = (opts) => opts.length > 3 || opts.some((o) => String(o).length > 4) || opts.join('').length > 10;

// mstat：その弱点の詳細と簡易診断の寸法の関係（store/initial.js の measureStatus）。onMatch：「簡易に合わせる」
//  preview：「簡易に合わせる」を押したときに変わる文（{ before, after }）。押すと先にこれを見せ、「合わせる」で確かめてから変える
function Item({ it, rec, cfg, opts, set, press, edit, mstat, onMatch, preview, inGrid = false }) {
  const v = rec[it.key] ?? '';
  const [asking, setAsking] = useState(false);
  const tags = (
    <>
      {it.desk && <small className="tag">後で</small>}
      {mstat ? (
        mstat.follow ? (
          mstat.simpleText && <small className="tag prev" data-mstat="follow">簡易の寸法から</small>
        ) : (
          <small className="tag" data-mstat="manual">{cfg.initialSurvey.label.replace(/（.*$/, '')}で直した</small>
        )
      ) : (
        (rec.inherited?.includes(it.key) || (it.type === 'weak' && rec.inherited?.includes(detailKeyOf(it)))) && <small className="tag prev">簡易から</small>
      )}
      {rec.fromBook?.includes(it.key) && <small className="tag prev">ブックから</small>}
      {it.hint && <small>{it.hint}</small>}
    </>
  );
  const id = `i-${it.key}`;
  if ((it.type === 'choice' || it.type === 'weak') && opts?.length) {
    const dk = detailKeyOf(it);
    const showDetail = it.type === 'weak' && v !== '' && !isNone(v, cfg);
    return (
      <div className={`row item choice ${isWide(opts) ? 'stack' : 'inline'}`} data-item={it.key}>
        <span className="lbl">
          {it.label} {tags}
        </span>
        <Choice k={it.key} opts={opts} value={v} onPress={press} />
        {/* 任意記入（設定 free）：選択肢にないときは書ける。書いた値がそのまま入る */}
        {it.free && (
          <input
            id={`i-${it.key}-free`}
            type="text"
            className="detail"
            value={opts.includes(v) ? '' : v}
            placeholder="選択肢にないときは、ここに書く"
            onChange={(e) => set(it.key, e.target.value)}
            data-free={it.key}
          />
        )}
        {showDetail && edit && partsOf(it, cfg).length > 0 && <DetailParts it={it} dk={dk} rec={rec} cfg={cfg} edit={edit} />}
        {(showDetail || (it.type === 'weak' && rec[dk])) && (
          <input
            id={`i-${dk}`}
            type="text"
            value={rec[dk] ?? ''}
            className="detail"
            placeholder={it.detailHint || '位置・大きさなど'}
            // 部品のある項目で文を手で直したら、部品を変えても文を上書きしない
            onChange={(e) => (partsOf(it, cfg).length && edit ? edit((r) => setDetailText(r, dk, e.target.value)) : set(dk, e.target.value))}
          />
        )}
        {/* 文に出さない入力の数（周囲長／幹周など）。確認用カルテにだけ出し、ブックに書く詳細の文には入れない */}
        {checkNumbers(rec[partsKeyOf(dk)], partsOf(it, cfg)).length > 0 && (
          <div className="hint" data-check={dk}>
            入力した数：【{checkNumbers(rec[partsKeyOf(dk)], partsOf(it, cfg)).join('、')}】（確認用カルテにだけ出します。ブックには書きません）
          </div>
        )}
        {/* 詳しい診断で直した項目が、簡易診断の寸法と違う。「簡易に合わせる」で戻せる */}
        {mstat && !mstat.follow && mstat.differs && (
          <div className="alert warn" data-testid="measure-differs" data-differs={dk}>
            <span>簡易の寸法と違います（簡易：{mstat.simpleText || 'なし'}）</span>
            {onMatch && !asking && (
              <div className="acts">
                <button type="button" className="btn" onClick={() => setAsking(true)} data-match={dk}>
                  簡易に合わせる
                </button>
              </div>
            )}
            {/* 押す前に変わる所を見せる。簡易に入っている値だけを置き換え、初期で足した数値は残す */}
            {onMatch && asking && preview && (
              <div data-match-ask={dk}>
                <div>
                  {preview.before === preview.after
                    ? '詳細の文は変わりません（文に出さない数値（確認用カルテの【】）だけを簡易に合わせます）。'
                    : `「${preview.before || '（なし）'}」→「${preview.after || '（なし）'}」にします。`}
                  簡易にない数値はそのまま残します。
                </div>
                <div className="acts">
                  <button
                    type="button"
                    className="btn fill"
                    onClick={() => {
                      setAsking(false);
                      onMatch(dk);
                    }}
                    data-match-ok={dk}
                  >
                    合わせる
                  </button>
                  <button type="button" className="btn" onClick={() => setAsking(false)} data-match-cancel={dk}>
                    やめる
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {rec[manualKeyOf(dk)] && edit && partsOf(it, cfg).length > 0 && (
          <div className="hint">
            詳細を書き換えたため、上の数値を変えても詳細は変わりません。{' '}
            <button type="button" className="btn" onClick={() => edit((r) => rebuildDetail(r, it, dk, cfg))} data-rebuild={dk}>
              数値から作り直す
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`row item field ${inGrid || it.type === 'textarea' ? 'stack' : 'inline'}`} data-item={it.key}>
      <label className="lbl" htmlFor={id}>
        {it.label} {tags}
      </label>
      {it.type === 'textarea' ? (
        <textarea id={id} value={v} onChange={(e) => set(it.key, e.target.value)} />
      ) : (
        <div className={it.unit ? 'unit' : undefined}>
          <input
            id={id}
            type="text"
            inputMode={it.type === 'number' ? 'decimal' : undefined}
            placeholder={it.blank != null ? `空欄なら ${it.blank}` : undefined}
            value={v}
            onChange={(e) => set(it.key, e.target.value)}
            onBlur={() => {
              // 数の項目は半角の数にする（ブックの数の欄に数で書くため）
              if (it.type !== 'number') return;
              const s = toHalf(String(v)).trim();
              if (/^-?\d+(\.\d+)?$/.test(s)) set(it.key, Number(s));
            }}
          />
          {it.unit && <span>{it.unit}</span>}
        </div>
      )}
    </div>
  );
}

// 区切りの項目を、画面の並べ方ごとにまとめる
//  設定で同じ row を付けた、続いている数・1行の文字の項目を横に並べる（例：枝下高の歩道と車道）。返す形：[{ grid, items }]
//  それ以外は1項目ずつ（見出しを左、入力を右の1行）
function groupItems(items) {
  const out = [];
  for (const it of items) {
    const short = it.type === 'number' || it.type === 'text';
    const last = out.at(-1);
    if (short && it.row && last?.grid && last.row === it.row) last.items.push(it);
    else out.push({ grid: short && !!it.row, row: it.row, items: [it] });
  }
  // 組が1項目だけなら、横に並べず1行で出す（半分の幅にならないように）
  for (const g of out) if (g.grid && g.items.length < 2) g.grid = false;
  return out;
}

// 項目の名前から、その項目（設定の入力画面の項目）と書式を探す。付箋の修正案の選択肢に使う
function itemOf(cfg, key) {
  for (const [form, f] of Object.entries(cfg.initialSurvey?.forms || {}))
    for (const sec of f.sections) for (const it of sec.items) if (it.key === key) return { form, it };
  return null;
}

// 入力済みの記録の調査日・調査者（保存してもそのまま。SessionStamp に出す）
function keptStamp(rec, cfg) {
  const st = cfg.initialSurvey?.stamp || {};
  if (!rec?.done) return null;
  const [y, m, d] = (st.date || []).map((k) => rec[k]);
  const date = y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
  const inspector = st.inspector ? rec[st.inspector] || '' : '';
  return date || inspector ? { date, inspector } : null;
}

// pane：デスクトップ表示の右の列として出す（記録もブックの内容もない木では何も出さない）
export default function InitialView({ state, update, config: cfg, toast, send, pane = false }) {
  const forms = Object.keys(cfg?.initialSurvey?.forms || {});
  const [form, setForm] = useState(forms[0] || 'initial');
  const [missingAsk, setMissingAsk] = useState(null);
  const [askStay, setAskStay] = useState(false); // 「未入力のまま保存する」の後も、押したボタンと同じ行き先にする
  const [showBook, setShowBook] = useState(false); // アプリの記録があるとき、ブックの内容を見るか
  const [askRemove, setAskRemove] = useState(false); // 取り消し・下書きを消すの確かめ中か
  const [showKarte, setShowKarte] = useState(false); // カルテで見る（画面に出しているか）
  useBarHeight(); // 樹木番号の帯の高さ（区切りの見出しを、その下に止めるため）
  const tree = state.trees.find((t) => t.id === (pane ? state.currentId : state.initialTreeId)); // 並べて出すときは、簡易診断で開いている木
  const appRec = tree && cfg ? initialOf(state, tree, cfg) : null;
  const entry = tree && cfg?.initialSurvey ? bookEntry(state, tree, cfg) : null;
  const viewingBook = !!entry && (!appRec || showBook); // ブックの内容を表示している（表示だけ）
  const rec = viewingBook ? bookValues(entry, cfg) : appRec;
  // 開いたとき・簡易診断の寸法が変わったとき：詳しい診断で直していない項目を簡易診断の寸法に合わせる（事務の端末は見るだけ）
  const canSync = !!appRec && !!tree && state.user?.role !== 'office';
  useEffect(() => {
    // 木が変わるたびに確かめる（変わっていなければ何もしない）
    if (canSync) update((cur) => syncInitialOfTree(cur, tree.id, cfg));
  }, [canSync, tree]);
  const back = (view = 'list') => update((s) => ({ ...s, view, ...(view === 'form' && tree ? { currentId: tree.id } : {}) }));

  // 並べて出すとき、詳しい診断の対象でなくなった木（「要」を後で「否」にした）に残っている記録は出さない
  if (pane && (!cfg?.initialSurvey || !tree || !rec || !isInitialTarget(tree, cfg))) return null;
  if (!cfg?.initialSurvey || !tree || !rec) {
    return (
      <section className="view">
        <div className="alert warn" data-testid="initial-missing">
          <span>開く記録がありません。一覧から木を選び、簡易診断の画面の「{cfg?.initialSurvey?.label || '詳しい診断'}を入力」を押してください。</span>
          <div className="acts">
            <button type="button" className="btn" onClick={() => back('list')}>
              一覧に戻る
            </button>
          </div>
        </div>
      </section>
    );
  }

  const office = state.user?.role === 'office';
  const readOnly = office || viewingBook;
  // ブックの値を下書きにして、アプリで入力し直す
  const onCopyBook = () => {
    try {
      update((s) => startInitial(s, tree, cfg, { force: true }).state, { now: true });
      setShowBook(false);
      toast('ブックの内容を下書きにしました。直して保存してください');
    } catch (e) {
      toast(e.message);
    }
  };
  const bookAt = entry && ['initial', 'environment'].map((k) => entry[k] && `${entry[k]._sheet} ${entry[k]._row}行目`).filter(Boolean).join('・');
  const f = formOf(cfg, form);
  const optionsFor = (it) => optionsOf(it, state, form, tree.siteType);
  const set = (k, v) => update((s) => updateInitial(s, rec.id, (r) => ({ ...r, [k]: v })));
  const edit = (fn) => update((s) => updateInitial(s, rec.id, fn));
  const press = (k, v) => update((s) => updateInitial(s, rec.id, (r) => ({ ...r, [k]: r[k] === v ? '' : v })));
  const status = initialStatus(tree, state, cfg);
  const missing = readOnly ? [] : missingInitial(rec, cfg);
  const warnings = readOnly ? [] : initialWarnings(rec, tree, cfg); // 詳細があるのに「無」・簡易診断で「有」なのに詳しい診断で「無」
  const wording = readOnly ? [] : initialWordingIssues(rec, cfg); // 表記の統一（設定 wording）
  // 簡易診断の寸法と弱点の詳細の関係（詳しい診断で直していない項目は、自動で簡易診断の寸法に合わせる）
  const mstats = new Map((viewingBook ? [] : measureStatus(rec, tree, cfg)).map((x) => [x.key, x]));
  const onMatch = (dk) => {
    // その時点の最新の木と記録に対して行う
    update((cur) => {
      const t = cur.trees.find((x) => x.id === tree.id) || tree;
      return updateInitial(cur, rec.id, (r) => applyMeasures(r, t, cfg, [dk], { merge: true }));
    });
    toast('簡易診断の寸法に合わせました');
  };
  // 「違います」と出ている項目だけ、合わせたときの文を先に作っておく
  const previewOf = (it) => {
    const st = it.type === 'weak' ? mstats.get(detailKeyOf(it)) : null;
    return st && !st.follow && st.differs ? matchPreview(rec, tree, cfg, st.key) : null;
  };

  // 入力の取り消し・下書きを消す
  const label = cfg.initialSurvey.label;
  const removeAct = rec.done
    ? {
        label: '入力を取り消す（未入力に戻す）',
        ok: '取り消す',
        text: `この木の${label}の入力を取り消して未入力に戻します（入力した値は下書きとして残ります。確定していれば外れ、ブックへの出力の対象からも外れます）。`,
        fn: withdrawInitial,
        done: '未入力に戻しました',
      }
    : !(rec.rev > 0) && !rec.conflict
      ? {
          label: '下書きを消す（記録を作る前に戻す）',
          ok: '消す',
          text: `この木の${label}の下書きを消します。まだサーバーに送っていないので、この端末から消えます（元に戻せません）。`,
          fn: discardInitial,
          done: '下書きを消しました',
        }
      : null;
  const onRemove = () => {
    setAskRemove(false);
    try {
      removeAct.fn(state, rec.id); // 取り消せないときはここで止まる（知らせを出す）
      const gone = removeAct.fn === discardInitial;
      // 実際の変更は、その時点の最新の状態に対して行う（送受信で届いた変更を上書きしないように）
      update(
        (cur) => {
          const next = removeAct.fn(cur, rec.id);
          return gone ? { ...next, view: 'form', currentId: tree.id } : next;
        },
        { now: true },
      ).then(() => send?.()); // 消したら簡易診断の画面へ
      toast(removeAct.done);
    } catch (e) {
      toast(e.message);
    }
  };

  const onNone = (sec) => {
    const r = fillNone(rec, sec, cfg, optionsFor);
    // 詳細（寸法など）が入っているのに有無を選んでいない項目は「無」にしない
    const keptMsg = r.kept.length ? `詳細が入っている${r.kept.join('・')}は「${cfg.initialSurvey.noneValue || '無'}」にしていません。有無を選んでください` : '';
    if (!r.keys.length) return toast(keptMsg || 'まだ選んでいない項目はありません');
    update((s) => updateInitial(s, rec.id, () => r.record));
    toast(`まだ選んでいなかった${r.keys.length}項目を「${cfg.initialSurvey.noneValue || '無'}」${r.custom ? '（物が無い項目は「〜なし」）' : ''}にしました` + (keptMsg ? `。${keptMsg}` : ''));
  };
  // 保存。stay：true なら同じ木の画面のまま（一覧へ戻らず、見ていた所から続けて直せる）
  const onSave = (force = false, stay = false) => {
    const r = saveInitial(state, rec.id, cfg, { force });
    if (!r.saved) {
      setMissingAsk(r.missing);
      setAskStay(stay);
      return;
    }
    setMissingAsk(null);
    // 保存は、その時点の最新の状態に対して行う（送受信で届いた変更を古い状態で上書きしないように）
    update((cur) => {
      const saved = saveInitial(cur, rec.id, cfg, { force: true }).state;
      return stay ? saved : { ...saved, view: 'list' };
    }, { now: true }).then(() => send?.());
    toast(`${toHalf(tree.treeNo) || 'この木'} の${cfg.initialSurvey.label}を保存しました`);
    if (!stay) window.scrollTo(0, 0);
  };

  return (
    <section className="view initial-form" data-testid="initial-view">
      {/* 樹木番号・樹種の帯は画面の上に残す（スクロールしても、いまどの木を入力しているか分かるように） */}
      <div className="sub tree-bar" style={{ justifyContent: 'space-between' }} data-testid="tree-bar">
        <button type="button" className="btn" onClick={() => back('form')} data-testid="back-to-simple">
          ← 簡易診断へ
        </button>
        <span className="tree-bar-name">
          <b className="no" data-testid="tree-bar-no">{toHalf(tree.treeNo) || '(番号なし)'}</b>{' '}
          <span data-testid="tree-bar-species">{tree.species}</span>
          <small className="hint">
            {cfg.initialSurvey.label}：{INITIAL_STATUS_LABEL[status]}
          </small>
        </span>
      </div>

      <div className="sec">
        <h2>{cfg.initialSurvey.label}</h2>
        <div className="lbl" data-testid="initial-tree">
          <span className="no">{toHalf(tree.treeNo) || '(番号なし)'}</span> {tree.species}
          <small>{tree.place}</small>
        </div>
        {forms.length > 1 && (
          <div className="seg" role="tablist">
            {forms.map((k) => (
              <button key={k} type="button" className={`seg-b${form === k ? ' on' : ''}`} onClick={() => setForm(k)} data-form={k}>
                {formOf(cfg, k).title}
              </button>
            ))}
          </div>
        )}
        {/* 今の入力内容を確認用カルテの形で見る（ダウンロードしなくても確かめられる） */}
        {cfg.initialSurvey.karte && appRec && !viewingBook && (
          <div className="acts">
            <button type="button" className="btn" onClick={() => setShowKarte(true)} data-testid="karte-view-open">
              カルテで見る
            </button>
          </div>
        )}
        {showKarte && <KarteView state={state} cfg={cfg} rec={appRec} form={form} onClose={() => setShowKarte(false)} />}
        {office && !viewingBook && <div className="readonly-note">表示のみ：事務の端末では入力内容を直せません。</div>}
        {entry && (
          <div className={`alert ${viewingBook ? 'info' : 'warn'}`} data-testid="book-note">
            <span>
              {viewingBook
                ? `データ入力用ブックに手で入力済みの内容です（${bookAt}）。表示だけです。`
                : `データ入力用ブックにも入力済みです（${bookAt}）。二重にならないよう、どちらを使うか事務所で確かめてください。`}
              {entry.dup?.length ? ' ブックに同じ木の行が2つ以上あります（最初の行を表示）。' : ''}
            </span>
            <div className="acts">
              {appRec && (
                <button type="button" className="btn" onClick={() => setShowBook((x) => !x)} data-testid="book-toggle">
                  {showBook ? 'アプリの入力に戻る' : 'ブックの内容を見る'}
                </button>
              )}
              {!appRec && !office && (
                <button type="button" className="btn" onClick={onCopyBook} data-testid="book-copy">
                  アプリで入力し直す（ブックの内容を下書きにする）
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {!viewingBook && (
        <ReviewPanel
          t={rec}
          state={state}
          update={update}
          config={cfg}
          toast={toast}
          send={send}
          survey={INITIAL}
          optionsFor={(key) => {
            const hit = itemOf(cfg, key);
            return hit && ['choice', 'weak'].includes(hit.it.type) ? optionsOf(hit.it, state, hit.form, tree.siteType) : null;
          }}
        />
      )}

      <PrevPanel t={tree} state={state} config={cfg} toast={toast} />

      <fieldset disabled={readOnly} className="form-body">
        {f.sections.map((sec, i) => (
          <Fragment key={`${form}-${i}`}>
          {/* 弱点の入力（「すべて無」のある最初の区切り）の手前に、簡易の特記事項をまとめて出す */}
          {i === f.sections.findIndex((x) => x.none) && !viewingBook && <SimpleNotes rows={simpleNotesStatus(rec, tree, cfg)} />}
          <div className="sec" data-section={i}>
            <h2>{sec.title}</h2>
            {sec.none && !readOnly && (
              <button type="button" className="btn" onClick={() => onNone(sec)} data-testid={`none-${i}`}>
                まだ選んでいない項目をすべて「{cfg.initialSurvey.noneValue || '無'}」にする
              </button>
            )}
            {/* 設定で row を付けた数・文字の項目は横に並べる。ほかは1項目ずつ、区切り線で分ける */}
            {groupItems(sec.items).map((g) =>
              g.grid ? (
                <div className="grid2 item" key={g.items[0].key}>
                  {g.items.map((it) => (
                    <Item key={it.key} it={it} rec={rec} cfg={cfg} opts={optionsFor(it)} set={set} press={press} edit={readOnly ? null : edit} inGrid mstat={it.type === 'weak' ? mstats.get(detailKeyOf(it)) : null} onMatch={readOnly ? null : onMatch} preview={previewOf(it)} />
                  ))}
                </div>
              ) : (
                <Item key={g.items[0].key} it={g.items[0]} rec={rec} cfg={cfg} opts={optionsFor(g.items[0])} set={set} press={press} edit={readOnly ? null : edit} mstat={g.items[0].type === 'weak' ? mstats.get(detailKeyOf(g.items[0])) : null} onMatch={readOnly ? null : onMatch} preview={previewOf(g.items[0])} />
              ),
            )}
          </div>
          </Fragment>
        ))}
      </fieldset>

      {/* 入力の取り消し（入力済み → 未入力）・下書きを消す（まだ送っていない下書きだけ）。どちらも調査者だけ */}
      {!readOnly && removeAct && (
        <div className="sec">
          {askRemove ? (
            <div className="alert danger" data-testid="initial-remove-ask">
              <span>{removeAct.text}</span>
              <div className="acts">
                <button type="button" className="btn fill" onClick={onRemove} data-testid="initial-remove-ok">
                  {removeAct.ok}
                </button>
                <button type="button" className="btn" onClick={() => setAskRemove(false)}>
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setAskRemove(true)} data-testid="initial-remove">
              {removeAct.label}
            </button>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="savebar">
          {/* 入力の食い違い（保存の前から出しておく） */}
          {warnings.length > 0 && !(missingAsk && missing.length + warnings.length > 0) && (
            <div className="alert warn" data-testid="initial-warnings">
              <span>確かめてください：{warnings.join('／')}</span>
            </div>
          )}
          {missingAsk && missing.length + warnings.length > 0 ? (
            <div className="alert warn" role="alert" data-testid="initial-save-ask">
              <span>
                {missing.length > 0 && <>未入力があります：{missing.join('、')}</>}
                {missing.length > 0 && warnings.length > 0 && <br />}
                {warnings.length > 0 && <>確かめてください：{warnings.join('／')}</>}
              </span>
              <div className="acts">
                <button type="button" className="btn" onClick={() => onSave(true, askStay)}>
                  {missing.length > 0 ? '未入力のまま保存する' : 'このまま保存する'}
                </button>
              </div>
            </div>
          ) : (
            missing.length > 0 && (
              <div className="alert info">
                <span>未入力：{missing.length}項目</span>
              </div>
            )
          )}
          {wording.length > 0 && (
            <div className="alert warn" data-testid="initial-wording">
              <span>表記の統一：{wording.join('・')}</span>
              <div className="acts">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    edit((r) => fixInitialWording(r, cfg));
                    toast('表記を直しました');
                  }}
                  data-testid="initial-wording-fix"
                >
                  表記を直す
                </button>
              </div>
            </div>
          )}
          <SessionStamp state={state} update={update} kept={keptStamp(rec, cfg)} />
          <button type="button" className="btn fill big" onClick={() => onSave(false)} data-testid="save-initial">
            保存して一覧へ
          </button>
          {/* 保存だけ：同じ木のまま続けて直せる */}
          <button type="button" className="btn big" onClick={() => onSave(false, true)} data-testid="save-initial-stay">
            保存（この木のまま）
          </button>
        </div>
      )}
    </section>
  );
}
