import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend sources live in ui/; the Tauri Rust core lives in src-tauri/.
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome110',
  },
})
