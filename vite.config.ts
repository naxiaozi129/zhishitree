import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

// package.json 为 "type": "module" 时，原生 ESM 没有 __dirname，必须用 import.meta.url，否则 loadEnv 读不到项目根目录的 .env.local
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const geminiKey = String(
    env.GEMINI_API_KEY ||
      env.VITE_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      '',
  ).trim();

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      port: Number(env.VITE_DEV_PORT || env.DEV_WEB_PORT || 3010),
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target:
            env.VITE_API_PROXY_TARGET ||
            `http://127.0.0.1:${env.API_PORT || env.PORT || 8790}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: Number(env.PREVIEW_PORT || 5180),
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target:
            env.VITE_API_PROXY_TARGET ||
            `http://127.0.0.1:${env.API_PORT || env.PORT || 8790}`,
          changeOrigin: true,
        },
      },
    },
  };
});
