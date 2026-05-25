# Orders Field Permissions — Canonical Reference

This document is the single source of truth for which order fields each role may edit, what state guards apply, and how the audit-gated update pathway works. Both the TypeScript constants in `src/lib/workflowPermissions.ts` and the SQL trigger / RPC in `supabase/migrations/086_*.sql` reference this document by section number.

> Status: WF-1 (compatibility / shadow phase). The `orders.status` enum is unchanged and remains authoritative for all financial and workflow behavior. `production_status` and `issue_state` are shadow columns. Strict representative enforcement is **off by default** behind feature flag `app.workflow_strict_rep` until WF-4 ships the rep-edit UI.

---

## 1. Roles

`admin`, `lab`, `accountant`, `designer`, `representative`, `doctor`. Source: `src/lib/userRoles.ts`.

`auth.uid()` resolves to a `users` row whose `role` column is one of the above. `get_my_role()` (DB helper, migration 057) returns the role string or `NULL` for service-role / migration / unauthenticated contexts.

---

## 2. Production Status (8 values, shadow column)

```
not_started → designing → in_production →
  (final-only)         final_ready → final_delivered
  (try-in workflow)    try_in_ready → waiting_doctor → finalization → final_ready → final_delivered
```

Selector: `orders.delivery_type` (`'TryIn'` → try-in workflow; `'Final'` or `NULL` → final-only). No new column.

**Hard invariant**: legacy `orders.status='Delivered'` always maps to `production_status='final_delivered'` and `issue_state='none'`, regardless of `delivery_type`. Existing financial obligations on these rows are never voided by backfill.

## 3. Issue State (6 values, orthogonal)

`none`, `returned`, `rejected`, `cancelled`, `on_hold`, `redo`.

`redo` — admin-only; closes the current order (sets `issue_state='redo'`, `status='Rejected'`) and creates a new linked order pre-filled with the same data. Added by migration 087.

`production_status` is **never auto-rewound** when `issue_state` changes. Reason and responsibility are recorded in `order_events`.

---

## 4. Field-Level Permissions Matrix (canonical)

Legend: ✅ allowed · ❌ denied (trigger raises) · ⚙ governed by the existing `check_order_update_permissions` trigger (migration 031) · 🅐 audit-gated (rep can change only via `rep_update_order_fields_with_audit` RPC).

### 4.1 Identity / audit fields

| Field | admin | lab | accountant | designer | representative |
|---|---|---|---|---|---|
| `id`, `case_id`, `created_at`, `updated_at` | ❌ DB-managed | ❌ | ❌ | ❌ | ❌ |
| `is_redo`, `original_order_id`, `status_history` | ❌ system-managed | ❌ | ❌ | ❌ | ❌ |
| `is_archived` | ✅ admin only | ❌ | ❌ | ❌ | ❌ |

### 4.2 Workflow / status

| Field | admin | lab | accountant | designer | representative |
|---|---|---|---|---|---|
| `status` (legacy) | ✅ | ⚙ | ✅ | ⚙ | ❌ |
| `production_status` | ✅ | ✅ (state-machine guarded later in WF-2) | ❌ | ❌ | ❌ |
| `issue_state` | ✅ all | ✅ for `none↔returned`, `none↔on_hold`; ❌ `rejected`/`cancelled` | ❌ | ❌ | ❌ |
| `actual_delivery_date` | ✅ revert flow only | ⚙ via status | ❌ | ❌ | ❌ |
| `design_status` | ✅ | ⚙ | ❌ | ✅ | ❌ |
| `technician_status` | ✅ | ⚙ allowed for lab | ❌ | ❌ | ❌ |
| `workflow_type`, `delivery_type` | ✅ post-create | ⚙ | ❌ | ❌ | ❌ |
| `needs_design_review` | ✅ | ⚙ | ❌ | ✅ | ❌ |

### 4.3 Financial fields

