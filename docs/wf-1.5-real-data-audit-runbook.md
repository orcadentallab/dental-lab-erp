# WF-1.5 Real-Data Audit Runbook (Option B)

> **Goal**: run the WF-1.5 shadow-validation audit against a **safe, local copy** of production data, fill in the audit summary template, and produce a sign-off package — **without** touching production, staging, finance, UI, or RLS.
>
> **Audience**: an executor agent (or a careful human). Steps are copy-pastable. Anything labeled **[ASK USER]** must pause and request input before continuing.
>
> **Read this whole file before running anything.**

---

## 0. Hard gates (NEVER cross without explicit user OK)

These are non-negotiable. Abort and ask the user if any step would violate them:

1. **No production writes.** All work happens against a *local Supabase* restored from a prod dump. Never run `supabase db push`, `supabase link`, or `psql` against a remote URL with mutating SQL.
2. **`app.workflow_strict_rep` stays OFF.** Never run `ALTER DATABASE ... SET app.workflow_strict_rep = 'on'`. Never `SET app.workflow_strict_rep = 'on'` at session level either.
3. **No deploy of migration `086_add_production_status_and_issue_state_to_orders.sql` to prod/staging.** Local apply only.
4. **No edits to** `financial_obligations`, `transactions`, `payments`, `allocations`, `reports`, `statements`, `balances`, `credits`, RLS policies, UI files, or any code in `src/components/**`. The audit is **read-only**.
5. **No WF-2 / WF-3 / WF-4 / WF-5 work.** Those stay blocked until the user signs off the audit summary.
6. **No new migrations.** Don't author or rename anything in `supabase/migrations/**`. The local migration set is already correct (see memory: 0040, 0370, 0460, 0470, 0471, 0480, 0481, 0490 already renamed; obsolete files moved to `supabase/manual/`).
7. **Don't weaken or delete tests.** Current state: 223/223 passing. If a test breaks, stop and report.

If you (the agent) are unsure whether an action violates one of these, **stop and ask the user**.

---

## 1. Preconditions to verify before you start

Run these checks first. If any fails, **stop and report** before continuing.

### 1.1 Repo state
```powershell
git status --short
git rev-parse HEAD
```
Expected: working tree may have uncommitted UI work (pre-session); that's OK. Just record the HEAD sha so we can attribute any drift.

### 1.2 Tests green
```powershell
npm run typecheck
npx playwright test
```
Expected: typecheck exit 0, all tests pass (target: 223/223). If anything red, **stop**.

### 1.3 Local Supabase running
```powershell
npx supabase status
```
Expected: `API URL: http://127.0.0.1:54321`, `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`, container `supabase_db_dental-lab-erp` healthy. If not running:
```powershell
npx supabase start
```

### 1.4 Migration 086 already applied locally (per memory `c3ba2677`)
```powershell
$env:PGPASSWORD = "postgres"
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('production_status','issue_state');"
```
Expected: 2 rows. If empty, run `npx supabase db reset` to replay all migrations.

### 1.5 Strict flag OFF
```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT current_setting('app.workflow_strict_rep', true) AS strict_rep;"
```
Expected: NULL or empty string.

### 1.6 Local DB is currently empty (per memory)
```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT COUNT(*) FROM orders;"
```
Expected: 0. If non-zero, **STOP and ask the user** before overwriting — there may already be a dataset loaded.

---

## 2. Obtain a safe production dump  **[ASK USER]**

The agent cannot pull production data on its own. Pause and ask the user for **exactly one** of the following:

### Option 2.A — User runs the dump and hands you a file
Ask the user to run this on their machine, then give you the resulting file path:

```powershell
# Replace <PROD_DB_URL> with the prod connection string. Use a READ-ONLY role if possible.
# Excludes auth/storage/realtime schemas; data-only on the public schema.
pg_dump `
  --no-owner --no-privileges `
  --schema=public `
  --data-only `
  --exclude-table-data="public.audit_logs" `
  --exclude-table-data="public.notifications" `
  -f prod-public-data.sql `
  "<PROD_DB_URL>"
