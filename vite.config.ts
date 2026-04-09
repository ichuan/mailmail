/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // Pre-bundle all third-party deps so Vite never triggers a mid-session
  // dep-optimization reload (which breaks Tauri WebView's __TAURI__ context → white screen).
  // With the full dep list here, Vite has nothing new to discover at runtime.
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'zustand',
      'clsx',
      'tailwind-merge',
      'date-fns',
      'lucide-react',
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/path',
      '@tauri-apps/api/window',
      '@tauri-apps/api/dpi',
      '@tauri-apps/plugin-shell',
    ],
  },
  build: {
    target: 'chrome105',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