| Field | admin | lab | accountant | designer | representative |
|---|---|---|---|---|---|
| `total_price`, `cost`, `design_price`, `discount`, `rejected_lab_cost` | ✅ | ⚙ | ✅ | ❌ | ❌ |
| `manual_cost` | ✅ admin only (UI gated to admin in `OrderForm`) | ⚙ | ❌ | ❌ | ❌ |
| `is_registered` | ✅ | ❌ | ✅ | ❌ | ❌ |

### 4.4 Parties / assignment

| Field | admin | lab | accountant | designer | representative |
|---|---|---|---|---|---|
| `doctor_id` | ✅ admin-only post-create | ⚙ | ❌ | ❌ | ❌ |
| `representative_id` | ✅ admin-only post-create | ⚙ | ❌ | ❌ | ❌ |
| `supplier_id` | ✅ | ⚙ | ❌ | ❌ | 🅐 (state-guarded; see 5.2) |
| `designer_id` | ✅ | ⚙ | ❌ | ❌ | 🅐 (state-guarded; see 5.2) |

### 4.5 Logistics / files / communication

| Field | admin | lab | accountant | designer | representative |
|---|---|---|---|---|---|
| `comments` | ✅ | ⚙ | ✅ | ✅ | ✅ append (existing flow) |
| `delivery_date` (planned) | ✅ | ⚙ | ✅ | ❌ | 🅐 |
| `instructions` | ✅ | ⚙ | ❌ | ❌ | ❌ (deferred — see L.1) |
| `priority` | ✅ | ⚙ | ❌ | ❌ | 🅐 |
| `is_urgent` | ✅ | ⚙ | ❌ | ❌ | 🅐 (allow with reason) |
| `stl_url`, `images_url` | ✅ | ⚙ | ❌ | ❌ | 🅐 |
| `feedback` | ✅ | ⚙ | ❌ | ❌ | ❌ |
| `external_lab_status`, `external_lab_notes` | ✅ | ⚙ allowed for lab | ❌ | ❌ | ❌ |
| `design_url` | ✅ | ⚙ | ❌ | ✅ | ❌ |
| `shade` (top-level) | ✅ | ⚙ | ❌ | ❌ | ❌ |
| `items` (incl. teeth_numbers, item shade, item price) | ✅ | ⚙ | ❌ | ❌ | ❌ — **deferred to WF-1b** |

---

## 5. Representative Audit-Gated Edits (WF-1)

### 5.1 Allow-list (RPC `rep_update_order_fields_with_audit`)

`patient_name`, `stl_url`, `images_url`, `delivery_date`, `is_urgent`, `priority`, `supplier_id`, `designer_id`.

### 5.2 State guards (enforced inside the RPC for representative role)

| Field | Allowed when |
|---|---|
| `patient_name`, `stl_url`, `delivery_date`, `priority` | `production_status <> 'final_delivered'` AND `issue_state = 'none'` |
| `images_url` | `production_status <> 'final_delivered'` |
| `is_urgent` | always (escalate or de-escalate; reason captured) |
| `supplier_id` | `production_status NOT IN ('final_ready','final_delivered')` AND `issue_state = 'none'` |
| `designer_id` | `production_status NOT IN ('finalization','final_ready','final_delivered')` AND `issue_state = 'none'` AND `workflow_type = 'split'` |

Admin and lab callers of the same RPC bypass these state guards; they still emit the same audit rows.

### 5.3 Reason codes

Single source of truth: `src/constants/orderEditReasons.ts`. Used by representative edits today, will be reused by future workflow transitions and issue-state changes.

`doctor_requested`, `wrong_intake_data`, `missing_info_completed`, `scan_updated`, `images_updated`, `items_corrected`, `teeth_corrected`, `delivery_rescheduled_doctor`, `delivery_rescheduled_lab`, `urgent_doctor_requested`, `external_lab_reassigned`, `designer_reassigned`, `internal_correction`, `other`.

`reason_note` is required when `reason_code = 'other'`.

