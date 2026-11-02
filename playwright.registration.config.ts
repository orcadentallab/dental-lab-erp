import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: 'external-registration-retirement.spec.ts',
    timeout: 90000,
    reporter: 'list',
    outputDir: '.tmp/registration-browser-results',
    use: { baseURL: 'http://127.0.0.1:5187', headless: true, channel: 'chrome' },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js build --outDir .tmp/registration-dist && node node_modules/vite/bin/vite.js preview --outDir .tmp/registration-dist --host 127.0.0.1 --port 5187 --strictPort',
        url: 'http://127.0.0.1:5187',
        timeout: 180000,
        reuseExistingServer: false,
        env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'offline-local-test-key' },
    },
});