```

Then ask:
> "What's the absolute path of `prod-public-data.sql` on your machine? Have you reviewed it for any data you don't want copied locally?"

### Option 2.B — User has Supabase CLI linked and wants the agent to script it
Ask:
> "Are you OK if I run `npx supabase db dump --data-only --schema public -f prod-public-data.sql` after you've linked the project? Confirm the project ref."

The agent must NOT run `supabase link` itself; the user does that step.

### Option 2.C — Use Supabase managed dump file the user already has
Ask the user to drop the dump file in the repo root (gitignored) and give the path.

**Whichever option**: confirm the dump is **data-only on `public` schema**. If it includes schema/DDL, the local restore may collide with migration 086. If unsure, ask the user.

> ⚠️ Add the dump filename to `.gitignore` if not already covered. Default `.gitignore` should already exclude `*.sql` at root — verify before proceeding:
> ```powershell
> git check-ignore -v prod-public-data.sql
> ```
> If not ignored, **stop** and add it to `.gitignore` before continuing. Never commit the dump.

---

## 3. Restore the dump into local Supabase

> Local DB connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### 3.1 Truncate existing public tables (clean slate)
The local DB should already be empty (step 1.6), but to be safe:

```powershell
$env:PGPASSWORD = "postgres"
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c @"
DO `$`$ DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP
    EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', r.tablename);
  END LOOP;
END `$`$;
"@
```

If this errors due to FK or trigger interactions, **stop and ask** — do not start dropping tables.

### 3.2 Disable the new role-guard trigger during restore
The dump may carry `updated_at` / role-tagged rows that the trigger would reject. Strict mode is OFF so the trigger is mostly inert, but disable it for the restore window to be safe:

```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "ALTER TABLE orders DISABLE TRIGGER trigger_orders_role_field_guard;"
```

### 3.3 Restore the dump
```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f <ABSOLUTE_PATH_TO_DUMP>.sql 2> restore-errors.log
```

Inspect `restore-errors.log`:
- FK / unique-violation noise on lookup tables = usually OK if dump order is wrong; try `--disable-triggers` flavor (ask user to redo dump with that flag).
- Any `permission denied` / `relation does not exist` = **stop and report**.

### 3.4 Re-enable the trigger
```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "ALTER TABLE orders ENABLE TRIGGER trigger_orders_role_field_guard;"
```

### 3.5 Smoke-check the restore
```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c @"
SELECT
  (SELECT COUNT(*) FROM orders)                AS orders_count,
  (SELECT COUNT(*) FROM cases)                 AS cases_count,
  (SELECT COUNT(*) FROM financial_obligations) AS obligations_count,
  (SELECT COUNT(*) FROM transactions)          AS transactions_count;
"@
```

Record these counts in your final report (Part 8). Compare with the user's expected counts if they have them.

### 3.6 Confirm migration 086 backfill ran across the imported data
The migration 086 backfill block runs **at migration time**, not at insert time, so newly-restored rows will have `production_status` / `issue_state` populated **only if the dump captured those columns**. Check:

```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c @"
SELECT
  COUNT(*) FILTER (WHERE production_status IS NULL) AS null_prod_status,
  COUNT(*) FILTER (WHERE issue_state IS NULL)       AS null_issue_state,
  COUNT(*)                                          AS total
FROM orders;
"@
```

- If `null_prod_status` or `null_issue_state` > 0, the dump came from a DB **before** 086 was applied. We need to re-run the 086 backfill block manually. **Ask the user**:
  > "The dump predates migration 086. May I re-run the backfill section of 086 against the local DB? It only writes to `production_status` and `issue_state` (no finance/UI/RLS impact)."

  If approved, extract the backfill `UPDATE` statements from `supabase/migrations/086_add_production_status_and_issue_state_to_orders.sql` and run only those (no DDL, no trigger, no RPC — those already exist locally). Then re-run the NULL check above; expect 0.

- If both = 0, you're good.

---

## 4. Pre-audit safety re-check

Before running the audit, re-verify the hard gates didn't drift during restore:

```powershell
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c @"
SELECT
  current_setting('app.workflow_strict_rep', true)                             AS strict_rep,
  (SELECT tgenabled FROM pg_trigger WHERE tgname='trigger_orders_role_field_guard') AS guard_enabled,
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='rep_update_order_fields_with_audit') AS has_rpc;
"@
```

Expected: `strict_rep` empty/NULL, `guard_enabled` = `O` (origin/enabled), `has_rpc` = 1.

---

## 5. Run the audit script

### 5.1 Set env vars (PowerShell)
```powershell
$env:SUPABASE_URL = "http://127.0.0.1:54321"
# Use the local anon key from `npx supabase status` output (field "anon key").
# OR use the local service-role key (field "service_role key") for full read access.
$env:SUPABASE_SERVICE_ROLE_KEY = "<paste local service_role key from supabase status>"
```

> Local keys are fixed dev keys printed by `npx supabase status`. They are NOT secrets.

### 5.2 Run audit, capture both streams
```powershell
npx tsx scripts/workflow-audit.ts > audit.csv 2> audit-summary.txt
```

- `audit.csv` = full per-order table (one row per order, ~17 columns).
- `audit-summary.txt` = the human-readable summary block (counts).

If the script errors:
- `Missing env: ...` → step 5.1 didn't take effect. Re-set in same shell.
- `relation "orders" does not exist` → restore failed silently; redo step 3.
- Network / TLS errors → wrong URL; you should be hitting `127.0.0.1:54321`, not the cloud.

### 5.3 Quick sanity-check the CSV
```powershell
# Row count (should be orders_count + 1 header):
(Get-Content audit.csv | Measure-Object -Line).Lines

