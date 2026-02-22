-- =====================================================
-- Marketing Conversion Events Table
-- Run this in Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS marketing_events (
    id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
    event_name   text         NOT NULL,            -- 'whatsapp_click' | 'pricing_cta_click' | 'engaged_session'
    source       text,                             -- 'floating_button' | 'whatsapp_exit'
    page_type    text         DEFAULT 'marketing_landing',
    device_type  text,                             -- 'mobile' | 'desktop'
    plan_title   text,                             -- only for pricing_cta_click
    plan_price   text,                             -- only for pricing_cta_click
    session_id   text,                             -- optional for deduplication
    created_at   timestamptz  DEFAULT now() NOT NULL
);

-- Index for fast date-range queries
CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at ON marketing_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_name ON marketing_events(event_name);

-- Row Level Security
ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

-- Only admins can read
CREATE POLICY "Admin read marketing_events"
    ON marketing_events FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.role = 'admin'
        )
    );

-- Allow anonymous inserts from the marketing landing page
CREATE POLICY "Public insert marketing_events"
    ON marketing_events FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- =====================================================
-- RPC: get_marketing_summary
-- Returns total clicks by event, conversion rate,
-- daily trend (30 days), device breakdown
-- =====================================================

CREATE OR REPLACE FUNCTION get_marketing_summary(
    p_start_date timestamptz DEFAULT (now() - INTERVAL '30 days'),
    p_end_date   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_build_object(
        -- 1. Total clicks by event
        'total_clicks', (
            SELECT jsonb_object_agg(event_name, cnt)
            FROM (
                SELECT event_name, COUNT(*) as cnt
                FROM marketing_events
                WHERE created_at BETWEEN p_start_date AND p_end_date
                GROUP BY event_name
            ) t
        ),

        -- 2. Conversion rate = (whatsapp_clicks / pricing_cta_clicks) * 100
        'conversion_rate', (
            SELECT CASE
                WHEN COALESCE(SUM(CASE WHEN event_name='pricing_cta_click' THEN 1 END), 0) = 0 THEN 0
                ELSE ROUND(
                    (SUM(CASE WHEN event_name='whatsapp_click' THEN 1 END)::numeric /
                     SUM(CASE WHEN event_name='pricing_cta_click' THEN 1 END)::numeric) * 100,
                    1
                )
            END
            FROM marketing_events
            WHERE created_at BETWEEN p_start_date AND p_end_date
        ),

        -- 3. Last 30 days trend by day
        'daily_trend', (
            SELECT jsonb_agg(row_to_json(t) ORDER BY t.day DESC)
            FROM (
                SELECT
                    DATE(created_at) as day,
                    SUM(CASE WHEN event_name='whatsapp_click' THEN 1 ELSE 0 END) as whatsapp_clicks,
                    SUM(CASE WHEN event_name='pricing_cta_click' THEN 1 ELSE 0 END) as pricing_clicks
                FROM marketing_events
                WHERE created_at BETWEEN p_start_date AND p_end_date
                GROUP BY DATE(created_at)
                ORDER BY DATE(created_at) DESC
                LIMIT 30
            ) t
        ),

        -- 4. Device breakdown
        'device_breakdown', (
            SELECT jsonb_object_agg(COALESCE(device_type, 'unknown'), pct)
            FROM (
                SELECT
                    device_type,
                    ROUND(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM marketing_events WHERE created_at BETWEEN p_start_date AND p_end_date), 0) * 100, 1) as pct
                FROM marketing_events
                WHERE created_at BETWEEN p_start_date AND p_end_date
                GROUP BY device_type
            ) t
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;
