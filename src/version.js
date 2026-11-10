// アプリの版番号。出力ファイルにも書き込み、どの版で作ったか追えるようにする
export const APP_VERSION = '0.2.0';

// 作った日時（月/日 時:分、日本時間）。vite.config.js で埋め込む。テストなどで埋め込まれていなければ空
// eslint-disable-next-line no-undef
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
