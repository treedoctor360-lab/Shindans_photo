// 調べるためのデータ（不具合を調べるとき、端末の状態を書き出して開発の担当に送る）
//  合言葉は書き出さない。サーバーの URL は、途中を伏せて形だけ残す
export function diagnosticDump(state, config, appVersion, now = new Date().toISOString()) {
  const server = { ...(state.server || {}) };
  delete server.pass;
  if (server.url) server.url = server.url.replace(/\/s\/[^/]+\//, '/s/…/');
  return {
    kind: 'shindans-photo-diagnostic',
    at: now,
    appVersion,
    configVersion: config?.version ?? null,
    state: { ...state, server },
  };
}
