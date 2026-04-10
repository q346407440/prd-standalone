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
      port: 6001,
    },
    preview: {
      port: 6001,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.js'],
    },
  };
});