### 5.4 Deny-list (representative — never editable, even via RPC)

`status`, `production_status`, `issue_state`, `actual_delivery_date`, `total_price`, `cost`, `manual_cost`, `design_price`, `discount`, `rejected_lab_cost`, `doctor_id`, `representative_id`, `delivery_type`, `workflow_type`, `design_status`, `technician_status`, `external_lab_status`, `external_lab_notes`, `is_registered`, `is_archived`, `feedback`, `status_history`, `id`, `case_id`, `created_at`, `updated_at`, `is_redo`, `original_order_id`, `needs_design_review`, `design_url`, `shade` (top-level), `items` (and all subfields — deferred to WF-1b).

---

## 6. Order Events as the Single Timeline

Every audited mutation writes one row per changed field into `order_events` (existing table, migration 080). Conventions:

- `event_type`: specific where useful (`patient_name_changed`, `supplier_changed`, future `production_status_changed`, `issue_state_changed`); generic `order_field_changed` as fallback.
- `old_value` / `new_value`: TEXT scalar repr (truncated to 4000 chars).
- `metadata` JSONB:
  ```json
  {
    "fieldName": "supplier_id",
    "oldValue": "<uuid or scalar or json>",
    "newValue": "<uuid or scalar or json>",
    "reasonCode": "external_lab_reassigned",
    "reasonLabel": "إعادة تعيين معمل خارجي",
    "note": "...",
    "source": "representative_edit",
    "rpcVersion": 1,
    "actorUserId": "<uuid>",
    "actorRole": "representative",
    "previousSupplierName": "...",
    "newSupplierName": "..."
  }
  ```
- `metadata.source ∈ { 'representative_edit', 'workflow_transition', 'admin_correction', 'lab_operation' }`.
- `severity`: `'info'` for low-risk fields; `'warning'` for `supplier_changed` / `designer_changed`.
- `responsibility_party`: `'representative'` when rep-driven.

`order_history` (migration 019) keeps doing its raw field-level audit job; `order_events` is the workflow timeline.

---

## 7. Feature Flag — Strict Representative Mode

`app.workflow_strict_rep` (Postgres GUC, default `'off'`).

- `off` (default in WF-1): the trigger's representative branch returns `NEW` unchanged. Reps continue using existing `db.updateOrder` paths exactly as before. **Zero regression.**
- `on`: the trigger blocks every direct rep UPDATE that doesn't carry the tx-local `app.rep_audit_in_progress = 'true'` flag set by the audited RPC. Reps must use `rep_update_order_fields_with_audit`.

Activation (admin only, post-WF-4):
```sql
ALTER DATABASE postgres SET app.workflow_strict_rep = 'on';
```

Deactivation:
```sql
ALTER DATABASE postgres SET app.workflow_strict_rep = 'off';
```

Other roles (admin, lab, accountant, designer) are **not** behind the flag; their restrictions ship live in WF-1.

Emergency disable of the entire trigger (preserves data, audit history, and other roles' rules — last resort):
```sql
ALTER TABLE orders DISABLE TRIGGER trigger_orders_role_field_guard;
```

---

## 8. Out of Scope for WF-1 (deferred)

- **WF-1b**: representative editing of `items` / per-item teeth_numbers / per-item shade / per-item price + automatic recalculation of `total_price`, `cost`, `design_price`. Strategy decision deferred (approval-queue lean recommended).
- **WF-2**: TS predicate helpers (`canEditOrderField`, `canChangeProductionStatus`, …) and switching `getProductionStatus` to column-first without legacy fallback.
- **WF-3**: emission of new event types from workflow transitions (currently emitted only by the RPC).
- **WF-4**: rep-edit modal UI + WorkflowActionBar replacing the legacy status dropdown.
- **WF-5**: financial hook alignment with `production_status` / `issue_state` (extends issue-axis voiding).
- **WF-6**: analytics on top of `order_events`.
