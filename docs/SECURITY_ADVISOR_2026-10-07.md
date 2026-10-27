# Supabase Security Advisor investigation — 2026-10-07

Project: Orca ERP (`piuiiwcjnfvjwyewczuz`), main / Production.

## Confirmed live findings

Security Advisor reported five errors:

- RLS disabled on `public.order_item_price_backfill_audit`.
- Owner-context views: `production_history_quality`,
  `production_stage_run_costing`, `machine_downtime_impact`,
  `order_cost_component_audit`.

Read-only catalog inspection confirmed all five objects had SELECT and write
grants for `anon` and `authenticated`. The maintenance audit had no RLS or
policies. The four views had no `security_invoker` setting. Their underlying
tables already had RLS and authenticated SELECT policies.

The audit table is historical maintenance/rollback evidence, with no client
references under `src/`. Reports keep authenticated SELECT and inherit their
underlying table policies after the change. This does not establish that any
unauthorized access occurred; access logs were not audited.

## Prepared fix

`supabase/migrations/20261007000000_harden_audit_table_and_reporting_views.sql`
enables audit RLS and revokes all client/public privileges on that table. It sets
the four views to `security_invoker=true`, removes public/anon grants and keeps
only authenticated SELECT. Existing owner/service_role access remains. No
business rows, report definitions, or underlying table policies are changed.

## Validation and deployment status

Nine pgTAP assertions passed on the existing local Docker database
`supabase_db_doctor-portal-qa`. The migration and tests ran together inside a
transaction ending with ROLLBACK, leaving the local database unchanged.
Checks cover audit RLS, client privilege denial, invoker settings, read-only
authenticated grants, and actual zero-row queries from an authenticated session
without a linked user. Tests are included in `npm run test:db`.

The user explicitly approved applying only this fix to production. The exact
hardening statements were executed through Supabase SQL Editor in a transaction,
without `supabase db push`, a frontend deployment, or any other pending migration.
Post-deployment catalog results confirmed audit RLS, invoker settings on all four
views, no anonymous SELECT, and retained authenticated SELECT on the reports.

A production smoke test in a READ ONLY transaction passed:

- An active admin could query all four reports, with row counts identical to
  owner-context counts taken after deployment.
- An authenticated session without a linked user saw zero rows in all reports.
- Actual anonymous SELECT attempts on all five objects raised insufficient
  privilege errors.

The smoke test ended with ROLLBACK and modified no business rows. Security Advisor
was rerun and confirmed **0 errors**, down from five. Screenshot evidence:
`docs/security-advisor-2026-10-07-production.jpg`.

The remaining 147 warnings and five informational suggestions are outside this
five-error patch and have not been audited. No other working-tree changes were
deployed. The SQL Editor application did not register migration history; the
saved migration is idempotent if subsequently applied by the migration runner.
