// デスクトップ表示の左：一覧表（1本1行）
//  ・点検項目は「有」のものだけを1つの欄に並べ、まだ選んでいない項目は色付きで「未選択」と出す（空欄＝すべて無）
//  ・特記事項は2行まで（全文はマウスを重ねると出る。右の簡易診断でも見られる）
//  ・注意の欄に、簡易と詳しい診断の違い・未記入・付箋などを短い印で出す（overview.js）
//  ・「カード」に切り替えると今までの一覧（検索・追加・絞り込みなど）を使える
//  ・compact（横にしたスマホ）：幅が足りないので、簡易の状態・健全度・詳しい診断の状態の欄を出さない
import { useState } from 'react';
import { groupKeys, groupLabel, treesOfGroup } from '../core/groups.js';
import { INITIAL_STATUS_LABEL, initialStatus } from '../store/initial.js';
import { fullNotesOf } from '../core/noteMeasures.js';
import ListView, { treeState } from './ListView.jsx';
import { checksOf, flagsOf } from './overview.js';

const STATE = { todo: '未入力', wait: '初期待ち', ledger: '台帳', done: '済' };

export default function OverviewTable(props) {
  const { state, update, config: cfg, compact = false } = props;
  const full = !compact;
  const [mode, setMode] = useState('table'); // table：一覧表／cards：今までの一覧
  const [onlyFlagged, setOnlyFlagged] = useState(false); // 注意のある木だけ
  const keys = groupKeys(state.trees, cfg);
  const group = keys.includes(state.group) ? state.group : keys[0];
  const open = (id) => update((s) => ({ ...s, group, currentId: id, view: 'form' }));
  const rows = treesOfGroup(state.trees, group, cfg)
    .filter((t) => !t.deleted)
    .map((t) => ({ t, flags: flagsOf(t, state, cfg) }));
  const shown = onlyFlagged ? rows.filter((r) => r.flags.length) : rows;

  return (
    <div className="ov" data-testid="overview">
      <div className="ov-bar">
        <div className="chips" role="radiogroup" aria-label="一覧の形">
          {[
            ['table', '一覧表'],
            ['cards', 'カード'],
          ].map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={mode === v} className={`chip${mode === v ? ' on' : ''}`} onClick={() => setMode(v)} data-ov-mode={v}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'table' && (
          <label className="ov-only">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} data-testid="ov-only-flagged" />
            注意のある木だけ（{rows.filter((r) => r.flags.length).length}本）
          </label>
        )}
      </div>
      {mode === 'cards' ? (
        <ListView {...props} />
      ) : (
        <>
          <select className="ov-group" value={group} onChange={(e) => update((s) => ({ ...s, group: e.target.value }))} aria-label="公園・路線">
            {keys.map((k) => (
              <option key={k} value={k}>
                {groupLabel(state.trees, k, cfg)}
              </option>
            ))}
          </select>
          <table className="ov-t" data-testid="ov-table">
            {/* 列の幅を決めておき、有の項目・特記事項は枠の中で折り返す（右の列がはみ出さないように） */}
            <colgroup>
              <col style={{ width: 66 }} />
              <col style={{ width: compact ? 64 : 84 }} />
              {full && <col style={{ width: 62 }} />}
              <col />
              {full && <col style={{ width: 38 }} />}
              <col />
              {full && <col style={{ width: 62 }} />}
              <col style={{ width: compact ? 74 : 92 }} />
            </colgroup>
            <thead>
              <tr>
                <th>番号</th>
                <th>樹種</th>
                {full && <th>簡易</th>}
                <th>有の項目</th>
                {full && <th>健全</th>}
                <th>特記事項</th>
                {full && <th>初期</th>}
                <th>注意</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ t, flags }) => {
                const st = treeState(t, cfg);
                const { yes, blank } = checksOf(t, cfg);
                const notes = fullNotesOf(t, cfg).replace(/\n/g, '／');
                return (
                  <tr key={t.id} className={t.id === state.currentId && state.view !== 'list' ? 'sel' : ''} onClick={() => open(t.id)} data-tree={t.treeNo}>
                    <td className="no">{t.treeNo || '（番号なし）'}</td>
                    <td>{t.species}</td>
                    {full && <td className={`s-${st}`}>{STATE[st]}</td>}
                    <td className="yes-list" data-testid="ov-yes">
                      {yes.join('・')}
                      {t.done && blank.length > 0 && <span className="blank">{`${yes.length ? ' ' : ''}未選択：${blank.join('')}`}</span>}
                    </td>
                    {full && <td>{t.grade || ''}</td>}
                    <td className="note" title={notes}>
                      <div className="clamp">{notes}</div>
                    </td>
                    {full && <td>{cfg.initialSurvey && t.initialNeeded === cfg.initial?.yes ? INITIAL_STATUS_LABEL[initialStatus(t, state, cfg)] || '' : ''}</td>}
                    <td className="flags" data-testid="ov-flags">
                      {flags.map(([f, why]) => (
                        <span key={f} className="flag" title={why}>
                          {f}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="pane-empty">{onlyFlagged ? '注意のある木はありません' : '木がありません'}</p>}
        </>
      )}
    </div>
  );
}
