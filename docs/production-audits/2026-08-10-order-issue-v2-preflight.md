# Order Issue V2 Production Preflight — 2026-08-10

Project: `piuiiwcjnfvjwyewczuz` (`main`, Production)

This snapshot was collected using read-only aggregate SQL before any V2 DDL or
data mutation. It intentionally contains no doctor or patient names.

## Baseline

- Active non-deleted orders: `1114`
- Active doctor obligations: `972`
- Active doctor net amount: `1,857,010.00`
- Active external-lab obligations: `968`
- Active external-lab net amount: `1,236,272.00`
- Active designer obligations: `260`
- Active designer net amount: `6,570.00`
- Duplicate active obligation business keys: `0`
- Non-zero active obligations on Cancelled/Lab Rejected orders: `0`
- Legacy orders with `status='Rejected'`: `0`
- V2 lifecycle columns present: `false`
- V2 workflow tables present: `false`

## Reviewed AB Lab settlement — valid historical allocation

Two active FIFO allocations point to one written-off external-lab obligation
for order `1031-260711-506`:

- Allocation `4e4323a4-7c50-47d6-a7f1-77f32db69518`: `180.00`
- Allocation `6f8fbe11-e0f5-47a3-a3a6-221ff6e06529`: `4,455.00`
- Active total on written-off obligation: `4,635.00`

The active allocations are the actual payments made against the original
`5,100.00` obligation. Only the residual `465.00` was closed by the approved
account-closing adjustment, so keeping the `4,635.00` allocation trail active
on the `written_off` obligation is intentional. It is not a doctor-balance
issue and should be classified as `settled_writeoff_valid`, not as an
allocation inconsistency.

## Deployment gate

The schema compatibility stage must leave all V2 flags off and must not change
the doctor obligation count or net amount above. Finance V2, backfill, client
cutover, and legacy status retirement remain blocked until separate parity and
reconciliation checks pass.

## Compatibility-stage result

The reviewed schema-only migrations `20260808000000`, `20260808000500`,
`20260808002000`, and `20260808004000` were applied manually through the
Production SQL Editor and recorded in both `schema_deployment_log` and
`supabase_migrations.schema_migrations`.

Postflight assertions confirmed:

- Active doctor obligations remained `972`.
- Active doctor net amount remained `1,857,010.00`.
- Rows mutated with either V2 lifecycle timestamp: `0`.
- All V2 write, enforcement, finance, shadow-read, and accounting-audit flags
  remain `off`; the legacy mirror remains `on`.
- The dry-run identified `25` lifecycle-timing rows that require review. The
  backfill function now rejects execution while any such row remains.
- No financial migration, backfill, constraint validation, client cutover, or
  legacy-status retirement was executed.

Local database verification after the final dry-run gate change passed all
`143` pgTAP tests.

## Reviewed legacy timing resolution — 2026-08-11

Migration `20260811000000` was applied manually through the Production SQL
Editor with checksum
`03CAF2055CF9D399C4618C566933046F4A039EDD7A686E078FEAF9DB9F11A87E`.

- `1031-260425-502` was corrected to
  `Doctor Rejected / final_delivered / doctor_rejected` using its documented
  status-history delivery timestamp.
- All 24 historical post-delivery issues were marked with reviewed legacy
  delivery evidence without manufacturing exact delivery timestamps.
- Effective unresolved timing rows: `0`.
- Active doctor obligations before/after: `978`.
- Active doctor net before/after: `1,868,135.00`.
- AB Lab allocation audit: `settled_writeoff_valid`.
- All rollout and finance flags remain unchanged and off.
- Local database verification passed all `153` pgTAP tests.
