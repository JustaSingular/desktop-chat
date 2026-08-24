import { defineConfig } from 'vite'

// Tauri expects a fixed port and relative asset paths.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome110' },
})
