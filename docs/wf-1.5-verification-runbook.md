# WF-1.5 Verification Runbook

> Status: **partial — static portion complete, DB portion requires you to run.**
>
> The agent cannot apply migration 086 to your database (no Docker daemon running locally; no `.env` in workspace; staging credentials not available to the agent). Sections marked **[YOU RUN]** are copy-pastable commands you execute and paste back the output. Sections marked **[VERIFIED]** were checked statically by the agent.

---

## Part A — Static checks (already verified by agent)

### A.1 No financial behavior changed [VERIFIED]

- `tests/financialObligations.spec.ts` (124 tests), `tests/orderEvents.spec.ts` (22 tests), `tests/orderLifecycle.spec.ts` (15 tests), `tests/allocationPreview.spec.ts`, `tests/billingSettings.spec.ts`, `tests/orderDisplay.spec.ts` — **167/167 pass** unchanged.
- Migration 086 grep: zero references to `financial_obligations`, `transactions`, `payments`, `allocations`, `reports`, `statements`, `balances`, `credits`.

### A.2 `orders.status` enum unchanged [VERIFIED]

- Migration 086 grep: zero matches for `orders_status_check`, `UPDATE orders SET status`, or any TYPE alteration of the status column.
- Test `does NOT modify orders.status enum` passes.

### A.3 No UI files changed [VERIFIED]

- The git status shows `OrderForm.tsx`, `OrderCard.tsx`, `OrderBoard.tsx`, etc. as modified, but those are **pre-session uncommitted work** (predates WF-1).
- Grep for `production_status | issue_state | repUpdateOrderWithAudit | workflow_strict_rep | orderWorkflow | productionStatus | issueState` across `src/**/*.{ts,tsx}` returns matches **only** in:
  - `src/services/supabase/workflowAudit.ts` (new — agent)
  - `src/services/supabase/orderWorkflow.ts` (new — agent)
  - `src/services/supabase/types.ts` (DbOrder fields — agent)
  - `src/services/supabase/orders.ts` (mapping — agent)
  - `src/services/db.ts` (Order field + facade — agent)
  - `src/utils/orderDisplay.ts` (uses pre-existing `getProductionStatus` helper — not authored by agent in this session)
- Zero UI components reference any new symbol.

### A.4 No RLS policies changed [VERIFIED]

- Migration 086 grep: zero `CREATE POLICY` / `DROP POLICY` / `ALTER POLICY` on `orders` (or any table).
- Test `does not modify existing RLS policies on orders` passes.

### A.5 Existing `check_order_update_permissions` (lab) trigger untouched [VERIFIED]

- Migration 086 has no `CREATE OR REPLACE FUNCTION check_order_update_permissions` and no `DROP TRIGGER` / `DROP FUNCTION` on it.
- Test `does not modify existing trigger check_order_update_permissions` passes.

### A.6 `getProductionStatus` legacy fallback active [VERIFIED]

- `src/constants/orderLifecycle.ts` (the file that defines `getProductionStatus`) is **not** in the list of files modified by this session. Its legacy mapping logic is unchanged.

### A.7 Typecheck clean [VERIFIED]

- `npm run typecheck` → exit 0.

### A.8 Migration 086 + rollback structural snapshot [VERIFIED]

- 43 snapshot tests in `tests/workflow.spec.ts` cover: column declarations, CHECK constraints, backfill rules (including the `Delivered → final_delivered` hard rule and the status-history-aware terminal backfill), trigger flag-gating, RPC signature, allow-list contents, reason-note enforcement, role-by-role branches, and rollback completeness. **All 43 pass.**

---

## Part B — DB application + audit [YOU RUN]

### B.1 Apply migration 086

Choose ONE of:

**Option 1: Local Supabase (after starting Docker Desktop)**
```powershell
# Start Docker Desktop first, then:
npx supabase start
npx supabase db push
# OR replay all migrations from scratch:
npx supabase db reset
```

