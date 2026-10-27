import { defineConfig, devices } from '@playwright/test';

// Dedicated UI fixtures: never use the project's production Supabase environment.
export default defineConfig({
    testDir: './tests',
    testMatch: process.env.DOCTOR_PORTAL_QA_ACCESS_MODE === 'password' ? ['doctor-password.qa.ts'] : ['doctor-portal.qa.ts', 'doctor-portal-live.qa.ts'],
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    outputDir: 'test-results/doctor-portal',
    use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure' },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort',
        url: 'http://127.0.0.1:5187',
        reuseExistingServer: false,
        env: {
            VITE_SUPABASE_URL: 'http://127.0.0.1:56431',
            VITE_SUPABASE_ANON_KEY: process.env.DOCTOR_PORTAL_QA_ANON_KEY || 'local-browser-fixture-key',
            VITE_OTP_CHANNEL: 'mock',
            VITE_DOCTOR_ACCESS_MODE: process.env.DOCTOR_PORTAL_QA_ACCESS_MODE || 'otp',
        },
    },
});
