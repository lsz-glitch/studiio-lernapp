import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['frontend/src/**/*.js', 'frontend/src/**/*.jsx', 'backend/**/*.mjs'],
      exclude: ['**/*.test.js', '**/*.spec.js', 'node_modules'],
    },
    globals: false,
  },
})
