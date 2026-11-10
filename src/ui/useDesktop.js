// デスクトップ表示（一覧・簡易診断・詳しい診断を横に並べる）の切り替え
//  ・画面の幅が十分あるとき（WIDE 以上）か、スマホ・タブレットを横にしたとき（COMPACT）だけ使える。狭くなったら（縦に戻したら）自動で今までの表示に戻る
//  ・横にしたスマホ（compact）は幅が足りないので、一覧（左）と、簡易診断／詳しい診断を切り替えて出す列（右）の2列
//  ・オン／オフは端末ごとに覚える（ブラウザの localStorage。使えない環境では覚えないだけ）
import { useEffect, useState } from 'react';

export const DESKTOP_WIDE = '(min-width: 1100px)';
export const DESKTOP_COMPACT = '(orientation: landscape) and (min-width: 640px)';
const KEY = 'shindans.desktopView';

const load = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
const keep = (on) => {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // 覚えられなくても、表示の切り替えはそのまま使える
  }
};

const match = (q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

// 返す値：{ wide: 使える画面か, compact: 横にしたスマホなどの2列か, on: オンにしてあるか, active: 今デスクトップ表示か, toggle: 切り替える }
export function useDesktop() {
  const [wideNow, setWideNow] = useState(() => !!match(DESKTOP_WIDE)?.matches);
  const [landNow, setLandNow] = useState(() => !!match(DESKTOP_COMPACT)?.matches);
  const [on, setOn] = useState(load);
  useEffect(() => {
    const pairs = [
      [match(DESKTOP_WIDE), setWideNow],
      [match(DESKTOP_COMPACT), setLandNow],
    ].filter(([mq]) => mq);
    const offs = pairs.map(([mq, set]) => {
      const onChange = (e) => set(e.matches);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    });
    return () => offs.forEach((off) => off());
  }, []);
  const toggle = () =>
    setOn((v) => {
      keep(!v);
      return !v;
    });
  const wide = wideNow || landNow;
  return { wide, compact: !wideNow && landNow, on, active: wide && on, toggle };
}
