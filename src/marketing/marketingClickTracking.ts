export type MarketingClickEvent = 'whatsapp_click' | 'pricing_cta_click';

export function getMarketingClickEvents(target: Pick<HTMLElement, 'closest'>): MarketingClickEvent[] {
    const events: MarketingClickEvent[] = [];

    if (target.closest('a[href*="wa.me"]')) {
        events.push('whatsapp_click');
    }

    const inPricing = target.closest('#pricing');
    const pricingCta = target.closest('a, button');
    if (pricingCta && inPricing) {
        events.push('pricing_cta_click');
    }

    return events;
}
