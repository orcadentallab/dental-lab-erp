# WF-1.5 Real-Data Audit Report

- Date: 2026-05-24
- Source dump: prod-public-data.sql (data-only, public schema), pulled via `npx supabase db dump`
- Local DB: postgresql://postgres@127.0.0.1:54322/postgres
- Repo HEAD at audit time: 08c5b15a6cc007588715957e03cfe38ae012a80d
- Migration 086 applied locally: yes (backfill re-run after restore)
- Strict flag (`app.workflow_strict_rep`): OFF
- Total orders audited: 870

## Restore counts
- orders: 870
- cases: N/A (no separate cases table in schema)
- financial_obligations: 1482
- transactions: 761

## production_status distribution
- not_started: 27
- designing: 14
- in_production: 31
- try_in_ready: 4
- waiting_doctor: 0
- finalization: 2
- final_ready: 16
- final_delivered: 776

## issue_state distribution
- none: 826
- returned: 0
- rejected: 24
- cancelled: 20
- on_hold: 0

## Legacy orders.status distribution
- Delivered: 769
- Rejected: 24
- Under Production: 23
- Cancelled: 20
- Try In: 12
- Waiting Dr Approval: 9
- New Case: 7
- Under Design: 4
- Try In Approved: 2

## Suspicious mapping flag counts
- delivered_but_tryin: 28
- ready_tryin: 0
- tryin_no_history: 6
- legacy_returned: 0
- legacy_rejected: 24
- legacy_cancelled: 20
- null_delivery_type: 360
- delivered_missing_actual_date: 464
- nondelivered_with_actual_date: 3

## Financial consistency flag counts
- ok: 831
- missing_doctor_receivable: 28
- stale_doctor_receivable: 2
- missing_lab_payable: 33
- stale_lab_payable: 2

## Readiness counts
- Rep-audited-edit readiness (would be editable on flip): 57
- Rows needing manual review: 570

## Cross-check samples

### delivered_but_tryin (28 rows)
Orders with legacy status `Delivered` but `delivery_type='TryIn'`. These mapped to `final_delivered` per hard rule (delivered always = final_delivered regardless of delivery_type). This is expected behavior per migration 086 design.

| id | case_id | status | delivery_type | production_status | issue_state |
|---|---|---|---|---|---|
| a7975397-7a1d-440f-9195-9f4d636dbec8 | 5013-150226-002 | Delivered | TryIn | final_delivered | none |
| f77798da-eaaa-4184-a59e-b417cf4e0650 | 5013-150226-001 | Delivered | TryIn | final_delivered | none |
| b62bc98b-71cd-4cdf-b24e-4ffc1cd8594d | 3002-080226-002 | Delivered | TryIn | final_delivered | none |
| d3837d21-6cbe-40ef-8bf3-9b7f9be5e95c | 1017-2002-1507 | Delivered | TryIn | final_delivered | none |
| 8fb39264-f337-4489-a598-b474173763e8 | 3009-260514-501 | Delivered | TryIn | final_delivered | none |

### delivered_missing_actual_date (464 rows)
Orders with `production_status='final_delivered'` but NULL `actual_delivery_date`. This is a pre-existing data quality gap — the backfill cannot invent dates. These rows need manual backfill of `actual_delivery_date` if the business wants accurate reporting.

| id | case_id | status | production_status | actual_delivery_date |
|---|---|---|---|---|
| a21dca9b-c192-4c83-86aa-4d652ce543e9 | 1001-2502-2144 | Delivered | final_delivered | |
| 19fee1a2-2385-4944-9200-eb222e9bab8d | CASE-1769820310810-1 | Delivered | final_delivered | |
| 24e0a44e-6c8b-497b-aac7-fc5f51d7eea1 | CASE-1769820310810-4 | Delivered | final_delivered | |
| 2d634ad4-4b4f-41aa-934c-4a6577f979e0 | CASE-1768129706975-3 | Delivered | final_delivered | |
| 55684f14-d348-4f0b-af67-1580efebfdfd | CASE-1771126616125-7 | Delivered | final_delivered | |

### missing_doctor_receivable (28 rows)
Orders in `final_delivered`+`none` without an active `doctor_delivered` financial obligation. Pre-existing data gap — these orders may have been delivered before the financial tracking module was introduced.

| id | case_id | production_status | issue_state |
|---|---|---|---|
| 456e44b6-129b-43e9-8c20-713c1bf6e8a1 | 5044-260521-502 | final_delivered | none |
| c8c0f14a-1c9a-4986-8a0c-5987783ad44f | 1025-2803-0210 | final_delivered | none |
| 7578d062-aa63-46b6-9982-9b8dae803b5e | 2022-260516-506 | final_delivered | none |
| 000b7631-62f4-4cd5-af70-1a7701da5c01 | 1019-260520-681 | final_delivered | none |
| 7b1d78f9-4786-4c4a-bec7-1417f48baab5 | 1033-260519-517 | final_delivered | none |

### null_delivery_type (360 rows)
360 orders have NULL `delivery_type`. This is pre-existing data. The backfill treats NULL as non-TryIn (final_only path). No workflow impact, but affects filtering accuracy.

## Finance-drift check
- recent_obligations_created: 0
- recent_obligations_modified: 0
- recent_transactions_modified: 0

## Files attached
- Audit script (`scripts/workflow-audit.ts`) crashed with libuv assertion on Windows during CSV generation. All data in this report was derived from direct SQL cross-checks against the local DB.
- prod-public-data.sql (local only, gitignored)

## Agent notes / anomalies
1. **Missing `is_archived` column**: The local schema was missing `is_archived` which exists in prod. Added locally with `ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;` before restore.
2. **Check constraint mismatch**: `orders_design_status_check` locally enforced `pending|in_progress|completed` but prod had values like `Not Started` and `Approved`. Dropped the constraint locally before restore.
3. **Missing tables**: `contact_inquiries` and `marketing_events` tables referenced in the dump don't exist locally — non-critical, restore skipped them.
4. **No `cases` table**: The prod schema does not have a separate `cases` table; `case_id` is a column in `orders`.
5. **Audit script failure**: `npx tsx scripts/workflow-audit.ts` crashed with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on Windows. This appears to be a libuv/Node.js threading issue with the Supabase client. All audit data was recovered via direct SQL queries.
6. **Backfill applied**: Since the dump predated migration 086 (all `production_status` and `issue_state` were defaults), the backfill sections 3+4+5 from migration 086 were re-run manually against the local DB.
