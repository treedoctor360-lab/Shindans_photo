// 特記事項に寸法（腐朽・空洞・鋼棒貫入など）の1行を足す欄
//  種類と部位を選び、数字の欄に入れる → 「特記事項に追加」で1行足す（記号・単位はアプリが付ける）。
//  何か所でも続けて足せる（足すたびに数字の欄は空に戻る）。書き方は設定 noteMeasures（noteMeasures.js）
import { useState } from 'react';
import { measureKinds, measureLine, measureParts, measurePlaces, measurePrefill, measureRecord } from '../core/noteMeasures.js';
import PartsInputs from './PartsInputs.jsx';
import { withAuto } from '../core/detailParts.js';

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

export default function NoteMeasures({ cfg, tree, onAdd }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [place, setPlace] = useState('');
  const [values, setValues] = useState({});
  if (!cfg.noteMeasures) return null;
  if (!open)
    return (
      <button type="button" className="more" onClick={() => setOpen(true)} data-testid="measure-open">
        ＋ 寸法を入れる（{measureKinds(cfg)
          .map((k) => k.label)
          .join('・')}）
      </button>
    );
  const line = measureLine(cfg, kind, place, values);
  return (
    <div className="measure" data-testid="measure">
      <div className="chips" role="group" aria-label="種類">
        {measureKinds(cfg).map((k) => (
          <button
            key={k.key}
            type="button"
            className={`chip${kind === k.key ? ' on' : ''}`}
            onClick={() => {
              setKind(k.key);
              setValues(measurePrefill(k.key, tree, cfg)); // 種類が変わると欄も変わるので、数字は空に戻す（木の入力から入れられる値は入れる）
            }}
            data-measure-kind={k.key}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="部位">
        {(kind ? measurePlaces(kind, cfg) : cfg.noteMeasures.places).map((p) => (
          <button key={p} type="button" className={`chip${place === p ? ' on' : ''}`} onClick={() => setPlace(p)} data-measure-place={p}>
            {p}
          </button>
        ))}
      </div>
      {kind && (
        <PartsInputs
          parts={measureParts(kind, cfg)}
          values={values}
          onPut={(name, v) => setValues((cur) => withAuto({ ...cur, [name]: v }, measureParts(kind, cfg), name))} // 芯達などの自動の印を決め直す
          testId="measure"
          Choice={Choice}
          pi={cfg.calc?.pi}
        />
      )}
      <div className="hint" data-testid="measure-preview">
        {line || (!kind ? '種類を選んでください' : place || !measurePlaces(kind, cfg).length ? '数字を入れると、ここに足す1行が出ます' : '部位を選んでください')}
      </div>
      <div className="sub">
        <button
          type="button"
          className="btn fill"
          disabled={!line}
          onClick={() => {
            // 1行と一緒に元の数字も渡す（詳しい診断の記録を作るときに、弱点の詳細へ写すため）
            onAdd(line, measureRecord(kind, measurePlaces(kind, cfg).length ? place : '', values, line));
            setValues(measurePrefill(kind, tree, cfg)); // 続けて別の所を入れられるように
          }}
          data-testid="measure-add"
        >
          特記事項に追加
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)} data-testid="measure-close">
          閉じる
        </button>
      </div>
    </div>
  );
}
