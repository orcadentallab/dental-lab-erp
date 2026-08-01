# Database integration tests

These pgTAP tests exercise the financial-obligation triggers against a local
Supabase database. They never target the linked or production project.

Prerequisites:

1. Install and start Docker Desktop (or another Docker-compatible engine).
2. Run `npx supabase start`.
3. Run `npx supabase db reset --local` so the local schema contains every
   repository migration.
4. Run `npm run test:db`.

The suite covers atomic order corrections, Redo creation, On Hold retirement,
automatic doctor/center collection FIFO with overpayment credit handling, and a
role matrix for sensitive reporting tables and privileged RPCs. It also verifies
that workflow mutations preserve payments atomically through the database trigger,
and that a cashbox transaction and its optional transfer fee commit together.

The SQL suite runs inside a transaction and finishes with `ROLLBACK`, so its
fixture doctors, suppliers, users, orders, payments, allocations, and credits
are never retained.
