// 画面を自動で操作するテスト（Playwright）の設定
// ビルドしたアプリを手元のサーバーで開き、スマホの画面幅で操作する
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/Shindans_photo/',
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    // 文字コードの設定がない環境では、日本語のファイル名が "download" になるため、UTF-8 を指定する
    launchOptions: { env: { ...process.env, LC_ALL: 'C.UTF-8' } },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/Shindans_photo/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
