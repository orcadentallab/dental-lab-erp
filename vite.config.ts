import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'local-invoice-review',
    resolveId(id) { if(id === 'virtual:invoice-pilot') return '\0virtual:invoice-pilot'; },
    configureServer(server) {
      server.middlewares.use((req,res,next)=>{
        if(req.url?.startsWith('/__invoice-source/')) {
          if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) {res.statusCode=403;res.end();return;}
          const sources: Record<string,string> = {
            drm:'E:/LAP/مراجعة المعامل/Dr.M/10-2026/11.11.2026.pdf',
            allstars:'E:/LAP/مراجعة المعامل/Allstars/10-2026/فاتورة شهر اكتوبر ونوفمبر لد ORCA.pdf',
            harmony1:'E:/LAP/مراجعة المعامل/Harmony/New folder/1.jpeg',
            harmony2:'E:/LAP/مراجعة المعامل/Harmony/New folder/2.jpeg',
            harmony3:'E:/LAP/مراجعة المعامل/Harmony/New folder/3.jpeg'
          };
          const file=sources[req.url.split('/').pop() || ''];
          if(!file){res.statusCode=404;res.end();return;}
          try {res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.pdf')?'application/pdf':'image/jpeg');res.end(readFileSync(file));}catch{res.statusCode=404;res.end();}return;
        }
        if(req.url?.includes('virtual:invoice-pilot') && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) { res.statusCode=403;res.end('Local preview only');return; }
        next();
      });
    },
    load(id) {
      if(id !== '\0virtual:invoice-pilot') return;
      if(process.env.NODE_ENV === 'production') return 'export default null';
      try {
        const base=resolve('.tmp/invoice-pilot-2026-11-18');
        for (const file of ['documents.json','matching-results.json','sample.json']) this.addWatchFile(resolve(base,file));
        const read=(name:string)=>JSON.parse(readFileSync(resolve(base,name),'utf8'));
        return `export default ${JSON.stringify({documents:read('documents.json'),results:read('matching-results.json'),sample:read('sample.json')})}`;
      } catch { return 'export default null'; }
    }
  },
  VitePWA({
    registerType: 'autoUpdate',
    manifest: false,
    includeAssets: [
      'orca-logo.png',
      'apple-touch-icon.png',
      'favicon-32x32.png',
      'pwa-192x192.png',
      'pwa-512x512.png',
      'pwa-maskable-512x512.png',
      'sw-push.js',
    ],
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      runtimeCaching: [],
      navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/functions\//, /^\/storage\//, /^\/api\//],
      importScripts: ['/sw-push.js'],
    },
  })],
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
