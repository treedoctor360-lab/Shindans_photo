// 特記事項の寸法（腐朽・空洞・鋼棒貫入など）の一覧と、入れる・直す画面
//  寸法は特記事項の文字の欄には入れず、この一覧に1件ずつ置く（数字と文字が食い違わないように）。
//  野帳の特記事項には、文字の欄の文の後に寸法の1行を並べる（noteMeasures.js の fullNotesOf）。
//  「直す」で入れたときと同じ画面が、入れた数字のまま開く。言葉を足すときは備考（memo）の欄に書く。
//  「文を直す」で、数字から作った文（野帳・カルテに出す文）を書き換えられる。数字は残る。
//  書き換えた後に数字を直したときは、文を作り直すか、手で直した文のままにするかを聞く（黙って上書きしない）。
//  書き方は設定 noteMeasures（noteMeasures.js）
import { useState } from 'react';
import {
  autoWording,
  manualTextOf,
  measureKinds,
  measureLine,
  measureParts,
  measurePlaces,
  measurePrefill,
  noteLineOf,
  putMeasure,
  removeMeasure,
  setMeasureText,
  toMeasuresV2,
  wordingOf,
} from '../core/noteMeasures.js';
import PartsInputs from './PartsInputs.jsx';
import { requiredFlags, unchosenFlags, withAuto } from '../core/detailParts.js';

// 選択肢のボタン（数字の欄の中の選択肢用）
function Choice({ k, opts, value, onPress }) {
  return (
    <div className="chips" data-group={k}>
      {opts.map((o) => (
        <button key={o} type="button" className={`chip${value === o ? ' on' : ''}`} onClick={() => onPress(k, o)} data-v={o}>
          {o}
        </button>
      ))}
    </div>
  );
}

