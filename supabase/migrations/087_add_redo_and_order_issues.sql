-- Migration 087: WF-5 — Redo issue state + order_issues tracking table
--
-- CHANGES:
--   1. Add 'redo' to orders.issue_state CHECK constraint
--   2. Create order_issues table for structured issue tracking
--   3. RLS for order_issues
--   4. Backfill existing issues into order_issues
--
-- HARD GUARANTEES:
--   - orders.status column untouched
--   - finance helpers untouched
--   - migration 086 untouched

-- =====================================================================
-- 1. Extend issue_state CHECK to include 'redo'
-- =====================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_issue_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_issue_state_check CHECK (issue_state IN (
    'none','returned','rejected','cancelled','on_hold','redo'
));

-- =====================================================================
-- 2. Create order_issues table
-- =====================================================================

CREATE TABLE IF NOT EXISTS order_issues (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    issue_type       TEXT NOT NULL CHECK (issue_type IN ('returned','rejected','cancelled','redo')),
    cause_category   TEXT NOT NULL DEFAULT 'other'
                          CHECK (cause_category IN ('lab','doctor','scan','design','communication','other')),
    notes            TEXT,
    reporter_id      UUID REFERENCES users(id),
    reporter_name    TEXT,
    resolved_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_issues_order_id   ON order_issues(order_id);
CREATE INDEX IF NOT EXISTS idx_order_issues_issue_type ON order_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_order_issues_created_at ON order_issues(created_at DESC);

-- =====================================================================
-- 3. RLS for order_issues
-- =====================================================================

ALTER TABLE order_issues ENABLE ROW LEVEL SECURITY;

-- Admin and lab: full read; admin+lab: write
CREATE POLICY "order_issues_admin_lab_read" ON order_issues
    FOR SELECT TO authenticated
    USING (get_my_role() IN ('admin','lab','accountant'));

CREATE POLICY "order_issues_admin_lab_write" ON order_issues
    FOR ALL TO authenticated
    USING (get_my_role() IN ('admin','lab'))
    WITH CHECK (get_my_role() IN ('admin','lab'));

-- Designer: read only
CREATE POLICY "order_issues_designer_read" ON order_issues
    FOR SELECT TO authenticated
    USING (get_my_role() = 'designer');

-- Representative: read own orders' issues only
CREATE POLICY "order_issues_rep_read_own" ON order_issues
    FOR SELECT TO authenticated
    USING (
        get_my_role() = 'representative'
        AND order_id IN (
            SELECT id FROM orders
            WHERE representative_id = (
                SELECT id FROM users WHERE auth_id = auth.uid()
            )
        )
    );

-- =====================================================================
-- 4. Backfill existing issues
-- =====================================================================

INSERT INTO order_issues (order_id, issue_type, cause_category, notes, reporter_name)
SELECT
    id,
    CASE status
        WHEN 'Returned for Adjustments' THEN 'returned'
        WHEN 'Rejected'                 THEN 'rejected'
        WHEN 'Cancelled'                THEN 'cancelled'
    END,
    'other',
    'مهجرة تلقائياً من البيانات الموجودة',
    'system'
FROM orders
WHERE status IN ('Returned for Adjustments', 'Rejected', 'Cancelled')
  AND issue_state IN ('returned', 'rejected', 'cancelled');

DO $$ BEGIN
    RAISE NOTICE 'Migration 087 complete: redo added to issue_state; order_issues table created and backfilled.';
END $$;
