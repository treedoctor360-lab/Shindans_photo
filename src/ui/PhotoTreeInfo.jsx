// 写真の画面（③ カルテに貼る写真を選ぶ）で、選んでいる木の入力内容を横（狭い画面では下半分）に出す
//  見出し（弱点の名前など）を書くときに、その木に何を記録したかを見ながら選べるようにする。見るだけ
//  「カルテで見る」で、簡易診断のカルテの形（KarteView。設定 karte と様式があるとき）に切り替える
import { useState } from 'react';
import { girthOf } from '../core/calc.js';
import { photoPlan } from '../core/photo.js';
import { simpleKarteRecord } from '../core/simpleKarte.js';
import { isFelled } from '../core/tree.js';
import { toHalf } from '../core/text.js';
import KarteView from './KarteView.jsx';

const str = (v) => (v == null ? '' : String(v).trim());

// 点検項目のうち、書いておく値か（未選択・「無」のような値は出さない）
function shown(c, v, cfg) {
  if (!str(v)) return false;
  const none = c.none ?? cfg.noneValue ?? '無';
  return v !== none;
}

export default function PhotoTreeInfo({ state, cfg, tree, onClose }) {
  const [karte, setKarte] = useState(false);
  const rec = simpleKarteRecord(tree, cfg);
  const felled = isFelled(tree, cfg);
  const g = girthOf(tree, cfg);
  const size = [
    str(tree.height) && `樹高 ${tree.height}m`,
    g != null && g !== '' && `幹周 ${g}m`,
    ...(cfg.extraFields || []).filter((f) => str(tree[f.key])).map((f) => `${f.label} ${tree[f.key]}${f.unit || ''}`),
    (str(tree.branchLen) || str(tree.branchDia)) && `枝長/枝径 ${str(tree.branchLen)}/${str(tree.branchDia)}`,
    str(tree.vigor) && `樹勢 ${tree.vigor}`,
    !cfg.noGrade && str(tree.grade) && `健全度 ${tree.grade}`,
  ].filter(Boolean);
  // 「有」などの点検項目と、そのとき入れた内容（部位・寸法・種類）
  const checks = felled ? [] : (cfg.checks || []).filter((c) => shown(c, tree[c.key], cfg)).map((c) => ({ c, v: tree[c.key], detail: str(rec[`@check:${c.key}`]) }));
  const details = (cfg.details || []).filter((d) => d.when?.field && !(cfg.checks || []).some((c) => c.key === d.when.field) && tree[d.when.field] === d.when.eq && str(tree[d.field]));
  const shoot = felled ? [] : photoPlan(tree, cfg).shoot.map((s) => s.name).filter(Boolean);
  const canKarte = !!cfg.karte;

  return (
    <aside className="kp-info" aria-label="この木の情報" data-testid="kp-info">
      <div className="kp-info-bar">
        <b>
          No.{toHalf(tree.treeNo).trim() || '番号なし'} {tree.species}
          {!tree.done && <span className="hint">（入力中）</span>}
        </b>
        {canKarte && (
          <span className="seg">
            <button type="button" className={`seg-b${!karte ? ' on' : ''}`} onClick={() => setKarte(false)} data-testid="kp-info-text">
              入力内容
            </button>
            <button type="button" className={`seg-b${karte ? ' on' : ''}`} onClick={() => setKarte(true)} data-testid="kp-info-karte">
              カルテ
            </button>
          </span>
        )}
        <button type="button" className="btn" onClick={onClose} data-testid="kp-info-close">
          隠す
        </button>
      </div>
      {karte ? (
        <div className="kp-info-karte">
          <KarteView state={state} cfg={cfg} tree={tree} embed onClose={() => setKarte(false)} />
        </div>
      ) : (
        <div className="kp-info-body">
          {felled && <p>伐採済み</p>}
          {size.length > 0 && <p className="kp-info-size">{size.join('　')}</p>}
          {checks.length > 0 ? (
            <dl className="kp-info-dl">
              {checks.map(({ c, v, detail }) => (
                <div key={c.key}>
                  <dt>{c.label}</dt>
                  <dd>
                    {v}
                    {detail && `：${detail}`}
                  </dd>
                </div>
              ))}
              {details.map((d) => (
                <div key={d.field}>
                  <dt>{d.label}</dt>
                  <dd>{tree[d.field]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            !felled && <p className="hint">「有」の点検項目はありません。</p>
          )}
          {str(rec['@notes']) && (
            <>
              <h4>特記事項</h4>
              <p className="kp-info-notes">{rec['@notes']}</p>
            </>
          )}
          {shoot.length > 0 && (
            <>
              <h4>撮る写真（見出しの候補）</h4>
              <p>{shoot.join('・')}</p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
