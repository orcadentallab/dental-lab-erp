# Targeted Cleanup Preview

Scope: read-only preview only. No voiding, allocation, credit, transaction, obligation, migration, WF-2, or official finance change was performed.

Approved candidate set:
- 11 stale doctor receivables
- 4 supplier issue/non-final normal payables

## Executive Summary

| Bucket | Count | Amount | Proposed future action |
|---|---:|---:|---|
| Stale doctor receivables | 11 | 33,800.00 | Void in a targeted cleanup write, if approved |
| Supplier issue/non-final normal payables | 4 | 5,540.00 | Void normal payable or investigate issue settlement, if approved |
| Total | 15 | 39,340.00 | Do not allocate; targeted cleanup candidate set |

Read-only confirmations:
- Candidate obligations found: **15**
- Candidate amount: **39,340.00**
- Candidates linked to payment allocations: **0**
- All candidates currently have `payment_allocation_count = 0`
- All candidates are currently `unpaid`

Protected table counts observed:
- `financial_obligations = 1426`
- `payment_allocations = 0`
- `account_credits = 0`
- `allocation_events = 0`
- `financial_exception_reviews = 0`
- `transactions = 723`

## Proposed Future Void Candidates

### Stale Doctor Receivables

Expected reconciliation effect: reduce doctor receivable obligation-based balances by **33,800.00** total. These should not receive FIFO allocation because current order status/amount is not billable under the current official logic.

| Obligation ID | Case ID | Doctor | Amount | Order ID | Current order status | Actual delivery date | Payment allocations | Reason | Confidence | Expected reconciliation effect |
|---|---|---|---:|---|---|---|---:|---|---|---|
| `7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c` | 1003-1004-1515 | حاتم الدسوقى | 2,250.00 | `32e6f4f1-d5d4-40f7-830a-db5c1fbeba9d` | Try In | 2026-04-15 | 0 | Doctor receivable exists but order is Try-In, not final billable | High | Reduce active doctor receivables by 2,250.00 |
| `bea42b39-7085-43c0-a6e6-d0fbd2a3c516` | 1014-2603-1914 | دنتال جاليري | 1,200.00 | `50c4d3de-477f-41df-b6c8-09705dfabbd9` | Delivered | 2026-03-26 | 0 | `total_price = 0`, so current official receivable is zero | High | Reduce active doctor receivables by 1,200.00 |
| `6f7dff6e-5ef2-4784-898d-e8afaabc158a` | 1014-2603-1915 | دنتال جاليري | 1,200.00 | `5a0b2be4-1dea-4ae0-90a9-667c9ce56419` | Delivered | 2026-03-26 | 0 | `total_price = 0`, so current official receivable is zero | High | Reduce active doctor receivables by 1,200.00 |
| `11247e0e-e226-449e-954f-9dff999dabdb` | 1019-260505-598 | احمد حمدى | 725.00 | `37b013ac-ef04-469f-988a-583db46bd09a` | Under Design | 2026-05-09 | 0 | Order moved back to design workflow | High | Reduce active doctor receivables by 725.00 |
| `3bee6d3b-d906-45c8-866b-4dde35d638b6` | 1019-260509-653 | ابراهيم ابو ليلة | 725.00 | `934e66ca-6e2a-42c7-8cb0-022f629531d7` | Under Production | 2026-05-13 | 0 | Order moved back to production | High | Reduce active doctor receivables by 725.00 |
| `f84d605e-92f4-4977-898b-580d1137692f` | 1019-260509-655 | ابراهيم ابو ليلة | 1,625.00 | `17284824-e8dd-4449-b2d3-032323ae8e81` | Rejected | 2026-05-13 | 0 | Rejected case should not keep normal doctor receivable | High | Reduce active doctor receivables by 1,625.00 |
| `a659d0cf-582b-4f64-b43e-66d8507134a4` | 1019-260509-657 | ابراهيم ابو ليلة | 725.00 | `2d5fb113-4191-46b8-9ecc-c9d50be219a7` | Under Production | 2026-05-13 | 0 | Order moved back to production | High | Reduce active doctor receivables by 725.00 |
| `f7a4f80e-24f1-4d1a-b351-22b81272dd72` | 1019-260511-659 | محمد سالم | 1,450.00 | `f614d9f6-b1b7-4ebc-81bd-c8596d69282f` | Under Production | 2026-05-15 | 0 | Order moved back to production | High | Reduce active doctor receivables by 1,450.00 |
| `91bd642c-8bc7-4a93-aeb2-4b423a084c19` | 1031-260427-504 | احمد وجدي | 8,700.00 | `c133d7f5-85b6-4979-8893-75731aabb585` | Waiting Dr Approval | 2026-05-10 | 0 | Waiting doctor approval is not final delivered receivable | High | Reduce active doctor receivables by 8,700.00 |
| `a2a6a542-0cbf-4801-a17b-a6dc28ba8d60` | 1033-260507-510 | الشامي | 3,200.00 | `10bdc836-d28e-4f20-be7f-47d833825f49` | Try In | 2026-05-10 | 0 | Order is Try-In, not final delivered receivable | High | Reduce active doctor receivables by 3,200.00 |
| `c2c2664f-49ae-4614-96ca-f48a2a33f523` | 1037-260427-502 | اسلام منير | 12,000.00 | `d7ca5bed-b95e-4881-89b7-65a6149c071a` | Try In Approved | 2026-05-07 | 0 | Try-In approved/finalization is not final doctor receivable | High | Reduce active doctor receivables by 12,000.00 |

