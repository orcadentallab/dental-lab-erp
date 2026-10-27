-- Exact RLS parity for the representative "not delivered" rule, using V2.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS orders_update ON public.orders;
CREATE POLICY orders_update ON public.orders
FOR UPDATE
USING (
    public.get_my_role() = ANY (ARRAY['admin', 'accountant', 'coordinator'])
    OR (public.get_my_role() = 'designer' AND designer_id = public.get_my_user_id())
    OR (
        public.get_my_role() = ANY (ARRAY['representative', 'coordinator'])
        AND NOT (production_status = 'final_delivered' AND issue_state = 'none')
    )
    OR (public.get_my_role() = 'lab' AND supplier_id = public.get_my_entity_id())
)
WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'accountant', 'coordinator'])
    OR (public.get_my_role() = 'designer' AND designer_id = public.get_my_user_id())
    OR public.get_my_role() = ANY (ARRAY['representative', 'coordinator'])
    OR (public.get_my_role() = 'lab' AND supplier_id = public.get_my_entity_id())
);

COMMIT;
