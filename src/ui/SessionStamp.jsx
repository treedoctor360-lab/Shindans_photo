// 保存ボタンの近くに出す「保存すると記録される調査日・調査者」
//  設定の調査日・調査者の変え忘れに気づけるように。調査日が今日でなければ知らせ、ボタンで今日にできる
//  （保存は止めない。前の日の分をまとめて入れることもあるため）
import { todayYmd } from './SettingsView.jsx';

const slash = (d) => String(d || '').replace(/-/g, '/');

// kept：入力済みの記録の調査日・調査者（{ date: 'YYYY-MM-DD', inspector }）。あれば、保存してもそのままと知らせる
export default function SessionStamp({ state, update, kept = null }) {
  if (kept && (kept.date || kept.inspector)) {
    return (
      <div className="stamp" data-testid="session-stamp">
        <span>
          入力済みなので、保存しても調査日 {slash(kept.date) || '（なし）'}・調査者 {kept.inspector || '（なし）'} のままです（直すときは一覧の「調査日・調査者をまとめて直す」）
        </span>
      </div>
    );
  }
  const s = state.session || {};
  const today = todayYmd();
  const notToday = !!s.date && s.date !== today;
  return (
    <div className={`stamp${notToday ? ' not-today' : ''}`} data-testid="session-stamp">
      <span>
        保存すると記録：調査日 {slash(s.date) || '（未設定）'}・調査者 {s.inspector || '（未設定）'}
        {notToday && `。調査日が今日（${slash(today)}）ではありません`}
      </span>
      {notToday && (
        <div>
          <button type="button" className="btn" onClick={() => update((cur) => ({ ...cur, session: { ...cur.session, date: today } }))} data-testid="session-today">
            調査日を今日にする
          </button>
        </div>
      )}
    </div>
  );
}