# Peek first 5 rows:
Get-Content audit.csv -TotalCount 5
```

---

## 6. Cross-check with direct SQL (independent of the script)

Run these against the local DB and save output. They MUST agree with the audit summary; if they don't, **stop and report** — the audit script may have a bug.

### 6.1 production_status distribution
```sql
SELECT production_status, COUNT(*)
FROM orders GROUP BY production_status ORDER BY production_status;
```

### 6.2 issue_state distribution
```sql
SELECT issue_state, COUNT(*)
FROM orders GROUP BY issue_state ORDER BY issue_state;
```

### 6.3 Legacy `orders.status` distribution (for the BEFORE/AFTER comparison)
```sql
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
```

### 6.4 Specific suspicious-mapping samples
```sql
-- delivered_but_tryin
SELECT id, case_id, status, delivery_type, production_status, issue_state
FROM orders WHERE status='Delivered' AND delivery_type='TryIn' LIMIT 20;

-- final_delivered missing actual_delivery_date
SELECT id, case_id, status, production_status, actual_delivery_date
FROM orders WHERE production_status='final_delivered' AND actual_delivery_date IS NULL LIMIT 20;

-- non-final-delivered with actual_delivery_date set
SELECT id, case_id, status, production_status, actual_delivery_date
FROM orders WHERE production_status<>'final_delivered' AND actual_delivery_date IS NOT NULL LIMIT 20;

-- legacy terminal statuses without status_history
SELECT id, case_id, status, jsonb_array_length(COALESCE(status_history,'[]'::jsonb)) AS hist_len
FROM orders
WHERE status IN ('Returned for Adjustments','Rejected','Cancelled')
  AND (status_history IS NULL OR jsonb_array_length(status_history) <= 1)
LIMIT 20;
```

### 6.5 Financial consistency cross-checks
```sql
-- final_delivered without an active doctor receivable
SELECT o.id, o.case_id, o.status, o.production_status, o.issue_state
FROM orders o
WHERE o.production_status='final_delivered' AND o.issue_state='none'
  AND NOT EXISTS (
    SELECT 1 FROM financial_obligations f
    WHERE f.order_id=o.id AND f.trigger_type='doctor_delivered' AND f.status<>'voided'
  )
LIMIT 20;

-- final_ready/final_delivered with supplier+cost but no active lab payable
SELECT o.id, o.case_id, o.production_status, o.supplier_id, o.cost
FROM orders o
WHERE o.production_status IN ('final_ready','final_delivered') AND o.issue_state='none'
  AND o.supplier_id IS NOT NULL AND COALESCE(o.cost,0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_obligations f
    WHERE f.order_id=o.id AND f.trigger_type='external_lab_ready' AND f.status<>'voided'
  )
LIMIT 20;
```

Save all outputs to a single file, e.g. `audit-sql-crosscheck.txt`.

---

## 7. Confirm finance untouched by the audit

The audit is read-only, but verify nothing drifted during the session:

```sql
SELECT
  (SELECT COUNT(*) FROM financial_obligations
     WHERE created_at > now() - interval '60 minutes') AS recent_obligations_created,
  (SELECT COUNT(*) FROM financial_obligations
     WHERE updated_at > now() - interval '60 minutes'
       AND created_at < now() - interval '60 minutes')  AS recent_obligations_modified,
  (SELECT COUNT(*) FROM transactions
     WHERE updated_at > now() - interval '60 minutes')  AS recent_transactions_modified;
```

Expected: all three = 0 (you did no finance work in this window).

---

## 8. Fill in the sign-off package

Create a new file `docs/wf-1.5-real-data-audit-report.md` with this structure (fill all the blanks from steps 5–7):

```markdown
# WF-1.5 Real-Data Audit Report

- Date: <YYYY-MM-DD>
- Source dump: <filename, sha256>, taken from prod at <timestamp from user>
- Local DB: postgresql://postgres@127.0.0.1:54322/postgres
- Repo HEAD at audit time: <git sha>
- Migration 086 applied locally: yes
- Strict flag (`app.workflow_strict_rep`): OFF
- Total orders audited: ___

## Restore counts
- orders: ___
- cases: ___
- financial_obligations: ___
- transactions: ___

