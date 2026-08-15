-- Migration: expand order_issues cause codes 6 -> 14, add responsible stage
--            and a documented correction trail
--
-- Why:
--   `order_issues` is the single source of truth for problem/remake analysis
--   (established by the 2026-08-12 reconciliation). Its cause taxonomy was
--   6 broad buckets -- lab / doctor / scan / design / communication / other --
--   which cannot answer "which stage caused this remake, and what did it
--   cost". This migration moves it to the 14 codes the lab actually works in,
--   and adds the responsible stage as its own column.
--
-- Data conversion is NOT fully reversible in `cause_category`, so the original
-- value is copied into `previous_cause_category` FIRST. Mapping:
--
--     design        -> cad
--     scan          -> scan_impression
--     doctor        -> doctor_side
--     lab           -> unknown   (too broad: could be any internal stage)
--     communication -> unknown   (no equivalent in the new taxonomy)
--     other         -> unknown
--     NULL          -> unknown
--
--   `lab` / `communication` / `other` collapse to `unknown` because none maps
--   to a specific stage without guessing. Guessing here would fabricate root
--   causes -- worse than admitting the old rows are uncategorised. Historical
--   rows can be re-classified later from previous_cause_category.
--
-- Correction trail: a wrong cause must be fixable WITHOUT rewriting history
-- silently, otherwise the log stops being trustworthy. Corrections record who,
-- when and why; mis-logged rows are voided (is_voided), never deleted.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Preserve the original value before any conversion
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_issues
    ADD COLUMN IF NOT EXISTS previous_cause_category TEXT;

UPDATE public.order_issues
    SET previous_cause_category = cause_category
    WHERE previous_cause_category IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Convert to the 14-code taxonomy
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_issues
    DROP CONSTRAINT IF EXISTS order_issues_cause_category_check;

UPDATE public.order_issues SET cause_category = 'cad'
    WHERE cause_category = 'design';
UPDATE public.order_issues SET cause_category = 'scan_impression'
    WHERE cause_category = 'scan';
UPDATE public.order_issues SET cause_category = 'doctor_side'
    WHERE cause_category = 'doctor';
UPDATE public.order_issues SET cause_category = 'unknown'
    WHERE cause_category IN ('lab', 'communication', 'other')
       OR cause_category IS NULL;

ALTER TABLE public.order_issues
    ADD CONSTRAINT order_issues_cause_category_check
    CHECK (cause_category IN (
        'prep', 'scan_impression', 'cad', 'fit', 'contact', 'occlusion',
        'shade', 'milling', 'material', 'finish', 'glaze',
        'doctor_side', 'logistics_damage', 'unknown'
    ));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Responsible stage
--    Nullable: historical rows have no reliable stage, and inventing one
--    would be fabrication. New entries should set it.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_issues
    ADD COLUMN IF NOT EXISTS responsible_stage TEXT;

ALTER TABLE public.order_issues
    DROP CONSTRAINT IF EXISTS order_issues_responsible_stage_check;
ALTER TABLE public.order_issues
    ADD CONSTRAINT order_issues_responsible_stage_check
    CHECK (responsible_stage IS NULL OR responsible_stage IN (
        'design', 'milling', 'finish', 'glaze', 'qc',
        'doctor', 'logistics', 'external_lab', 'unknown'
    ));

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Correction trail
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_issues
    ADD COLUMN IF NOT EXISTS corrected_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS corrected_by      UUID,
    ADD COLUMN IF NOT EXISTS correction_reason TEXT,
    ADD COLUMN IF NOT EXISTS is_voided         BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.order_issues.previous_cause_category
    IS 'Cause before the 14-code conversion (20260816000000), or before the last correction.';
COMMENT ON COLUMN public.order_issues.responsible_stage
    IS 'Production stage held responsible. NULL for historical rows.';
COMMENT ON COLUMN public.order_issues.is_voided
    IS 'Logged by mistake. Excluded from all statistics; never hard-deleted.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Update the auto-logging trigger to emit the NEW codes
