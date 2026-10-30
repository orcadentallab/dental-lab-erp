import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const routes = config.routes as { src?: string; handle?: string; dest?: string; status?: number; continue?: boolean }[];
const routeFor = (path: string) => routes.find(
    rule => rule.src && new RegExp(`^${rule.src}$`).test(path),
);

describe('deployment asset routing', () => {
    it('does not serve the SPA HTML for a missing JavaScript chunk', () => {
        const filesystem = routes.findIndex(rule => rule.handle === 'filesystem');
        const missingAssetRule = routes.findIndex(rule => rule.status === 404 && rule.src === '/assets/.*');
        expect(filesystem).toBeGreaterThanOrEqual(0);
        expect(missingAssetRule).toBeGreaterThan(filesystem);
        expect(routeFor('/assets/serviceFamilyService-old.js')?.status).toBeUndefined();
        expect(routeFor('/assets/missing.css')?.status).toBeUndefined();
        expect(routes[missingAssetRule].status).toBe(404);
    });

    it('keeps direct links to application pages working', () => {
        for (const path of ['/', '/orders', '/production/board', '/doctor/orders']) {
            const filesystem = routes.findIndex(rule => rule.handle === 'filesystem');
            const fallback = routes.findIndex(rule => rule.dest === '/index.html');
            expect(fallback).toBeGreaterThan(filesystem);
        }
    });

    it('revalidates application HTML without overriding hashed asset caching', () => {
        const assetHeader = routeFor('/assets/index-hash.js')?.headers;
        const appHeader = routeFor('/orders')?.headers;
        for (const path of ['/', '/index.html', '/orders']) {
            expect(routeFor(path)?.headers?.['Cache-Control']).toBe('no-cache');
        }
        expect(assetHeader['Cache-Control']).toBe('public, max-age=31536000, immutable');
        expect(appHeader['Cache-Control']).toBe('no-cache');
    });
});
