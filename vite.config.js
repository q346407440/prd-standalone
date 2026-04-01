import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { prdSaveImagePlugin } from './vite-plugin-prd-save-image.js';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [react(), prdSaveImagePlugin()],
    root: '.',
    publicDir: 'public',
    assetsInclude: ['**/*.md'],
    server: {
      port: 6001,
    },
    preview: {
      port: 6001,
    },
  };
});
