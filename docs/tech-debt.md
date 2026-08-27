# Tech Debt Registry

This document tracks identified technical debt, architectural issues, and planned refactoring tasks for the Dental Lab ERP system.

---

## TD-001: Move financial obligation creation to DB trigger

### Description
Financial obligations (receivables and payables) are created and kept in sync automatically via database triggers, eliminating risk of out-of-sync data from direct database writes or external RPCs.

### Status
* **Status**: ✅ Resolved (Implemented via trigger `sync_order_financial_obligations` in migration `20260724000100_atomic_order_financial_obligations.sql`).
* **Details**: Atomic DB trigger runs on order creation/status update. TypeScript client-side mutation sync remains as an emergency fallback (`FINANCIAL_OBLIGATIONS_FLAGS.clientSideMutationSyncEnabled = false` in `src/constants/financialObligations.ts`).

---

## TD-002: Obligations voided on delete/archive cannot be restored automatically

### Description
Clarification of Archiving (`is_archived`) versus Deletion (`is_deleted`) and enforcement of deletion boundaries.

### Status
* **Status**: ✅ Clarified & Resolved (Implemented guard in migration `20260827007000_guard_soft_delete_final_delivered.sql`).
* **Details**:
  - **Archiving (`is_archived`)**: Purely a UI display/filtering toggle. It carries zero financial impact and does not affect or void financial obligations or reports.
  - **Deletion (`is_deleted`)**: Soft deletion is restricted to administrative workflows on unfulfilled or cancelled cases. In migration `20260827007000_guard_soft_delete_final_delivered.sql`, `soft_delete_order_atomic` explicitly forbids deleting any order where `production_status = 'final_delivered'` or where active financial obligations (`status NOT IN ('void', 'written_off')`) exist.
  - Because delivered orders and financially active orders cannot be deleted, automatic restoration of obligations upon unarchive/restore is not required.

---

## TD-003: Orphaned obligation logging and reconciliation tracking

### Description
When an exceptional condition or failure occurs during obligation handling (such as fallback emergency voiding), records are captured in a dedicated database table for audit and manual accountant review rather than only ephemeral console logs.

### Status
* **Status**: ✅ Resolved (Implemented `reconciliation_flags` in migration `20260827008000_reconciliation_flags.sql`).
* **Details**:
  - `reconciliation_flags` database table stores flagged issues with status (`open` / `resolved`), severity, error messages, and metadata.
  - `flagReconciliationIssue()` helper in `src/services/supabase/reconciliationFlags.ts` inserts audit records on failure.
  - `FinancialReview.tsx` includes a "تسويات معلّقة" tab allowing accountants to review open flags and mark them resolved with audit notes.

---

## TD-004: Client-side full-table aggregation for financial summaries

### Description
Financial summaries on pages like Accounts, Aging Report, Balance Snapshot, and Statements currently aggregate orders and transactions client-side.

### Status
* **Status**: ⏸️ Deferred (By decision).
* **Rationale**:
  - Current volume (~1,174 orders) is well within performance limits and far from the ~5,000 threshold.
  - Financial aggregation embeds critical business logic (cancellation/rejection exceptions, redo rules, split workflows) where direct SQL migration poses regression risk.
  - Deferred until database size approaches ~5,000+ orders, at which point comprehensive automated parity test suites (comparing TS output to SQL output) will accompany any SQL migration.
