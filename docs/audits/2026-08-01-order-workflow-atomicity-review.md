# Order workflow atomicity review — 2026-08-01

## Production-change preview

- Existing records changed: **0**
- Existing financial amounts changed: **EGP 0.00**
- Database data migration required: **none**
- Database definition migrations: **two function-only migrations**
- Scope: future order-mutation behavior in the application client and database

## Confirmed finding

The database trigger `sync_order_financial_obligations` already synchronizes
order obligations, allocations, and credits in the same transaction as an order
insert/update. Rejection decisions use dedicated atomic RPCs.

The client still repeated legacy financial synchronization after those database
transactions returned. A failure in the repeated client step could therefore
show the user a failure even though the order and authoritative finances had
already committed. It also created two competing owners for the same financial
side effect.

## Fix

Normal order mutations now return after the atomic database result and audit
event handling. Legacy client-side financial synchronization remains available
behind `clientSideMutationSyncEnabled`, which defaults to `false` and is intended
only as an emergency diagnostic fallback.

The database remains the sole normal authority for:

- delivery/reversal obligation lifecycle;
- doctor, supplier, and designer party corrections;
- amount corrections;
- rejection settlements;
- allocation transfer and credit creation;
- soft-delete financial cleanup.

## Allocation actor identity correction

Integration testing also found that automatic doctor and payable allocation
triggers passed `auth.uid()` into audit columns that reference `public.users(id)`.
Those UUIDs are not guaranteed to be equal. The triggers now resolve the current
application profile with `get_my_user_id()` before creating allocations or
allocation events. This prevents otherwise-valid authenticated collections and
supplier/designer payments from failing on the actor foreign key.

## Atomic soft-delete correction

The existing client called the generic order update path to set `is_deleted`,
but the database correctly blocked financially active orders and requested an
explicit financial cancellation workflow. `soft_delete_order_atomic` is now
that workflow: it changes the order and lets the database financial trigger
void obligations, reverse allocations, and preserve paid amounts as account
credits in the same transaction. Direct financially active soft-deletes remain
blocked.
