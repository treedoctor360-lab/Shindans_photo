// 保存ボタンの近くに出す「保存すると記録される調査日・調査者」
//  設定の調査日・調査者の変え忘れに気づけるように。調査日が今日でなければ知らせ、ボタンで今日にできる
//  （保存は止めない。前の日の分をまとめて入れることもあるため）
import { todayYmd } from './SettingsView.jsx';

const slash = (d) => String(d || '').replace(/-/g, '/');

export default function SessionStamp({ state, update }) {
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
