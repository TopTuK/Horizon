import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: { chunkSizeWarningLimit: 700 },
  // Local development: the API runs on :8000 and the SPA on :5173. Proxying keeps everything same-origin,
  // so the session cookie works without CORS.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/auth': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
