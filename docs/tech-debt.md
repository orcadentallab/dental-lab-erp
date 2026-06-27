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
