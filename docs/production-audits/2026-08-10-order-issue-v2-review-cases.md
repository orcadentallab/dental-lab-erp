# Order Issue V2 — Production cases requiring review

Collected from `public.workflow_v2_backfill_dry_run` on 2026-08-10. This is a
read-only report and contains case identifiers only.

## Cancelled after delivery evidence (1)

The history contains delivery evidence, but the current issue is `cancelled`.
Confirm whether this was genuinely delivered before cancellation and therefore
needs a post-delivery classification instead.

| Case | Issue | Production status |
| --- | --- | --- |
| `1031-260425-502` | `cancelled` | `not_started` |

Resolved on 2026-08-11: delivery was confirmed from status history at
`2026-04-27 08:56:25.672+00`. The row is now
`Doctor Rejected / final_delivered / doctor_rejected` with a zero doctor,
supplier, and designer financial decision. Global active doctor obligations
were unchanged by the correction.

## Post-delivery issue without delivery evidence (24)

These rows are marked `doctor_rejected` or `redo`, which requires an earlier
final delivery, but no trustworthy final-delivery timestamp was found. Review
the original paperwork/accounting record and provide the real first-delivery
date, or correct the issue classification if delivery never happened.

Resolved on 2026-08-11 by the business owner's confirmation that all 24 were
delivered. `legacy_delivery_confirmed=true` was recorded with a separate admin
audit trail; `first_delivered_at` remains `NULL` because no exact date was
invented. Existing issue costs and financial obligations were not changed.

| Case | Issue | Production status |
| --- | --- | --- |
| `1001-140226-001` | `doctor_rejected` | `final_ready` |
| `1001-140226-002` | `doctor_rejected` | `final_ready` |
| `1017-170226-001` | `doctor_rejected` | `try_in_ready` |
| `1049-260707-503` | `redo` | `not_started` |
| `2004-260517-574` | `doctor_rejected` | `in_production` |
| `2011-260730-504` | `doctor_rejected` | `not_started` |
| `CASE-1768129706975-2` | `doctor_rejected` | `final_ready` |
| `CASE-1768129706976-105` | `doctor_rejected` | `final_ready` |
| `CASE-1768129706976-97` | `doctor_rejected` | `final_ready` |
| `CASE-1768129706977-162` | `doctor_rejected` | `final_ready` |
| `CASE-1768129706977-163` | `doctor_rejected` | `final_ready` |
| `CASE-1769820310810-32` | `doctor_rejected` | `not_started` |
| `CASE-1769820310811-63` | `doctor_rejected` | `not_started` |
| `CASE-1769820310811-64` | `doctor_rejected` | `not_started` |
| `CASE-1769820310811-74` | `doctor_rejected` | `final_ready` |
| `CASE-1769820310811-84` | `doctor_rejected` | `final_ready` |
| `CASE-1769820310811-86` | `doctor_rejected` | `final_ready` |
| `CASE-1770402907832-15` | `doctor_rejected` | `final_ready` |
| `CASE-1770402907832-16` | `doctor_rejected` | `final_ready` |
| `CASE-1770402907833-18` | `doctor_rejected` | `final_ready` |
| `CASE-1770402907833-29` | `doctor_rejected` | `not_started` |
| `CASE-1771119936390-14` | `doctor_rejected` | `final_ready` |
| `CASE-1771119936390-7` | `doctor_rejected` | `final_ready` |
| `CASE-1771119936390-8` | `doctor_rejected` | `final_ready` |

## Separate external-lab settled write-off

This is not one of the 25 lifecycle-review rows and does not involve a doctor
balance.

- Case: `1031-260711-506`
- Supplier: `AB Lab`
- Obligation: `45d09bdf-4219-4054-b2f2-99c87c9ae188`
- Obligation status: `written_off`
- Obligation net amount: `5,100.00`
- Stored allocated amount: `4,635.00`
- Stored remaining amount: `465.00`
- Active allocation `4e4323a4-7c50-47d6-a7f1-77f32db69518`: `180.00`
- Active allocation `6f8fbe11-e0f5-47a3-a3a6-221ff6e06529`: `4,455.00`

The `4,635.00` allocations are actual payments and remain active for audit
history. The approved `465.00` account-closing adjustment settled only the
remaining balance. This is valid and is classified as
`settled_writeoff_valid`; no financial correction is required.
