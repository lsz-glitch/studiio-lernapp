import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// .env liegt im Projektroot (neben dieser Datei), nicht in frontend/ — sonst lädt Vite sie nicht → weißer Bildschirm
const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: 'frontend',
  envDir: projectRoot,
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
