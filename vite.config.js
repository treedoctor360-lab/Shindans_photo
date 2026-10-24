import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<ユーザー名>.github.io/Shindans_photo/ で公開されるため、base を合わせる
export default defineConfig({
  base: '/Shindans_photo/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}'],
  },
});
