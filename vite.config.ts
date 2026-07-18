import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true
  },
  build: {
    chunkSizeWarningLimit: 1000, // 1MB
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'validation': ['zod'],
          // Keep infrequently used export/reporting dependencies out of the entry chunk.
          'pdf-vendor': ['jspdf', 'jspdf-autotable', 'html2canvas-pro'],
          'spreadsheet-vendor': ['xlsx'],
          'ui-vendor': ['lucide-react', 'framer-motion']
        }
      }
    }
  }
})
