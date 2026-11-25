export type MarketingClickEvent =
    | 'whatsapp_click'
    | 'pricing_cta_click'
    | 'portal_register_click'
    | 'portal_login_click';

export function getMarketingClickEvents(target: Pick<HTMLElement, 'closest'>): MarketingClickEvent[] {
    const events: MarketingClickEvent[] = [];

    if (target.closest('a[href*="wa.me"]')) {
        events.push('whatsapp_click');
    }

    if (target.closest('[data-track="portal_register_click"], a[href*="/login?intent=new"]')) {
        events.push('portal_register_click');
    } else if (target.closest('[data-track="portal_login_click"], a[href="/login"]')) {
        events.push('portal_login_click');
    }

    const inPricing = target.closest('#pricing');
    const pricingCta = target.closest('a, button');
    if (pricingCta && inPricing) {
        events.push('pricing_cta_click');
    }

    return events;
}
