import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// .env im Projektroot laden (envDir), sonst keine VITE_* in frontend/ → Supabase leer / weißer Bildschirm
const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: 'frontend',
  envDir: projectRoot,
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
