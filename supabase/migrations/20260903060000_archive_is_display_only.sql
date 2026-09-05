-- =====================================================================
-- Migration: archiving is a display flag -- make it legible and enforce it
-- File: supabase/migrations/20260903060000_archive_is_display_only.sql
--
-- The rule (owner, 2026-09-03): archiving NEVER cancels an order and NEVER
-- removes its money. An archived order is fully real and keeps every effect
-- a non-archived one has -- revenue, cost, receivables, counts, statements.
-- Archiving only declutters the orders page and the dashboard card once a
-- case is finished and settled. `is_deleted` is the only real exclusion.
--
-- Two gaps this closes:
--
-- 1. ARCHIVE EVENTS ARE UNFINDABLE. log_order_changes has audited every
--    column since the full-row-diff version landed (first archive row
--    2026-08-06), so the flag IS recorded inside `changes` -- but `details`
--    just reads "Update Order", so no one can search the history for who
--    archived a case or when. Archive events now name themselves.
--    (Archives from before 2026-08-06 were never recorded and cannot be
--    recovered -- that is why the stale April/May cases had no archive row.)
--
-- 2. THE RULE WAS NEVER ENFORCED. Nothing stopped an update from flipping
--    is_archived while also changing the status or the money, which would
--    make archiving look like it cancelled an order or zeroed it. All 22
--    archive updates in production changed is_archived and nothing else, so
--    this guard matches what the app already does and blocks only the
--    combination that would break the rule.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '30s';

-- 1. Archive events name themselves in the history feed.
CREATE OR REPLACE FUNCTION public.log_order_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_user_id UUID := auth.uid();
    current_user_name TEXT;
    current_profile_id UUID;
    changes_json JSONB := '{}'::JSONB;
    action_desc TEXT := 'Update Order';
    old_row JSONB;
    new_row JSONB;
    field_name TEXT;
    old_value JSONB;
    new_value JSONB;
BEGIN
    SELECT id, name
    INTO current_profile_id, current_user_name
    FROM public.users
    WHERE auth_id = current_user_id;

    IF current_user_name IS NULL THEN
        current_user_name := 'System/Unknown';
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, current_profile_id, current_user_name, 'CREATE', 'Order Created', to_jsonb(NEW));
        RETURN NEW;
    END IF;

    -- Compare the complete order record. This means every business field is
    -- audited automatically, including fields added after this migration.
    -- IDs and timestamps are technical metadata, not user-facing changes.
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);

    FOR field_name, new_value IN SELECT key, value FROM jsonb_each(new_row)
    LOOP
        IF field_name = ANY (ARRAY['id', 'created_at', 'updated_at']) THEN
            CONTINUE;
        END IF;

        old_value := old_row -> field_name;
        IF new_value IS DISTINCT FROM old_value THEN
            changes_json := jsonb_set(
                changes_json,
                ARRAY[field_name],
                jsonb_build_object('old', old_value, 'new', new_value)
            );
        END IF;
    END LOOP;

    IF changes_json ? 'status' THEN
        action_desc := 'Status changed';
    ELSIF changes_json ? 'is_archived' THEN
        -- Say plainly what archiving is, so the history never reads as if
        -- the order was cancelled or written off.
        action_desc := CASE
            WHEN COALESCE(NEW.is_archived, false)
                THEN 'Order archived (hidden from the orders page and dashboard only; the order and its money are unchanged)'
            ELSE 'Order unarchived (returned to the orders page and dashboard)'
        END;
    ELSIF changes_json ? 'delivery_date' THEN
        action_desc := 'Delivery date updated';
    END IF;

    -- The only changed column was a technical column such as updated_at.
    -- Do not add a misleading audit item.
    IF changes_json = '{}'::JSONB THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
    VALUES (NEW.id, current_profile_id, current_user_name, 'UPDATE', action_desc, changes_json);

    RETURN NEW;
END;
$$;

-- 2. Archiving may not double as a cancellation or a write-off.
CREATE OR REPLACE FUNCTION public.guard_archive_is_display_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF COALESCE(NEW.is_archived, false) IS DISTINCT FROM COALESCE(OLD.is_archived, false) THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           OR COALESCE(NEW.issue_state, 'none') IS DISTINCT FROM COALESCE(OLD.issue_state, 'none')
           OR NEW.production_status IS DISTINCT FROM OLD.production_status
           OR COALESCE(NEW.total_price, 0) IS DISTINCT FROM COALESCE(OLD.total_price, 0)
           OR COALESCE(NEW.cost, 0) IS DISTINCT FROM COALESCE(OLD.cost, 0)
        THEN
            RAISE EXCEPTION
                'Archiving only hides an order; it cannot change its status or its money in the same update (order %). Make the status or price change first, then archive.',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aab_guard_archive_is_display_only ON public.orders;
CREATE TRIGGER aab_guard_archive_is_display_only
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_archive_is_display_only();

COMMENT ON COLUMN public.orders.is_archived IS
    'Display flag only. An archived order stays fully real: it keeps its revenue, cost, receivables, counts and statement entries. Archiving hides a finished, settled case from the orders page and the dashboard card. Never filter on this column in a report or an accounting query -- is_deleted is the only real exclusion.';

COMMIT;
