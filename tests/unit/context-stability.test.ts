/**
 * Every React context in this app must hand out a memoised value.
 *
 * This is not a style rule. Consumers write `useCallback(..., [toastError])`
 * and feed that callback to `useEffect`. When the provider rebuilds its value
 * on every render, one failed request becomes an unbounded loop: the error
 * toast re-renders the provider, the provider hands out a new function, the
 * effect sees a new dependency and refetches. The production board did
 * exactly that -- hundreds of requests a second, until Postgres started
 * cancelling other pages' queries on their statement timeout and the
 * accounting screen silently showed no cases at all.
 *
 * Static assertions rather than a render harness: the defect is a property of
 * the source, and this suite has no DOM.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTEXT_DIR = 'src/context';
const files = readdirSync(CONTEXT_DIR).filter(name => name.endsWith('.tsx'));

/**
 * The identifiers actually handed to consumers. Only these matter: a helper
 * the provider calls from its own mount effect can be rebuilt freely, since
 * no consumer can put it in a dependency array.
 */
function exposedIdentifiers(source: string): Set<string> {
    const start = source.indexOf('useMemo(() => ({');
    if (start === -1) return new Set();
    const body = source.slice(start, source.indexOf('})', start));
    return new Set(body.match(/\w+/g) || []);
}

/**
 * Functions declared at the provider component's top level. Four-space
 * indent is this codebase's component-body level; anything deeper is a
 * local helper.
 */
function providerFunctions(source: string): string[] {
    const names: string[] = [];
    for (const line of source.split(/\r?\n/)) {
        const match = /^ {4}const (\w+) = (?:async )?\(/.exec(line);
        if (match) names.push(match[1]);
    }
    return names;
}

describe('context providers hand out stable values', () => {
    it('finds the contexts it is meant to be guarding', () => {
        expect(files).toContain('AuthContext.tsx');
        expect(files).toContain('ToastContext.tsx');
        expect(files.length).toBeGreaterThanOrEqual(4);
    });

    for (const file of files) {
        const source = readFileSync(join(CONTEXT_DIR, file), 'utf8');

        it(`${file}: Provider value is not rebuilt every render`, () => {
            expect(
                source.includes('.Provider value={{'),
                `${file} passes a fresh object literal to Provider value; wrap it in useMemo`
            ).toBe(false);
        });

        it(`${file}: functions handed to consumers are memoised`, () => {
            const exposed = exposedIdentifiers(source);
            const unmemoised = providerFunctions(source)
                .filter(name => exposed.has(name))
                .filter(name => !source.includes(`const ${name} = useCallback(`));

            expect(
                unmemoised,
                `${file}: wrap these in useCallback, or a useMemo'd value still changes identity every render`
            ).toEqual([]);
        });
    }
});
