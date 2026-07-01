# Tech Debt Registry

This document tracks identified technical debt, architectural issues, and planned refactoring tasks for the Dental Lab ERP system.

---

## TD-001: Move financial obligation creation to DB trigger

### Description
Currently, financial obligations (receivables and payables) are created in TypeScript inside `updateOrderStatus()`. This means any direct write to `orders.status` (either via raw database queries or direct `supabase.from('orders').update` calls) bypasses obligation creation, which can lead to out-of-sync financial data.

### Proposed Fix
Implement an `AFTER UPDATE` trigger on the `orders` table in the database that calls the obligation creation and voiding logic atomically. This ensures that no matter how a status change occurs, the corresponding financial obligations are kept in sync.

### Priority
* **Priority**: HIGH
* **Timeline**: Implement before the next major feature addition.

---

## TD-002: Obligations voided on delete/archive cannot be restored automatically

### Description
When an order is archived (soft-deleted), its obligations (doctor receivable, designer payable, external lab payable, external lab rejection cost) are automatically voided and any active payment allocations are reversed. However, if the user un-archives (restores) the order, there is currently no automatic mechanism to recreate or un-void these obligations and re-apply the payments.

### Priority
* **Priority**: MEDIUM
* **Timeline**: Address when unarchive/restore feature is fully specified.

---

## TD-003: Orphaned obligation logging on archive failure

### Description
If voiding an individual financial obligation fails during order archiving/deletion (e.g. database connection drop or check constraint error), the exception is caught, and an error prefixed with `[ORPHANED_OBLIGATION_ERROR]` is logged. Since we do not have a dedicated `reconciliation_flags` database table, these logs must be monitored to review and manually reconcile orphaned obligations.

