-- Section 3: Non-terminal statuses
UPDATE orders SET production_status = CASE
    WHEN status IN ('Delivered','Completed')                                   THEN 'final_delivered'
    WHEN status = 'Try In Approved'                                            THEN 'finalization'
    WHEN status = 'Ready'  AND delivery_type = 'TryIn'                         THEN 'try_in_ready'
    WHEN status = 'Ready'                                                      THEN 'final_ready'
    WHEN status = 'Try In' AND delivery_type = 'TryIn'                         THEN 'try_in_ready'
    WHEN status IN ('Under Production','In Progress')                          THEN 'in_production'
    WHEN status IN ('Under Design','Waiting Dr Approval')                      THEN 'designing'
    WHEN status IN ('New Case','Pending','Pending Review')                     THEN 'not_started'
    ELSE production_status
END
WHERE status NOT IN ('Returned for Adjustments','Rejected','Cancelled');

-- Section 4: Terminal statuses (history-aware)
DO $$
DECLARE
    r RECORD;
    v_last_status TEXT;
    v_mapped TEXT;
BEGIN
    FOR r IN SELECT id, status, delivery_type, status_history FROM orders
             WHERE status IN ('Returned for Adjustments','Rejected','Cancelled')
    LOOP
        v_last_status := NULL;

        IF r.status_history IS NOT NULL AND jsonb_typeof(r.status_history) = 'array' THEN
            SELECT entry->>'status' INTO v_last_status
            FROM jsonb_array_elements(r.status_history) AS entry
            WHERE entry->>'status' NOT IN ('Returned for Adjustments','Rejected','Cancelled')
            ORDER BY (entry->>'enteredAt') DESC NULLS LAST
            LIMIT 1;
        END IF;

        v_mapped := CASE
            WHEN v_last_status IN ('Delivered','Completed')                             THEN 'final_delivered'
            WHEN v_last_status = 'Try In Approved'                                      THEN 'finalization'
            WHEN v_last_status = 'Ready'  AND r.delivery_type = 'TryIn'                 THEN 'try_in_ready'
            WHEN v_last_status = 'Ready'                                                THEN 'final_ready'
            WHEN v_last_status = 'Try In' AND r.delivery_type = 'TryIn'                 THEN 'try_in_ready'
            WHEN v_last_status IN ('Under Production','In Progress')                    THEN 'in_production'
            WHEN v_last_status IN ('Under Design','Waiting Dr Approval')                THEN 'designing'
            WHEN v_last_status IN ('New Case','Pending','Pending Review')               THEN 'not_started'
            ELSE NULL
        END;

        IF v_mapped IS NULL THEN
            v_mapped := CASE r.status
                WHEN 'Cancelled' THEN 'not_started'
                ELSE 'final_ready'
            END;
        END IF;

        UPDATE orders SET production_status = v_mapped WHERE id = r.id;
    END LOOP;

    RAISE NOTICE 'production_status backfill complete';
END $$;

-- Section 5: issue_state backfill
UPDATE orders SET issue_state = CASE
    WHEN status = 'Returned for Adjustments' THEN 'returned'
    WHEN status = 'Rejected'                 THEN 'rejected'
    WHEN status = 'Cancelled'                THEN 'cancelled'
    ELSE 'none'
END;