# Database integration tests

These pgTAP tests exercise the financial-obligation triggers against a local
Supabase database. They never target the linked or production project.

Prerequisites:

1. Install and start Docker Desktop (or another Docker-compatible engine).
2. Run `npx supabase start`.
3. Run `npx supabase db reset --local` so the local schema contains every
   repository migration.
4. Run `npm run test:db`.

The SQL suite runs inside a transaction and finishes with `ROLLBACK`, so its
fixture doctors, suppliers, users, orders, payments, allocations, and credits
are never retained.
