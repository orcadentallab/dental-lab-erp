/* eslint-disable @typescript-eslint/consistent-type-assertions */
/**
 * marketingService.ts
 *
 * Handles marketing_events table:
 * - Logging conversion events from the landing page
 * - Fetching aggregated summaries for the admin dashboard
 */

import { supabase } from '../../lib/supabase';

// ─── TYPES ────────────────────────────────────────────────────────

export interface MarketingEvent {
    event_name: 'whatsapp_click' | 'pricing_cta_click' | 'engaged_session';
    source?: string;
    page_type?: string;
    device_type?: 'mobile' | 'desktop';
    plan_title?: string;
    plan_price?: string;
    session_id?: string;
}

export interface DailyTrendPoint {
    day: string;
    whatsapp_clicks: number;
    pricing_clicks: number;
}

export interface MarketingSummary {
    total_clicks: Record<string, number>;
    conversion_rate: number;
    daily_trend: DailyTrendPoint[];
    device_breakdown: Record<string, number>;
}

// ─── SERVICE ──────────────────────────────────────────────────────

export const marketingService = {

    /**
     * Logs a conversion event from the landing page.
     * Uses unauthenticated (anon) client — public insert policy allows this.
     */
    async logEvent(event: MarketingEvent): Promise<void> {
        const { error } = await supabase.from('marketing_events').insert([event]);
        if (error) {
            console.warn('[MarketingService] Event log failed:', error.message);
        }
    },

    /**
     * Fetches aggregated marketing summary for the admin dashboard.
     * Calls the get_marketing_summary RPC.
     */
    async getSummary(startDate?: string, endDate?: string): Promise<MarketingSummary> {
        const { data, error } = await supabase.rpc('get_marketing_summary', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('[MarketingService] Summary fetch failed:', error);
            throw error;
        }

        return data as MarketingSummary;
    },
};
