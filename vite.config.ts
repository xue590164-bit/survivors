import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 部署在 /<repo>/ 子路径；本地 dev 不受影响
  base: '/survivors/',
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 2000 },
});