// tree：今の木。onChange(fn)：木を変える（fn は木 → 新しい木）。readOnly：見るだけ
//  kinds：この種類だけを出す（点検項目の下に出すとき。checks の measure）。種類が1つなら選ばずにその種類で開く
//  canAdd：入れるボタンを出すか（点検項目が「有」のときだけ。入れたものは「無」に変えても一覧に出す）
//  exclude：出さない種類（特記事項の下では、点検項目の下に出す種類を除く）
export default function NoteMeasures({ cfg, tree, onChange, readOnly = false, kinds = null, canAdd = true, exclude = [] }) {
  const [edit, setEdit] = useState(null); // 入れている・直している寸法 { i（直す記録の番号。新しく入れるときは -1）, kind, place, values }
  const [askRemove, setAskRemove] = useState(-1); // 消すのを確かめている記録の番号
  const [textEdit, setTextEdit] = useState(null); // 出す文を直している記録 { i, value }
  const [askKeep, setAskKeep] = useState(false); // 数字を直したとき、手で直した文をどうするか聞いている
  if (!cfg.noteMeasures) return null;
  const list = toMeasuresV2(tree, cfg).measures; // 前の形の木も、新しい形で見せる（直したときに新しい形に移す）
  const kindLabel = (k) => measureKinds(cfg).find((x) => x.key === k)?.label || k;
  // ここで扱う種類（kinds があればその種類だけ、exclude の種類は除く）
  const shown = (k) => (kinds ? kinds.includes(k) : !exclude.includes(k));
  const myKinds = measureKinds(cfg).filter((k) => shown(k.key));
  const rows = list.map((m, i) => ({ m, i })).filter(({ m }) => shown(m.kind)); // i は木の一覧での番号（直す・消すに使う）
  if (!myKinds.length && !rows.length) return null;
  const inCheck = !!kinds; // 点検項目の下に出している
  // 点検項目の下で、入れた行もなく入れるボタンも出さないとき（項目が「有」でない）は何も出さない（行の間が空かないように）
  if (inCheck && !rows.length && !edit && (readOnly || !canAdd)) return null;

  const open = (i) => {
    const m = list[i];
    const one = myKinds.length === 1 ? myKinds[0].key : ''; // 種類が1つなら選ばずに開く
    setEdit(m ? { i, kind: m.kind, place: m.place || '', values: structuredClone(m.values || {}) } : { i: -1, kind: one, place: '', values: one ? measurePrefill(one, tree, cfg) : {} });
    setAskRemove(-1);
    setTextEdit(null);
    setAskKeep(false);
  };
  const line = edit ? measureLine(cfg, edit.kind, edit.place, edit.values) : '';
  const needPlace = edit?.kind ? measurePlaces(edit.kind, cfg).length > 0 : false;
  // 必ず選ぶ印（例 芯達か芯未達か）。まだ選んでいなければ追加・直すを押せない
  const partsNow = edit?.kind ? measureParts(edit.kind, cfg) : [];
  const unchosen = edit?.kind ? unchosenFlags(edit.values, partsNow, needPlace ? edit.place : '') : [];
  // 直している記録に手で直した文があるか。数字を直して「数字から作る文」が変わったら、文をどうするか聞く
  const editRec = edit ? { kind: edit.kind, place: needPlace ? edit.place : '', values: edit.values } : null;
  const oldText = edit && edit.i >= 0 ? manualTextOf(list[edit.i]) : '';
  const autoChanged = !!oldText && autoWording(cfg, editRec) !== (list[edit.i].textAuto ?? '');
  // keepText：手で直した文を残すか（聞かれて選んだとき）。まだ聞いていなければ聞く
  const done = (keepText) => {
    if (autoChanged && keepText === undefined) {
      setAskKeep(true);
      return;
    }
    setAskKeep(false);
    const text = oldText && (keepText ?? true) ? oldText : '';
    onChange((t) => putMeasure(t, cfg, { ...editRec, text }, edit.i));
    // 直したら閉じる。新しく入れたときは、続けて別の所を入れられるように開いたまま数字だけ空に戻す
    if (edit.i >= 0) setEdit(null);
    else setEdit((e) => ({ ...e, values: measurePrefill(e.kind, tree, cfg) }));
  };

  return (
    <div className="measures" data-testid={inCheck ? 'check-measures' : 'measures'} data-kinds={inCheck ? kinds.join(' ') : undefined}>
      {!inCheck && (
        <div className="lbl">
          寸法 <small>数値で入れたもの。野帳の特記事項の最後に並びます{cfg.noteMeasures.merge ? '（同じ部位・種類は①②で1行に）' : ''}</small>
        </div>
      )}
      {rows.map(({ m, i }) => (
        <div className="measure-row" key={i} data-testid="measure-row">
          <span className="measure-line" data-testid="measure-line">
            {noteLineOf(cfg, m) || `${kindLabel(m.kind)}（数値なし）`}
          </span>
          {manualTextOf(m) && (
            <span className="tag" data-testid="measure-manual">
              手で直した文
            </span>
          )}
          {!readOnly &&
            (askRemove === i ? (
              <span className="acts">
                <button
                  type="button"
                  className="btn fill"
                  onClick={() => {
                    onChange((t) => removeMeasure(t, cfg, i));
                    setAskRemove(-1);
                  }}
                  data-testid="measure-remove-ok"
                >
                  消す
                </button>
                <button type="button" className="btn" onClick={() => setAskRemove(-1)}>
                  やめる
                </button>
              </span>
            ) : (
              <span className="acts">
                <button type="button" className="btn" onClick={() => open(i)} data-testid="measure-edit">
                  直す
                </button>
                {wordingOf(cfg, m) && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEdit(null);
                      setAskKeep(false);
                      setTextEdit({ i, value: wordingOf(cfg, m) });
                    }}
                    data-testid="measure-text-edit"
                  >
                    文を直す
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setAskRemove(i)} data-testid="measure-remove">
                  消す
                </button>
              </span>
            ))}
        </div>
      ))}

      {!readOnly && textEdit && list[textEdit.i] && (
        <div className="measure" data-testid="measure-text">
          <div className="lbl">
            出す文を直す：{kindLabel(list[textEdit.i].kind)} <small>野帳・カルテにこの文が出ます。入れた数字は変わりません</small>
          </div>
          <textarea rows={2} value={textEdit.value} onChange={(e) => setTextEdit((x) => ({ ...x, value: e.target.value }))} data-testid="measure-text-input" />
          <div className="hint" data-testid="measure-text-auto">
            数字から作った文：{autoWording(cfg, list[textEdit.i]) || '（なし）'}
          </div>
          <div className="sub">
            <button
              type="button"
              className="btn fill"
              disabled={!textEdit.value.trim()}
              onClick={() => {
                onChange((t) => setMeasureText(t, cfg, textEdit.i, textEdit.value));
                setTextEdit(null);
              }}
              data-testid="measure-text-ok"
            >
              この文にする
            </button>
            {manualTextOf(list[textEdit.i]) && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onChange((t) => setMeasureText(t, cfg, textEdit.i, ''));
                  setTextEdit(null);
                }}
                data-testid="measure-text-reset"
              >
                数字から作った文に戻す
              </button>
            )}
            <button type="button" className="btn" onClick={() => setTextEdit(null)} data-testid="measure-text-close">
              やめる
            </button>
          </div>
        </div>
      )}

      {!readOnly && !edit && canAdd && myKinds.length > 0 && (
        <button type="button" className="more" onClick={() => open(-1)} data-testid="measure-open">
          {inCheck
            ? `＋ 部位・寸法を入れる${myKinds.length > 1 ? `（${myKinds.map((k) => k.label).join('・')}）` : ''}`
            : `＋ 寸法を入れる（${myKinds.map((k) => k.label).join('・')}）`}
        </button>
      )}

      {!readOnly && edit && (
        <div className="measure" data-testid="measure">
          <div className="lbl">{edit.i >= 0 ? `寸法を直す：${kindLabel(edit.kind)}` : myKinds.length === 1 ? `${kindLabel(edit.kind)}の部位・寸法を入れる` : '寸法を入れる'}</div>
          {edit.i < 0 && myKinds.length > 1 && (
            <div className="chips" role="group" aria-label="種類">
              {myKinds.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  className={`chip${edit.kind === k.key ? ' on' : ''}`}
                  // 種類が変わると欄も変わるので、数字は空に戻す（木の入力から入れられる値は入れる）
                  onClick={() => setEdit((e) => ({ ...e, kind: k.key, values: measurePrefill(k.key, tree, cfg) }))}
                  data-measure-kind={k.key}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}
          {(edit.kind ? needPlace : true) && (
            <div className="chips" role="group" aria-label="部位">
              {(edit.kind ? measurePlaces(edit.kind, cfg) : cfg.noteMeasures.places).map((p) => (
                <button key={p} type="button" className={`chip${edit.place === p ? ' on' : ''}`} onClick={() => setEdit((e) => ({ ...e, place: p }))} data-measure-place={p}>
                  {p}
                </button>
              ))}
            </div>
          )}
          {edit.kind && (
            <PartsInputs
              parts={measureParts(edit.kind, cfg)}
              values={edit.values}
              // 芯達などの自動の印を決め直す
              onPut={(name, v) => setEdit((e) => ({ ...e, values: withAuto({ ...e.values, [name]: v }, measureParts(e.kind, cfg), name) }))}
              testId="measure"
              Choice={Choice}
              pi={cfg.calc?.pi}
              required={requiredFlags(partsNow, needPlace ? edit.place : '')}
              noAddSize // 詳しい診断と同じく、大きさは1件に1つ（別の箇所は寸法を足して入れる）
            />
          )}
          <div className="hint" data-testid="measure-preview">
            {line || (!edit.kind ? '種類を選んでください' : edit.place || !needPlace ? '数字を入れると、ここに1行が出ます' : '部位を選んでください')}
            {line && unchosen.length > 0 && <b style={{ color: "var(--warn)" }} data-testid="measure-unchosen">{`　${unchosen.join('・')}かどうかを選んでください`}</b>}
          </div>
          {askKeep ? (
            <div className="sub" data-testid="measure-ask-keep">
              <div className="hint">
                この寸法は文を手で直してあります（{oldText}）。数字を直したので、文をどうするか選んでください。
              </div>
              <button type="button" className="btn fill" onClick={() => done(false)} data-testid="measure-text-remake">
                数字から文を作り直す
              </button>
              <button type="button" className="btn" onClick={() => done(true)} data-testid="measure-text-keep">
                手で直した文のまま
              </button>
              <button type="button" className="btn" onClick={() => setAskKeep(false)}>
                戻る
              </button>
            </div>
          ) : (
            <div className="sub">
              <button type="button" className="btn fill" disabled={!line || unchosen.length > 0} onClick={() => done()} data-testid="measure-add">
                {edit.i >= 0 ? '直す' : '追加'}
              </button>
              <button type="button" className="btn" onClick={() => setEdit(null)} data-testid="measure-close">
                やめる
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
