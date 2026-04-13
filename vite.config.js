/// <reference types="vitest/config" />
import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { prdSaveImagePlugin } from './vite-plugin-prd-save-image.js';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  // Vitest 僅跑純 JS 單元測試時不需 React / 自訂外掛；略過可避免程序結束時外掛佔用導致超時提示。
  const isVitest = Boolean(process.env.VITEST);

  return {
    plugins: isVitest ? [] : [react(), prdSaveImagePlugin()],
    root: '.',
    publicDir: 'public',
    assetsInclude: ['**/*.md'],
    server: {
      host: '127.0.0.1',
      port: 6001,
      // 埠被佔用時直接失敗，不自動改用 6002/6003，避免與約定埠不一致
      strictPort: true,
    },
    preview: {
      host: '127.0.0.1',
      port: 6001,
      strictPort: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.js'],
    },
  };
});
