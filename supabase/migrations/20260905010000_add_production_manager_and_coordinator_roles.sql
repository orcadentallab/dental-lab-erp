-- Production roles, step 1 of 3: make the two new roles nameable.
-- See docs/PRODUCTION_ROLES_PLAN_AR.md — this migration executes section 6
-- item 1 and NOTHING else.
--
-- WHY THIS IS ITS OWN MIGRATION
--   Section 6 of the plan reads as one migration. The live surface says
--   otherwise: 61 RLS policies and 39 functions mention 'lab' or 'accountant',
--   plus 29 frontend files. Doing that in a single transaction means a single
--   all-or-nothing rollback across half the system, and any mistake in one
--   policy locks a working person out with no way to bisect which line did it.
--   So the work is split three ways, each independently revertible:
--
--     1 (this file)  Widen users_role_check. Nobody holds the new roles yet,
--                    no policy mentions them, so nothing changes behaviourally.
--     2              Add 'coordinator' ALONGSIDE every 'accountant' mention.
--                    Purely additive — it grants, never revokes.
--     3              Strip 'lab' of internal production and add
--                    'production_manager' in its place. This is the only step
--                    that takes anything away, and it lands last and alone.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   It grants the new roles nothing. A user given 'production_manager' today
--   would see an empty application, because no policy names that role yet.
--   That is the point: the constraint change is reversible with no blast
--   radius, and steps 2 and 3 can be reviewed against a database that already
--   accepts the vocabulary they are about to use.
--
--   'accountant' STAYS. Decision 5 of the plan: Emad keeps the role, and the
--   role itself remains a hiring option distinct from 'coordinator'.
--   'lab' STAYS in the constraint too — the six lab rows must keep validating.
--   Their login is cut off separately, without touching a single data row.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- The role vocabulary
-- ─────────────────────────────────────────────────────────────────────────
-- Previous definition (20260821006000) added 'technician'. This adds the two
-- roles that were never modelled at all: the person who runs the floor, and
-- the person who runs everything around it.
--
--   production_manager  Inherits what 'lab' was actually doing in the database
--                       — shift runs, stock corrections, shipment lifecycle,
--                       production_status — under its real name.
--   coordinator         Representative + the accountant's full scope +
--                       read-only production + shared shipping.
--
-- Ordering here is cosmetic; the CHECK is a set membership test.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'lab', 'representative', 'accountant', 'designer',
                    'doctor', 'technician', 'production_manager', 'coordinator'));

COMMENT ON CONSTRAINT users_role_check ON public.users IS
    'Role vocabulary. production_manager and coordinator added 20260905 '
    '(docs/PRODUCTION_ROLES_PLAN_AR.md). lab is retained so the six external-'
    'lab rows keep validating; its permissions are removed in step 3, its '
    'login separately. accountant is retained as a standalone hiring option.';

COMMIT;