--
--    CRITICAL: log_order_issue_trigger_fn() (migration 093) writes a row into
--    order_issues every time an order transitions into an issue state, using
--    the OLD 6-code vocabulary. Left untouched, the constraint added above
--    would reject those inserts and EVERY such status change would fail in
--    production. The trigger and the constraint must therefore change in the
--    same transaction.
--
--    The keyword matching now also sets responsible_stage, which the old
--    function could not express. Mapping mirrors the data conversion in
--    section 2:
--        lab           -> unknown        / stage external_lab
--        doctor        -> doctor_side    / stage doctor
--        scan          -> scan_impression/ stage doctor
--        design        -> cad            / stage design
--        communication -> unknown        / stage unknown
--        (fallback)    -> unknown        / stage NULL
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_order_issue_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_latest_comment RECORD;
    v_cause_category TEXT := 'unknown';
    v_responsible_stage TEXT := NULL;
    v_notes TEXT;
    v_reporter_name TEXT := 'system';
    v_reporter_id UUID := NULL;
    v_is_transition BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected') THEN
            v_is_transition := TRUE;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected')
           AND NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            v_is_transition := TRUE;
        END IF;
    END IF;

    IF v_is_transition THEN
        SELECT content, user_id, user_name INTO v_latest_comment
        FROM order_comments
        WHERE order_id = NEW.id
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_latest_comment.content IS NOT NULL THEN
            v_notes := v_latest_comment.content;
            v_reporter_id := v_latest_comment.user_id;
            v_reporter_name := v_latest_comment.user_name;

            -- Keyword matching is a best-effort guess, so it resolves to the
            -- broadest honest code rather than inventing a specific stage.
            IF v_notes LIKE '%معمل%' OR v_notes LIKE '%lab%' THEN
                v_cause_category := 'unknown';
                v_responsible_stage := 'external_lab';
            ELSIF v_notes LIKE '%دكتور%' OR v_notes LIKE '%doctor%' OR v_notes LIKE '%طبيب%' THEN
                v_cause_category := 'doctor_side';
                v_responsible_stage := 'doctor';
            ELSIF v_notes LIKE '%سكان%' OR v_notes LIKE '%scan%' THEN
                v_cause_category := 'scan_impression';
                v_responsible_stage := 'doctor';
            ELSIF v_notes LIKE '%تصميم%' OR v_notes LIKE '%design%' OR v_notes LIKE '%مصمم%' THEN
                v_cause_category := 'cad';
                v_responsible_stage := 'design';
            ELSIF v_notes LIKE '%تواصل%' OR v_notes LIKE '%communication%' THEN
                v_cause_category := 'unknown';
                v_responsible_stage := 'unknown';
            ELSE
                v_cause_category := 'unknown';
            END IF;
        ELSE
            v_notes := CASE NEW.issue_state
                WHEN 'returned'         THEN 'تم الإرجاع للتعديل من لوحة التحكم'
                WHEN 'rejected'         THEN 'تم رفض الحالة من لوحة التحكم'
                WHEN 'doctor_rejected'  THEN 'مرتجع طبيب - تم رفض الحالة من قبل الطبيب'
                WHEN 'lab_rejected'     THEN 'رفض معمل - تم رفض الحالة داخلياً'
                WHEN 'cancelled'        THEN 'تم إلغاء الحالة من لوحة التحكم'
                WHEN 'redo'             THEN 'تم طلب إعادة إنتاج للحالة'
                ELSE 'تغيير حالة الأوردر تلقائياً'
            END;
            v_reporter_name := 'system';
        END IF;

        INSERT INTO order_issues (
            order_id, issue_type, cause_category, responsible_stage,
            notes, reporter_id, reporter_name, created_at
        )
        VALUES (
            NEW.id, NEW.issue_state, v_cause_category, v_responsible_stage,
            v_notes, v_reporter_id, v_reporter_name, NOW()
        );
    END IF;

    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Indexes for the reporting queries
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_order_issues_created_at
    ON public.order_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_issues_cause
    ON public.order_issues (cause_category);
CREATE INDEX IF NOT EXISTS idx_order_issues_stage
    ON public.order_issues (responsible_stage);

COMMIT;
