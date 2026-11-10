import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<ユーザー名>.github.io/Shindans_photo/ で公開されるため、base を合わせる
export default defineConfig({
  base: '/Shindans_photo/',
  plugins: [react()],
  // 作った日時（日本時間）。画面の版の横に出し、新しい版になったかを見分ける
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*$/, '$1/$2 $3'),
    ),
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
  },
});
