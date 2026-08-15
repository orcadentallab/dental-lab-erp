import { describe, expect, it } from 'vitest';
import { getMarketingClickEvents } from '../../src/marketing/marketingClickTracking';

function clickTarget(selectors: string[]) {
    return {
        closest: (selector: string) => selectors.includes(selector) ? {} : null,
    } as Pick<HTMLElement, 'closest'>;
}

describe('marketing pricing CTA tracking', () => {
    it('tracks both WhatsApp intent and pricing conversion for a WhatsApp link in pricing', () => {
        const target = clickTarget(['a[href*="wa.me"]', '#pricing', 'a, button']);

        expect(getMarketingClickEvents(target)).toEqual([
            'whatsapp_click',
            'pricing_cta_click',
        ]);
    });

    it('tracks any link or button inside the pricing section as a pricing CTA', () => {
        const target = clickTarget(['#pricing', 'a, button']);

        expect(getMarketingClickEvents(target)).toEqual(['pricing_cta_click']);
    });

    it('does not track a non-interactive click inside the pricing section', () => {
        const target = clickTarget(['#pricing']);

        expect(getMarketingClickEvents(target)).toEqual([]);
    });
});