**Option 2: Staging / production via Supabase CLI linked project**
```powershell
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

**Option 3: Direct psql against the target DB**
```powershell
psql "<CONNECTION_STRING>" -f supabase/migrations/086_add_production_status_and_issue_state_to_orders.sql
```

Expect to see:
```
NOTICE:  production_status backfill complete
NOTICE:  Migration 086 complete: production_status + issue_state added; orders_role_field_guard installed (rep branch flag-gated by app.workflow_strict_rep, default off); rep_update_order_fields_with_audit RPC ready.
```

### B.2 Verify DB objects exist

Run this single SQL block in the Supabase SQL editor (or via psql) and paste back the result:

```sql
SELECT
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='orders' AND column_name='production_status')             AS has_production_status_col,
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='orders' AND column_name='issue_state')                   AS has_issue_state_col,
    (SELECT COUNT(*) FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_orders_production_status')                              AS has_prod_status_index,
    (SELECT COUNT(*) FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_orders_issue_state')                                    AS has_issue_state_index,
    (SELECT COUNT(*) FROM pg_trigger
     WHERE tgname='trigger_orders_role_field_guard' AND NOT tgisinternal)                                 AS has_role_guard_trigger,
    (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='rep_update_order_fields_with_audit')                         AS has_rep_audit_rpc,
    (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='orders_role_field_guard')                                    AS has_role_guard_fn;
```

Expected: every column = 1.

### B.3 Verify feature flag is OFF

```sql
SELECT
    current_setting('app.workflow_strict_rep', true) AS strict_rep_setting,
    -- show DB-level GUC if set:
    (SELECT setconfig FROM pg_db_role_setting
       WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname=current_database())
         AND setrole = 0)                            AS db_level_settings;
```

Expected: `strict_rep_setting` is NULL (or empty). `db_level_settings` should NOT contain `app.workflow_strict_rep=on`.

> ⚠️ Per your instruction, **do NOT** run `ALTER DATABASE postgres SET app.workflow_strict_rep = 'on';`. The flag stays OFF until WF-4 ships the rep-edit UI.

### B.4 Confirm rep direct updates still work (smoke test)

Sign into the app as a representative user. Open an order and edit something they could edit before WF-1 (e.g., add a comment, change priority). Save. **Expected**: the update succeeds with no `orders_role_field_guard` errors. This proves strict mode is dormant.

If the error `representative updates must go through rep_update_order_fields_with_audit` appears anywhere, the flag was accidentally turned on — run `ALTER DATABASE postgres SET app.workflow_strict_rep = 'off';` and reconnect.

### B.5 Run the audit script

```powershell
# Set env vars first (PowerShell):
$env:SUPABASE_URL = "https://<your-project>.supabase.co"
$env:SUPABASE_KEY = "<service-role-or-anon-key-with-orders-read>"

# Workspace already includes tsx as a transitive dep via supabase CLI; if not:
npm install --save-dev tsx

# Run audit (script reads `supabase` client which uses your VITE_*/SUPABASE_* env conventions):
npx tsx scripts/workflow-audit.ts > audit.csv
```

> Note: the script imports `../src/lib/supabase` which uses Vite env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). If running the script outside Vite, you may need to adapt env loading. If issues arise, paste the error and I'll provide a small wrapper.

The CSV goes to stdout (`audit.csv`); summary counts go to stderr (visible in the console).

### B.6 Confirm no financial / payments / allocations / statements changed

```sql
-- Should return ZERO rows created/voided/modified by migration 086.
-- The 086 migration has no DML on these tables; this is a sanity check
-- against logical drift.
SELECT
    (SELECT COUNT(*) FROM financial_obligations
       WHERE updated_at > now() - interval '15 minutes'
         AND created_at < now() - interval '15 minutes')                       AS recently_modified_obligations,
    (SELECT COUNT(*) FROM financial_obligations
       WHERE created_at > now() - interval '15 minutes')                        AS recently_created_obligations,
    (SELECT COUNT(*) FROM transactions
       WHERE updated_at > now() - interval '15 minutes')                        AS recently_modified_transactions;
```

Run this **immediately after** migration 086 applies. Expected: all three = 0 (assuming no concurrent finance activity in the window).

### B.7 Confirm `orders.status` value distribution unchanged

Optional but recommended: capture status counts BEFORE applying the migration, then again AFTER, and diff.

```sql
-- Before AND after migration:
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
```

Expected: identical row counts before/after.

---

## Part C — Audit report summary template [YOU FILL]

Paste these from the audit run + DB queries:

### C.1 production_status backfill counts

```
not_started:      ___
designing:        ___
in_production:    ___
try_in_ready:     ___
waiting_doctor:   ___
finalization:     ___
final_ready:      ___
final_delivered:  ___
```

DB-side cross-check:
```sql
SELECT production_status, COUNT(*) FROM orders GROUP BY production_status ORDER BY production_status;
```

### C.2 issue_state backfill counts

```
none:       ___
returned:   ___
rejected:   ___
cancelled:  ___
on_hold:    ___
```

DB-side:
```sql
SELECT issue_state, COUNT(*) FROM orders GROUP BY issue_state ORDER BY issue_state;
```

### C.3 Suspicious mapping flag counts

From audit script stderr summary:
```
delivered_but_tryin:           ___
ready_tryin:                   ___
tryin_no_history:              ___
legacy_returned:               ___
legacy_rejected:               ___
legacy_cancelled:              ___
null_delivery_type:            ___
delivered_missing_actual_date: ___
nondelivered_with_actual_date: ___
```

### C.4 Financial consistency flag counts

```
ok:                          ___
missing_doctor_receivable:   ___
stale_doctor_receivable:     ___
missing_lab_payable:         ___
stale_lab_payable:           ___
```

### C.5 Readiness counts

```
Total orders audited:                                    ___
Rep-audited-edit readiness (would be editable on flip):  ___
Rows needing manual review:                              ___
```

### C.6 Cross-checks for individual flags

```sql
-- Delivered but TryIn
SELECT id, case_id, status, delivery_type, production_status, issue_state
  FROM orders WHERE status='Delivered' AND delivery_type='TryIn';

-- final_delivered missing actual_delivery_date
SELECT id, case_id, status, production_status, actual_delivery_date
  FROM orders WHERE production_status='final_delivered' AND actual_delivery_date IS NULL;

-- Non-final-delivered rows with actual_delivery_date set
SELECT id, case_id, status, production_status, actual_delivery_date
  FROM orders WHERE production_status<>'final_delivered' AND actual_delivery_date IS NOT NULL;
```

Paste a count + sample of any non-empty result.

---

## Part D — Sign-off checklist

When you have run Parts B–C, paste the filled sections back. The agent will:

1. Confirm the counts make sense relative to your business expectation.
2. Flag any rows requiring manual admin correction before WF-2.
3. Once you sign off, WF-2 may begin.

**Until sign-off, all of WF-2 / WF-3 / WF-4 / WF-5 remains blocked.**

---

## Appendix — Emergency rollback

If anything looks wrong after applying migration 086:

```sql
-- NON-DESTRUCTIVE: disable just the new trigger (preserves all data).
ALTER TABLE orders DISABLE TRIGGER trigger_orders_role_field_guard;
```

If a full rollback is required (drops the new columns and all WF-1 plumbing — preserves order_events history):

```powershell
psql "<CONNECTION_STRING>" -f supabase/manual/086_rollback.sql
```