### Supplier Issue / Non-Final Normal Payables

Expected reconciliation effect: reduce normal external lab payable obligation-based balances by **5,540.00** total. These should not receive FIFO allocation because they are normal `external_lab_ready` payables attached to Try-In/Rejected/non-final orders.

| Obligation ID | Case ID | Supplier | Amount | Order ID | Current order status | Actual delivery date | Payment allocations | Reason | Confidence | Expected reconciliation effect |
|---|---|---|---:|---|---|---|---:|---|---|---|
| `c99dbae6-db37-4a32-afb2-dda899c97341` | 1003-1004-1515 | AB Lab | 1,500.00 | `32e6f4f1-d5d4-40f7-830a-db5c1fbeba9d` | Try In | 2026-04-15 | 0 | Normal payable exists while order is Try-In | High | Reduce active normal external lab payables by 1,500.00 |
| `0d002fac-332f-43e6-8a29-a2ef357ddb67` | 1019-260509-655 | AB Lab | 1,140.00 | `17284824-e8dd-4449-b2d3-032323ae8e81` | Rejected | 2026-05-13 | 0 | Normal payable exists on rejected case | High | Reduce active normal external lab payables by 1,140.00 |
| `483dde11-7f0f-4ae7-b0c1-9aba10b9dba6` | 1033-260507-510 | AB Lab | 2,000.00 | `10bdc836-d28e-4f20-be7f-47d833825f49` | Try In | 2026-05-10 | 0 | Normal payable exists while order is Try-In | High | Reduce active normal external lab payables by 2,000.00 |
| `15ce5e59-3183-44aa-97dd-9ca88a2ac989` | 2021-260503-501 | AB Lab | 900.00 | `fa0bb85d-623d-4bdd-9375-a5f84a49bcdc` | Rejected | 2026-05-13 | 0 | Normal payable exists on rejected case; `rejected_lab_cost = 500` should be handled separately | High | Reduce active normal external lab payables by 900.00 |

## Exact Candidate IDs For Future Targeted Write

Stale doctor receivables:

```text
7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c
bea42b39-7085-43c0-a6e6-d0fbd2a3c516
6f7dff6e-5ef2-4784-898d-e8afaabc158a
11247e0e-e226-449e-954f-9dff999dabdb
3bee6d3b-d906-45c8-866b-4dde35d638b6
f84d605e-92f4-4977-898b-580d1137692f
a659d0cf-582b-4f64-b43e-66d8507134a4
f7a4f80e-24f1-4d1a-b351-22b81272dd72
91bd642c-8bc7-4a93-aeb2-4b423a084c19
a2a6a542-0cbf-4801-a17b-a6dc28ba8d60
c2c2664f-49ae-4614-96ca-f48a2a33f523
```

Supplier issue/non-final normal payables:

```text
c99dbae6-db37-4a32-afb2-dda899c97341
0d002fac-332f-43e6-8a29-a2ef357ddb67
483dde11-7f0f-4ae7-b0c1-9aba10b9dba6
15ce5e59-3183-44aa-97dd-9ca88a2ac989
```

## Final Recommendation

Recommendation: **YES, a targeted write cleanup can be prepared next**, but only for these exact 15 IDs and only after explicit approval.

Future write constraints should be:
- Re-check every ID before voiding.
- Require `payment_allocation_count = 0`.
- Require `status <> 'void'`.
- Require the same `trigger_type` and `entity_type` expected by this preview.
- Patch metadata with a cleanup reason.
- Do not delete rows.
- Do not touch transactions.
- Do not touch payment allocations, credits, allocation events, or exception reviews.
- Rerun reconciliation after cleanup.

This preview does **not** approve or apply the write. It only confirms the targeted candidate set is coherent and currently unallocated.
