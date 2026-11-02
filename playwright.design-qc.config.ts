import {defineConfig} from '@playwright/test';
if(process.env.DESIGN_QC_LOCAL_E2E!=='1'||!process.env.DESIGN_QC_ANON_KEY||!process.env.DESIGN_QC_ORDER_ID) throw new Error('Run scripts/design-qc-local-e2e.ps1 for isolated local fixtures');
export default defineConfig({testDir:'./tests',testMatch:'design-qc.local.qa.ts',workers:1,timeout:90000,reporter:'list',outputDir:'.tmp/design-qc-browser-results',use:{baseURL:'http://127.0.0.1:5192',channel:'chrome',headless:true},webServer:{
 command:'node node_modules/vite/bin/vite.js build --outDir .tmp/design-qc-e2e-dist && node node_modules/vite/bin/vite.js preview --outDir .tmp/design-qc-e2e-dist --host 127.0.0.1 --port 5192 --strictPort',
 url:'http://127.0.0.1:5192',timeout:180000,reuseExistingServer:false,
 env:{VITE_SUPABASE_URL:'http://127.0.0.1:56501',VITE_SUPABASE_ANON_KEY:process.env.DESIGN_QC_ANON_KEY}
}});
