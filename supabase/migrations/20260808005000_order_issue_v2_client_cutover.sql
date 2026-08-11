-- Final client cutover. Run only after the RPC-based frontend is deployed,
-- parity checks are clean, and DB enforcement has been explicitly enabled.

BEGIN;

DO $$
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_enforce') THEN
        RAISE EXCEPTION
            'Set workflow_issue_v2_enforce=on only after frontend cutover and parity approval';
    END IF;

    IF to_regprocedure('public.get_my_doctor_orders_v2()') IS NULL
       OR to_regprocedure('public.create_my_order_request_v2(text,jsonb,text,text,text,text,date,numeric)') IS NULL
       OR to_regprocedure('public.submit_my_order_feedback_v2(uuid,integer,text)') IS NULL
       OR to_regprocedure('public.append_order_event_v2(jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Required client-cutover RPCs are missing';
    END IF;
END;
$$;

-- Doctors now read/write through field-allowlisted SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "Doctors view own orders" ON public.orders;
DROP POLICY IF EXISTS "Doctors create order requests" ON public.orders;
DROP POLICY IF EXISTS "Doctors rate orders" ON public.orders;

-- All new clients append events through append_order_event_v2 or dedicated
-- workflow RPCs. Direct insert is retired only at this final stage.
REVOKE INSERT ON public.order_events FROM authenticated;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orders'
          AND policyname IN (
              'Doctors view own orders',
              'Doctors create order requests',
              'Doctors rate orders'
          )
    ) THEN
        RAISE EXCEPTION 'Doctor direct orders policies were not retired';
    END IF;

    IF has_table_privilege('authenticated', 'public.order_events', 'INSERT') THEN
        RAISE EXCEPTION 'Authenticated clients still have direct order_events INSERT';
    END IF;
END;
$$;

COMMIT;
