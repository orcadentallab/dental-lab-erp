import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const rewriteFor = (path: string) => config.rewrites.find(
    (rule: { source: string }) => new RegExp(`^${rule.source}$`).test(path),
);

describe('deployment asset routing', () => {
    it('does not serve the SPA HTML for a missing JavaScript chunk', () => {
        expect(rewriteFor('/assets/serviceFamilyService-old.js')).toBeUndefined();
        expect(rewriteFor('/assets/missing.css')).toBeUndefined();
    });

    it('keeps direct links to application pages working', () => {
        for (const path of ['/', '/orders', '/production/board', '/doctor/orders']) {
            expect(rewriteFor(path)?.destination).toBe('/index.html');
        }
    });

    it('revalidates application HTML without overriding hashed asset caching', () => {
        const cacheRules = config.headers.filter((rule: { headers: { key: string }[] }) =>
            rule.headers.some(header => header.key.toLowerCase() === 'cache-control'),
        );
        for (const path of ['/', '/index.html', '/orders']) {
            expect(cacheRules.some((rule: { source: string; headers: { key: string; value: string }[] }) =>
                new RegExp(`^${rule.source}$`).test(path)
                && rule.headers.some(header => header.value === 'no-cache'),
            )).toBe(true);
        }
        expect(cacheRules.some((rule: { source: string }) =>
            new RegExp(`^${rule.source}$`).test('/assets/index-hash.js'),
        )).toBe(false);
    });
});
