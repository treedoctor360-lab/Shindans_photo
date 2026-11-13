// 設定画面：調査情報、設定ファイル・野帳の原本・台帳の読み込み
import { useState } from 'react';
import { importEntrySheets } from '../core/entrySheet.js';
import { readEntrySheets } from '../excel/entrySheetRead.js';
import { bookCount } from '../store/initial.js';
import { idbPut } from '../store/idb.js';
import { needsNewWorkspace, rememberTitle, putConfigInWorkspace } from '../store/workspace.js';
import WorkspaceSection from './WorkspaceSection.jsx';
import { applyLedger, loadConfigText, importInitialBook, readKarteTemplateFile, readLedgerFile, saveTemplate } from '../store/state.js';
import { karteConfs } from '../excel/karteExport.js';
import PrevSection from './PrevSection.jsx';
import { diagnosticDump } from '../store/diagnose.js';
import { APP_VERSION, BUILD_TIME } from '../version.js';
import ServerSection from './ServerSection.jsx';

// 今日の日付 "2099-04-05"（端末の時刻で）
export const todayYmd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ファイル選択ボタン（見た目はボタン、中身は <input type="file">）
function FileButton({ label, accept, onFile, disabled, testId }) {
  return (
    <label className={`btn big file-btn${disabled ? ' disabled' : ''}`} aria-disabled={disabled}>
      {label}
      <input
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // 同じファイルをもう一度選べるように
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

export default function SettingsView({ state, update, config, setConfig, toast, flush }) {
  const [configErrors, setConfigErrors] = useState([]);
  const [askWorkspace, setAskWorkspace] = useState(null); // 名前の違う設定：新しい業務として始めるか聞いている間の設定
  const [busy, setBusy] = useState(false);
  const s = state.session;
  const setSession = (k, v) => update((st) => ({ ...st, session: { ...st.session, [k]: v } }));

  const onConfig = async (file) => {
    // まず確かめるだけ（業務の名前が違えば、どこに入れるかを聞いてから保存する）
    const r = await loadConfigText(await file.text(), config, { save: false });
    setConfigErrors(r.errors);
    setAskWorkspace(null);
    if (r.errors.length) {
      toast(config ? '設定ファイルに誤りがあるため、前の設定のまま使います' : '設定ファイルに誤りがあります');
      return;
    }
    if (needsNewWorkspace(state, config, r.config)) return setAskWorkspace(r.config);
    await loadHere(r.config);
  };

  // 今の業務に読み込む
  const loadHere = async (next) => {
    await idbPut('config', next);
    setAskWorkspace(null);
    setConfig(next);
    toast('設定ファイルを読み込みました');
    rememberTitle(next.job?.title).catch(() => {}); // 業務の一覧に出す名前（画面を待たせない）
  };

  // 別の業務として使う（今の業務の入力内容はそのまま残す）→ 画面を読み込み直す
  const loadAsNew = async (next) => {
    try {
      await flush(); // 待っている保存を、今の業務の置き場所に書き切ってから
      await putConfigInWorkspace(next);
      window.location.reload();
    } catch (e) {
      toast(e.message || '切り替えられませんでした');
    }
  };

  const onTemplate = async (file) => {
    await saveTemplate(file.name, await file.arrayBuffer());
    update((st) => ({ ...st, templateName: file.name }));
    toast('野帳の原本を読み込みました');
  };

  // 入力表（Excel。1本1行。紙の野帳を写した表）を読み込んで、木にする（設定 entrySheet）
  const [entryResult, setEntryResult] = useState(null); // { stats, errors }
  const onEntrySheet = async (file) => {
    setBusy(true);
    try {
      const sheets = await readEntrySheets(await file.arrayBuffer(), config);
      let r;
      // 読み終わってから、その時点の最新の状態に足す（読んでいる間に届いた変更を上書きしないように）
      await update((st) => {
        r = importEntrySheets(st, config, sheets);
        return r.state;
      }, { now: true });
      setEntryResult({ stats: r.stats, errors: r.errors });
      toast(r.stats.added.length ? `${r.stats.added.length}本を読み込みました` + (r.stats.check.length ? `（うち${r.stats.check.length}本は確かめてください）` : '') : '読み込む木がありませんでした');
    } catch (e) {
      toast(`入力表を読めませんでした：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const onLedger = async (file) => {
    setBusy(true);
    try {
      // 読み終わってから、その時点の最新の状態に入れる（読んでいる間に届いた変更を上書きしないように）
      const parsed = await readLedgerFile(file.name, await file.arrayBuffer(), config, todayYmd());
      let r;
      await update((st) => {
        r = applyLedger(st, parsed, config);
        return { ...r.state, group: st.group || '' };
      }, { now: true });
      const st = r.stats;
      toast(
        `${st.all}本を読み込みました（台帳で入力済み${st.done}本）` +
          (st.conflicts ? `。うち${st.conflicts}本はアプリでも入力済みだったため、台帳を正としました` : '') +
          (st.duplicates.length ? `。番号の重複：${st.duplicates.join('・')}` : '') +
          // 現場で追加した木：同じ番号・同じ場所の台帳の行に結び付けたもの、結び付かなかったもの
          (st.addedBound?.length ? `。追加した木${st.addedBound.length}本を台帳の行に結び付けました（${st.addedBound.slice(0, 5).join('・')}${st.addedBound.length > 5 ? 'ほか' : ''}）` : '') +
          (st.speciesDiff?.length ? `。そのうち樹種が台帳と違う木：${st.speciesDiff.slice(0, 5).join('・')}` : '') +
          (st.addedLeft?.length ? `。台帳の行と結び付かなかった追加の木${st.addedLeft.length}本（${st.addedLeft.slice(0, 5).join('・')}${st.addedLeft.length > 5 ? 'ほか' : ''}）は、一覧表に行が入るまで書き込みません（出力の「差し込む行の一覧」を内勤さんに渡してください）` : '') +
          (st.rebound?.length ? `。同じ番号の行が別の場所に入ったため、入力を場所の合う行に付け替えました：${st.rebound.slice(0, 5).join('・')}（中身を確かめてください）` : '') +
          (st.placeMoved?.length ? `。【注意】同じ番号の行の場所が変わった木：${st.placeMoved.slice(0, 5).join('・')}（別の木の行に当たっていないか確かめてください）` : '') +
          (st.goneKept?.length ? `。一覧表から消えた木のうち、詳しい診断の記録・付箋がある${st.goneKept.length}本（${st.goneKept.slice(0, 5).join('・')}）は残しました` : '') +
          (st.goneBlank?.length ? `。一覧表から消えた空の木${st.goneBlank.length}本（${st.goneBlank.slice(0, 5).join('・')}${st.goneBlank.length > 5 ? 'ほか' : ''}）を外しました` : '') +
          (st.draftsRemoved?.length ? `（開いただけの詳しい診断の下書き${st.draftsRemoved.length}件も外しました：${st.draftsRemoved.join('・')}）` : '') +
          (st.goneRemoved?.length ? `。一覧表から消えた台帳の写し${st.goneRemoved.length}本（${st.goneRemoved.slice(0, 5).join('・')}${st.goneRemoved.length > 5 ? 'ほか' : ''}）を外しました` : ''),
      );
    } catch (e) {
      toast(e.message || '台帳を読み込めませんでした');
    } finally {
      setBusy(false);
    }
  };

  // 詳しい診断のデータ入力用ブック（設定に initialSurvey があるときだけ）
  const onInitialBook = async (file) => {
    setBusy(true);
    try {
      const r = await importInitialBook(state, file.name, await file.arrayBuffer(), config, todayYmd());
      await update((st) => ({ ...st, initialBookInfo: r.state.initialBookInfo }), { now: true });
      const info = r.state.initialBookInfo;
      toast(
        info.errors.length
          ? `見出しが設定と違うシートがあります（${info.errors.length}か所）。そのシートは使いません`
          : `データ入力用ブックを読み込みました（入力済み${bookCount(info)}本）`,
      );
    } catch (e) {
      toast(e.message || 'データ入力用ブックを読み込めませんでした');
    } finally {
      setBusy(false);
    }
  };
  const book = state.initialBookInfo;

  // カルテの様式（設定に karte か initialSurvey.karte があるときだけ）
  const onKarteTemplate = async (file) => {
    setBusy(true);
    try {
      const info = await readKarteTemplateFile(file.name, await file.arrayBuffer(), config, todayYmd());
      await update((st) => ({ ...st, karteTemplateInfo: info }), { now: true });
      toast(info.errors.length ? `様式に設定と違う所があります（${info.errors.length}か所）` : `カルテの様式を読み込みました（${info.sheets.length}種類）`);
    } catch (e) {
      toast(e.message || 'カルテの様式を読み込めませんでした');
    } finally {
      setBusy(false);
    }
  };
  const kt = state.karteTemplateInfo;

  return (
    <section className="view settings">
      <div className="sec">
        <h2>調査情報</h2>
        <div className="row">
          <label className="lbl" htmlFor="s-date">調査日</label>
          <input type="date" id="s-date" value={s.date} onChange={(e) => setSession('date', e.target.value)} />
        </div>
        <div className="row">
          <label className="lbl" htmlFor="s-insp">
            調査者 <small>例：姓 名(資格)・姓 名(資格)</small>
          </label>
          <input type="text" id="s-insp" value={s.inspector} onChange={(e) => setSession('inspector', e.target.value)} />
        </div>
        <p className="hint">木を保存するとき、この日付と調査者をその木に記録します。</p>
      </div>

      <WorkspaceSection flush={flush} toast={toast} />

      <ServerSection state={state} update={update} config={config} setConfig={setConfig} toast={toast} />

      <div className="sec">
        <h2>設定ファイル</h2>
        <div className="hint" data-testid="config-status">
          {config ? (
            <>
              <span className="ok">読み込み済み</span>：{config.job?.title || '（名前なし）'}（版 {config.version}）
            </>
          ) : (
            'まだ読み込んでいません。選択肢・定型文・判定の基準・Excel の書式は、設定ファイルから読み込みます。'
          )}
        </div>
        <FileButton label="設定ファイル（JSON）を読み込む" accept=".json,application/json" onFile={onConfig} testId="config-file" />
        {askWorkspace && (
          <div className="alert danger" role="alert" data-testid="workspace-ask">
            <span>
              読み込んだ設定の業務「{askWorkspace.job?.title || '（名前なし）'}」は、今の業務「{config?.job?.title || '（名前なし）'}」と違います。この端末には今の業務の木が
              {state.trees.length}本あります。
            </span>
            <div className="acts">
              <button type="button" className="btn" onClick={() => loadAsNew(askWorkspace)} data-testid="workspace-new">
                別の業務として使う（今の業務の入力内容はそのまま残す）
              </button>
              <button type="button" className="btn" onClick={() => loadHere(askWorkspace)} data-testid="workspace-here">
                今の業務の設定を入れ替える
              </button>
              <button type="button" className="btn" onClick={() => setAskWorkspace(null)}>
                やめる
              </button>
            </div>
          </div>
        )}
        {configErrors.length > 0 && (
          <div className="alert danger" role="alert">
            <b>設定ファイルの誤り（{configErrors.length}件）</b>
            <ul className="err">
              {configErrors.slice(0, 10).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="sec">
        <h2>野帳の原本</h2>
        <div className="hint" data-testid="template-status">
          {state.templateName ? (
            <>
              <span className="ok">読み込み済み</span>：{state.templateName}
            </>
          ) : (
            'まだ読み込んでいません。野帳の Excel 出力に使う、空の様式のファイルです。'
          )}
        </div>
        <FileButton label="野帳の原本（Excel）を読み込む" accept=".xlsx" onFile={onTemplate} testId="template-file" />
      </div>

      {config?.entrySheet && (state.user?.role || 'surveyor') === 'surveyor' && (
        <div className="sec" data-testid="entry-sheet-sec">
          <h2>入力表（紙の野帳を写した Excel）</h2>
          <FileButton label={busy ? '読み込み中…' : '入力表（Excel）を読み込む'} accept=".xlsx" onFile={onEntrySheet} disabled={busy} testId="entry-sheet-file" />
          <p className="hint">
            1本1行の入力表から木を作ります。すでにある番号の木は読み込みません（上書きしません）。備考の略記は寸法や特記事項に直します。読み取れなかった所がある木は「入力中」のままにするので、開いて確かめてから保存してください。
          </p>
          {entryResult && (
            <div className="alert warn" data-testid="entry-sheet-result">
              <span>
                読み込んだ木：{entryResult.stats.added.length}本
                {entryResult.stats.skipped.length > 0 && `／すでにあったので読み込まなかった木：${entryResult.stats.skipped.length}本（${entryResult.stats.skipped.slice(0, 10).join('・')}${entryResult.stats.skipped.length > 10 ? 'ほか' : ''}）`}
              </span>
              {entryResult.errors.map((e) => <span key={e}>{e}</span>)}
              {entryResult.stats.check.length > 0 && <span>確かめる木（入力中のままにしました）：</span>}
              {entryResult.stats.check.slice(0, 40).map((c) => (
                <span key={`${c.sheet}|${c.treeNo}`}>
                  ・{c.sheet} {c.treeNo}：{c.why.join('／')}
                </span>
              ))}
              {entryResult.stats.check.length > 40 && <span>ほか{entryResult.stats.check.length - 40}本</span>}
            </div>
          )}
        </div>
      )}

      <div className="sec">
        <h2>台帳（樹木の一覧表）</h2>
        <div className="hint" data-testid="ledger-status">
          {state.ledgerInfo ? (
            <>
              <span className="ok">読み込み済み</span>：{state.ledgerInfo.name}（{state.ledgerInfo.date}）・{state.trees.length}本
            </>
          ) : (
            'まだ読み込んでいません。'
          )}
        </div>
        <FileButton
          label={busy ? '読み込み中…' : '台帳（Excel）を読み込む'}
          accept=".xlsx,.xlsm"
          onFile={onLedger}
          disabled={!config || busy}
          testId="ledger-file"
        />
        {!config && <p className="hint">先に設定ファイルを読み込んでください（台帳の列の探し方が設定に入っています）。</p>}
        <p className="hint">
          樹木番号・樹種・場所を取り込みます。台帳で入力済みの木は読み取り専用になり、二重調査を防ぎます。アプリで入力した内容は消えません（台帳でも入力済みなら、台帳を正としてアプリの入力は控えに残します）。
        </p>
      </div>

      {config?.initialSurvey && (
        <div className="sec">
          <h2>データ入力用ブック（{config.initialSurvey.label}）</h2>
          <div className="hint" data-testid="initial-book-status">
            {book ? (
              <>
                <span className="ok">読み込み済み</span>：{book.name}（{book.date}）・入力済み{bookCount(book)}本
              </>
            ) : (
              'まだ読み込んでいません。'
            )}
          </div>
          {book?.errors?.length > 0 && (
            <div className="alert warn" data-testid="initial-book-errors">
              <span>見出しが設定と違うため、次のシートは使いません（列の並びが変わっていないか確かめてください）。</span>
              {book.errors.map((e) => (
                <span key={e}>・{e}</span>
              ))}
            </div>
          )}
          <FileButton
            label={busy ? '読み込み中…' : 'データ入力用ブック（Excel）を読み込む'}
            accept=".xlsx,.xlsm"
            onFile={onInitialBook}
            disabled={busy}
            testId="initial-book-file"
          />
          <p className="hint">手で入力済みの木を知り、二重入力を防ぎます。列の並びは変えずに、空いている行へ書き込みます（書き込みは出力の画面から）。</p>
        </div>
      )}

      {karteConfs(config).length > 0 && (
        <div className="sec">
          <h2>カルテの様式{config.initialSurvey?.karte ? '（確認用カルテ）' : ''}</h2>
          <div className="hint" data-testid="karte-template-status">
            {kt ? (
              <>
                <span className="ok">読み込み済み</span>：{kt.name}（{kt.date}）・{kt.sheets.join('・')}
              </>
            ) : (
              'まだ読み込んでいません。'
            )}
          </div>
          {kt?.errors?.length > 0 && (
            <div className="alert warn" data-testid="karte-template-errors">
              <span>様式が設定と違うため、カルテを作れません。様式のシートが変わっていないか確かめてください。</span>
              {kt.errors.map((e) => (
                <span key={e}>・{e}</span>
              ))}
            </div>
          )}
          <FileButton
            label={busy ? '読み込み中…' : 'カルテの様式が入ったブック（Excel）を読み込む'}
            accept=".xlsx,.xlsm"
            onFile={onKarteTemplate}
            disabled={busy}
            testId="karte-template-file"
          />
          <p className="hint">
            {config.initialSurvey?.karte
              ? 'カルテを作るマクロの入ったブックなど、空のカルテの様式があるブックを選びます。「サーバーに置く」で調査者の端末にも渡し、詳しい診断の画面の「カルテで見る」で使えます（マクロは動かしません）。確認用カルテは「出力」から作ります。'
              : '空のカルテの様式があるブックを選びます。カルテは「出力」から作ります（1本1シート）。「サーバーに置く」で調査者の端末にも渡せます。'}
          </p>
        </div>
      )}

      <PrevSection config={config} toast={toast} />

      <div className="sec">
        <h2>不具合を調べるとき</h2>
        <button
          type="button"
          className="btn"
          data-testid="diagnostic"
          onClick={() => {
            const json = JSON.stringify(diagnosticDump(state, config, BUILD_TIME ? `${APP_VERSION} (${BUILD_TIME})` : APP_VERSION), null, 1);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            a.download = `調べるためのデータ_${todayYmd().replace(/-/g, '')}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }}
        >
          調べるためのデータを書き出す
        </button>
        <p className="hint">この端末の入力内容と状態を1つのファイルにします（合言葉は入りません）。おかしな動きがあったとき、開発の担当に送ってください。</p>
      </div>
    </section>
  );
}
