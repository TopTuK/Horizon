import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.js: tests need neither Tailwind nor the dev proxy, and images referenced by
// URL in templates must stay plain strings (the real build resolves them from `public/`).
export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls: false } })],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.js'],
  },
})
