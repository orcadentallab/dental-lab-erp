BEGIN;

ALTER TABLE public.services ADD COLUMN is_active boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.services.is_active IS 'Available in new order service pickers. Inactive entries remain in the historical catalog.';

NOTIFY pgrst, 'reload schema';
COMMIT;
