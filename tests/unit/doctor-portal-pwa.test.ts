import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isIosSafari } from '../../src/components/doctors/PwaInstallBanner';
import { doctorPortal } from '../../src/translations/doctorPortal';

describe('Doctor Portal PWA & Web Push configuration', () => {
    it('provides a valid language-neutral webmanifest for the doctor portal', () => {
        const raw = readFileSync('public/manifest.webmanifest', 'utf8');
        const manifest = JSON.parse(raw) as {
            name: string;
            short_name: string;
            start_url: string;
            scope: string;
            display: string;
            theme_color: string;
            background_color: string;
            lang?: string;
            dir?: string;
            icons: { src: string; sizes: string; type: string; purpose?: string }[];
        };

        expect(manifest.name).toBe('Orca Doctor Portal');
        expect(manifest.short_name).toBe('Orca Portal');
        expect(manifest.start_url).toBe('/doctor/my-orders');
        expect(manifest.scope).toBe('/doctor/');
        expect(manifest.display).toBe('standalone');
        expect(manifest.theme_color).toBe('#1d4ed8');
        expect(manifest.background_color).toBe('#f8fafc');
        expect(manifest.lang).toBeUndefined();
        expect(manifest.dir).toBeUndefined();

        expect(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any')).toBe(true);
        expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any')).toBe(true);
        expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(true);

        for (const icon of manifest.icons) {
            expect(existsSync(`public${icon.src}`)).toBe(true);
        }
        expect(existsSync('public/apple-touch-icon.png')).toBe(true);
        expect(existsSync('public/favicon-32x32.png')).toBe(true);
    });

    it('configures index.html with PWA and iOS home screen meta tags', () => {
        const html = readFileSync('index.html', 'utf8');
        expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
        expect(html).toContain('<meta name="theme-color" content="#1d4ed8" />');
        expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
        expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
        expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
        expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Orca Portal" />');
    });

    it('configures vite-plugin-pwa with autoUpdate and zero API runtime caching', () => {
        const config = readFileSync('vite.config.ts', 'utf8');
        expect(config).toContain("registerType: 'autoUpdate'");
        expect(config).toContain('runtimeCaching: []');
        expect(config).toContain('/^\\/rest\\//');
        expect(config).toContain('/^\\/auth\\//');
        expect(config).toContain('/^\\/functions\\//');
        expect(config).toContain('/^\\/storage\\//');
    });

    it('detects iOS Safari user agents accurately', () => {
        expect(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe(true);
        expect(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1')).toBe(false);
        expect(isIosSafari('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36')).toBe(false);
    });

    it('fixes search placeholder double-dot and includes iOS 16.4+ push note in EN and AR', () => {
        expect(doctorPortal.en.searchOrders).not.toMatch(/ID\.\.$/);
        expect(doctorPortal.en.searchOrders).toBe('Search by patient name or case ID...');
        expect(doctorPortal.en.pwaIosPushNote).toContain('16.4');
        expect(doctorPortal.ar.pwaIosPushNote).toContain('16.4');
    });
});
