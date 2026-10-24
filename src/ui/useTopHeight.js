// 上の帯（表題）の高さを測り、CSS の変数 --top-h に入れる
//  入力画面で樹木番号の帯・区切りの見出しを「上の帯のすぐ下」に止めるために使う。
//  帯の高さは、文字が折り返したり画面を横にしたりすると変わるので、変わるたびに測り直す
//  （ResizeObserver：要素の大きさが変わったら知らせてくれるブラウザの仕組み）
import { useEffect } from 'react';

export function useTopHeight(ready) {
  useHeightVar('.top', '--top-h', ready);
}

// 入力画面の樹木番号の帯（.tree-bar）の高さを --bar-h に入れる（詳しい診断の区切りの見出しを、帯の下に止めるため）
export function useBarHeight() {
  useHeightVar('.tree-bar', '--bar-h', true);
}

function useHeightVar(selector, name, ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const bar = document.querySelector(selector);
    if (!bar) return undefined;
    const set = () => document.documentElement.style.setProperty(name, `${bar.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', set);
      return () => window.removeEventListener('resize', set);
    }
    const ro = new ResizeObserver(set);
    ro.observe(bar, { box: 'border-box' }); // 余白も含めた高さで見る
    return () => ro.disconnect();
  }, [ready, selector, name]);
}
