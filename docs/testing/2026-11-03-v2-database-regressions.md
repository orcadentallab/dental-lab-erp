# V2 database baseline repairs — 3 November 2026

Owner request: resolve shipment eligibility first, then costing/rework, then old V2 assertions, preserving remake finance and rerunning the complete suite.

## Result

- SQL: **54 files, 947 tests, PASS**, all planned tests completed. Command: `node_modules/supabase/bin/supabase.exe test db supabase/tests/database --local`. Evidence: `.tmp/db-v2-fixes-full.log`.
- Unit: **63 files, 560 tests, PASS**. Command: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts`. Evidence: `.tmp/unit-v2-db-fixes.log`.
- Previous baseline: 54 SQL files, 933 executed tests, eight failing files and six costing assertions never reached. Final suite restores those six assertions and adds eight new checks; none were removed or skipped.
- Only local Docker schema was migrated. No production deployment, source flag change, historical correction, backfill, volume reset or production verification performed.

## Shipping defect and RED/GREEN

The effective `create_shipment` readiness predicate was:

```sql
production_status NOT IN ('final_ready','try_in_ready') AND status <> 'Ready'
```

For a pending-review Portal case with NULL legacy status, this evaluates to NULL, so `EXISTS` does not reject it. A stale legacy Ready also overrode an explicitly unready V2 production state.

New migration `20261103000000_shipment_readiness_v2_guard.sql` replaces only that predicate with a NULL-safe production-state check plus `intake_state='accepted'`. It retains function signature, permissions, locks, destination/deletion/duplicate checks and shipment mutations. The migration fails explicitly if the expected prior function text is absent; review deployment definitions before any separately authorized production application. It performs no data updates and touches no financial function.

RED: Portal suite completed 55 assertions with 3 failures: pending intake shipped; a link remained for that shipment; stale legacy Ready shipped. Checkpoints `921475b` / `8e80021` preserve tests and fixture completion. Initial fixture attempts lacked required total_price/cost fields; these were fixed before the complete RED evidence was recorded.

GREEN: after `supabase migration up --local`, all 55 assertions passed. Added a further positive assertion proving accepted V2 Try-In Ready still ships; the final Portal suite has 56 tests. Existing final-ready shipping remains covered by the same suite and the shipment integration suite.

## Costing and rework: valid fixtures, unchanged business calculations

- Cancellation fixture previously inserted only `status='Cancelled'`, leaving V2 `issue_state='none'`. It now starts as a normal order and calls the actual `apply_order_issue_transition_v2(...,'cancel_order',...)` RPC with constraints and triggers enabled. The existing zero cost/zero revenue/non-billable expectations remain; an extra assertion derives Cancelled despite stale legacy New Case.
- The costing historical job used round 1, which is already created by the automatic production trigger. Its deliberately backfilled historical job now uses round 2 alongside the automatic round. The backfilled internal-run exclusion and EGP 600 external-cost assertions remain unchanged; the remaining six costing assertions now execute.
- The report's rework fixture previously had V2 `issue_state='none'` despite its old Returned label. It now has `issue_state='returned'` and a prior delivery timestamp, as required by existing issue timing constraints. Its old status deliberately remains Under Production. An added derived-status assertion proves rework comes from V2; all nine original count/date/money expectations are unchanged.

Neither costing nor analytics application functions were modified.

## Other old assertions

- Admin issue correction, technician rejection and shipment delivery assertions now derive display status from all three V2 axes, retaining their issue/production/technical and receipt checks.
- Atomic redo expects derived Redo rather than legacy Doctor Rejected, while retaining all existing financial/lineage/idempotency assertions. No remake function, price, allocation, liability or settlement changed.
- Archive protection tests separately reject a money change and a V2 production change combined with archiving, then assert the original archive/money/workflow values remain. This replaces dependence on a legacy-write error arriving before the archive guard; it strengthens archive coverage.
- Legacy mirror was not re-enabled; no test bypass or new permission was introduced. The analytics fixture's pre-existing replica setup remains confined to its rollback transaction; the new cancellation test uses the guarded real RPC instead.

## Review and rollback

Review the one new migration and eight modified SQL test files. Existing unrelated dirty changes and untracked November 1 migrations/tests remain outside this change. Release remains separately authorized. A code rollback must not restore the NULL/legacy shipping bypass: retain a V2 eligibility guard or disable shipment creation during a reviewed correction.

Self-evaluation: accuracy 4/5 (local executable evidence; production unverified), completeness 4/5 (all eight failures resolved; no production acceptance claimed), clarity 4/5 (root cause separated from fixture repair; raw logs remain local), actionability 4/5 (migration and commands supplied; deployment definition review outstanding), conciseness 4/5 (single evidence record, detailed failure history retained only where useful). Average 4.0/5. Main follow-up is separately authorized deployment-definition verification, then remaining ERP implementation packages. The user should agree this resolves the requested local baseline without changing remake finance.
