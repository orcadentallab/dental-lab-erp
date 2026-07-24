# Approved Financial Rules — 2026-07-24

Status: approved for implementation. Database deployment still requires a separate
review and approval after tests pass.

## Invariants

1. Payment transactions are immutable. Corrections reverse and recreate allocations;
   they never edit or delete the original payment.
2. Every financial change records the old value, new value, actor, reason, timestamp,
   and affected order/obligation/allocation IDs.
3. An order update and all resulting obligation, allocation, and credit changes are
   one atomic operation. On failure, nothing changes and the user receives a clear
   failure message and reference.
4. Credits and allocations never cross entities.
5. Duplicate active obligations for the same order/party/trigger are forbidden.

## Doctor receivables

- A doctor receivable is created only at final delivery.
- The amount is the final order total after discount.
- Historical orders retain their agreed order price; later service-price changes do
  not alter them.
- Before delivery, representatives may edit their permitted operational fields,
  including doctor, external lab, and services. Dependent prices are recalculated.
- After delivery, a representative cannot directly change the doctor, services,
  discount, or other financially material values. The representative submits a
  request and an admin approves it.
- Accountants neither make nor request these changes.
- Admin-approved post-delivery corrections automatically rebuild allocations.

### Price decreases after collection

1. Keep the original payment unchanged.
2. Allocate only the corrected amount to the corrected order.
3. Move excess to the doctor's oldest eligible open obligation using FIFO.
4. Store any remainder as doctor credit.
5. Apply doctor credit automatically, using FIFO, to current and future eligible
   obligations.

### Price increases after collection

- Keep current allocations up to the corrected amount.
- Leave the difference outstanding.
- The next doctor payment settles it through normal FIFO ordering.

## Rejection quick decision

When a representative records a rejection, the doctor decision has exactly four
choices:

1. `decide_later`
2. `full_price`
3. `zero`
4. `custom_amount`

The selected decision is executed immediately as part of the rejection transaction.
It does not require later admin approval. A custom amount is the exact amount agreed
to be borne by the doctor.

If `decide_later` is selected:

- the order enters the financial review queue;
- the full order price is charged to the doctor immediately as the lab-safe
  provisional amount;
- the admin may later replace that amount with zero or another agreed amount through
  the atomic correction flow;
- reports must identify the result as provisional rather than final.

After the rejection is saved, only an admin may change the financial decision.

## Rejected supplier and designer costs

- Supplier entitlement defaults to zero.
- Designer entitlement defaults to zero.
- Existing unpaid supplier/designer obligations are voided.
- A paid amount is not deleted; it becomes a credit in favor of the lab and is offset
  against that party's future entitlements.
- An admin may later record zero, full, percentage-based, or custom supplier/designer
  entitlement quickly.
- Deferred supplier/designer decisions remain visible in the financial review queue
  and keep order profitability provisional.

## Redo

- A redo is a new order linked to the original order.
- Doctor charge defaults to zero unless the quick decision specifies otherwise.
- Supplier and designer redo entitlements may be decided later.
- Admins can amend all redo financial decisions later using the same atomic correction
  and allocation rules.

## Archive, deletion, and restoration

- Archive is organizational only and does not change financial obligations.
- A financially active order cannot be destructively deleted.
- Financial cancellation uses explicit reversal records, not deletion.
- Restoration must not silently recreate or duplicate obligations.
