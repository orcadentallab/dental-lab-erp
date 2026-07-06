-- Migration: Add parent_name to get_todays_follow_ups RPC
-- Date: 2026-07-06

DROP FUNCTION IF EXISTS get_todays_follow_ups();

CREATE OR REPLACE FUNCTION get_todays_follow_ups()
RETURNS TABLE (
    id UUID,
    doctor_id UUID,
    contacted_at TIMESTAMPTZ,
    contacted_by UUID,
    notes TEXT,
    status TEXT,
    next_follow_up_date DATE,
    created_at TIMESTAMPTZ,
    doctor_name TEXT,
    parent_name TEXT, -- Added parent center name
    doctor_phone TEXT,
    doctor_phone2 TEXT,
    doctor_code TEXT,
    representative_id UUID,
    representative_name TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_my_role TEXT;
    v_my_user_id UUID;
BEGIN
    v_my_role := get_my_role();
    v_my_user_id := get_my_user_id();

    RETURN QUERY
    WITH latest_follow_ups AS (
        SELECT DISTINCT ON (f.doctor_id)
            f.id,
            f.doctor_id,
            f.contacted_at,
            f.contacted_by,
            f.notes,
            f.status,
            f.next_follow_up_date,
            f.created_at
        FROM doctor_follow_ups f
        ORDER BY f.doctor_id, f.created_at DESC
    )
    SELECT 
        lf.id,
        lf.doctor_id,
        lf.contacted_at,
        lf.contacted_by,
        lf.notes,
        lf.status,
        lf.next_follow_up_date,
        lf.created_at,
        d.name AS doctor_name,
        p.name AS parent_name, -- Parent center name
        d.phone AS doctor_phone,
        d.phone2 AS doctor_phone2,
        d.doctor_code,
        d.representative_id,
        d.representative_name
    FROM latest_follow_ups lf
    JOIN doctors d ON d.id = lf.doctor_id
    LEFT JOIN doctors p ON d.parent_id = p.id
    WHERE 
        lf.next_follow_up_date <= CURRENT_DATE
        AND (v_my_role = 'admin' OR (v_my_role = 'representative' AND d.representative_id = v_my_user_id));
END;
$$;
