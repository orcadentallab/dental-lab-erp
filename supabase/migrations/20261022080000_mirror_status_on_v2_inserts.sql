-- Keep orders.status as a one-way compatibility projection while the mirror
-- flag is enabled. BEFORE INSERT is required because the legacy column is
-- still NOT NULL until the later mirror-off/drop phases.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS zzzz_mirror_order_status_from_v2 ON public.orders;
CREATE TRIGGER zzzz_mirror_order_status_from_v2
BEFORE INSERT OR UPDATE OF production_status, issue_state, intake_state ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.mirror_order_status_from_v2();

COMMIT;