## production_status distribution
not_started: ___
designing: ___
in_production: ___
try_in_ready: ___
waiting_doctor: ___
finalization: ___
final_ready: ___
final_delivered: ___

## issue_state distribution
none: ___
returned: ___
rejected: ___
cancelled: ___
on_hold: ___

## Legacy orders.status distribution
<paste full list>

## Suspicious mapping flag counts (from audit-summary.txt)
delivered_but_tryin: ___
ready_tryin: ___
tryin_no_history: ___
legacy_returned: ___
legacy_rejected: ___
legacy_cancelled: ___
null_delivery_type: ___
delivered_missing_actual_date: ___
nondelivered_with_actual_date: ___

## Financial consistency flag counts
ok: ___
missing_doctor_receivable: ___
stale_doctor_receivable: ___
missing_lab_payable: ___
stale_lab_payable: ___

## Readiness counts
Rep-audited-edit readiness (would be editable on flip): ___
Rows needing manual review: ___

## Cross-check samples
<paste 3–10 rows for each non-empty suspicious flag from step 6.4>
<paste 3–10 rows for each non-zero financial flag from step 6.5>

## Finance-drift check (step 7)
recent_obligations_created: 0
recent_obligations_modified: 0
recent_transactions_modified: 0

## Files attached
- audit.csv (sha256: ___)
- audit-summary.txt (sha256: ___)
- audit-sql-crosscheck.txt (sha256: ___)

## Agent notes / anomalies
<anything weird — script errors recovered from, dump quirks, etc.>
```

Compute the sha256s with:
```powershell
Get-FileHash audit.csv, audit-summary.txt, audit-sql-crosscheck.txt -Algorithm SHA256
```

---

## 9. Hand off  **[ASK USER]**

Post a short summary in chat:
> "Real-data audit complete. Report at `docs/wf-1.5-real-data-audit-report.md`. Total orders ___, manual-review rows ___, finance-drift counters all zero, strict flag still OFF. Awaiting sign-off to unblock WF-2."

Then **stop**. Do NOT:
- Start WF-2.
- Flip the strict flag.
- Apply 086 to staging or prod.
- Modify any audit findings yourself ("fixing" suspicious rows is a separate, user-approved task).

Wait for the user's explicit "signed off, proceed to WF-2" before any further action.

---

## Appendix A — Cleanup after the audit

When the user is done with the local dump:

```powershell
# Wipe the local DB back to empty so no prod data lingers:
npx supabase db reset

# Delete the dump file:
Remove-Item <ABSOLUTE_PATH_TO_DUMP>.sql
Remove-Item audit.csv, audit-summary.txt, audit-sql-crosscheck.txt, restore-errors.log -ErrorAction SilentlyContinue
```

The committed report (`docs/wf-1.5-real-data-audit-report.md`) keeps the *aggregated* numbers; the raw CSV with order ids is local-only.

---

## Appendix B — If something goes wrong

| Symptom | Action |
|---|---|
| `npx supabase status` shows DB stopped | `npx supabase start`. If still failing, check Docker Desktop. |
| Restore drops FK/PK errors | Stop. Ask user to redo dump with `--disable-triggers` or `--use-set-session-authorization` flags. |
| `production_status` NULL after restore | Dump predates 086. Ask user before manually re-running the 086 backfill UPDATE statements. |
| Audit script error: `Missing env` | Re-set `$env:SUPABASE_URL` + `$env:SUPABASE_SERVICE_ROLE_KEY` in the **same** shell. |
| Tests start failing mid-session | Stop. Run `git diff` — you may have accidentally edited a file. Revert. |
| Strict flag accidentally flipped on | `psql ... -c "ALTER DATABASE postgres RESET app.workflow_strict_rep;"` then reconnect. Report to user. |
| Trigger fires on legitimate read | Trigger is BEFORE UPDATE only; no read should fire it. If you see this, **stop and report** — implies someone wrote during audit. |

---

## Appendix C — Files this runbook touches

**Created**:
- `docs/wf-1.5-real-data-audit-report.md` (the filled report — committed)
- `audit.csv`, `audit-summary.txt`, `audit-sql-crosscheck.txt`, `restore-errors.log` (local only — gitignored)

**Read-only references**:
- `supabase/migrations/086_add_production_status_and_issue_state_to_orders.sql`
- `supabase/manual/086_rollback.sql`
- `scripts/workflow-audit.ts`
- `src/services/supabase/workflowAudit.ts`
- `docs/wf-1.5-verification-runbook.md` (the original local-only verification)

**Never modify in this workflow**: anything under `src/components/**`, `src/services/supabase/**` (other than reading), `supabase/migrations/**`, finance modules, RLS policies, tests.
