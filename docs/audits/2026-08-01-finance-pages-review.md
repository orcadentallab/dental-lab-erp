# Finance pages review — 2026-08-01

## Production-change preview

- Existing records changed automatically: **0**
- Existing financial amounts changed automatically: **EGP 0.00**
- New migration: `20260801110000_create_finance_transaction_atomic.sql`
- Migration scope: one new function; no `UPDATE`, `DELETE`, backfill, or existing-row correction

## Confirmed statement findings

The Accounts, Statements, and PDF paths did not consistently represent rejected
and deleted orders:

- `Doctor Rejected` could display as zero in the all-orders view even when an
  approved full/custom responsibility remained active.
- Soft-deleted terminal orders could reach generated doctor statements.
- The all-orders UI could bypass the normal soft-delete exclusion.
- An archived order remains included; only `is_deleted` excludes the order.
- The Accounts opening balance could remain stale after toggling all-orders mode
  because the memoized calculation omitted that dependency.

The three paths now use `getDoctorOrderDisplayAmount` for informational values,
retain `getDoctorReceivableAmount` as the official balance amount, and consistently
exclude soft-deleted orders.

## Confirmed finance-entry finding

Cashbox transfer fees were client-orchestrated after the original transaction.
General expenses could therefore commit without their fee if the second request
failed. Supplier/designer forms displayed a calculated fee but did not persist it.

`create_finance_transaction_atomic` now inserts the original transaction and its
optional linked transfer fee in one database transaction. The client uses it for:

- general expenses;
- supplier payments;
- designer payments.

If either insert or any downstream allocation trigger fails, neither transaction
commits.

## Verification

- Unit tests: 18 files, 113 tests passed.
- Database tests: 7 files, 115 tests passed.
- Database lint: passed with no errors.
- Production build: passed.
- RLS verification: anonymous and doctor callers cannot use the RPC; accountants
  can use it through existing transaction insert policies.
