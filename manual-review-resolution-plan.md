# Manual Review Resolution Plan

Source inputs:
- `allocation-manual-review-analysis.md`
- `historical-allocation-preview.md`
- `historical-allocation-preview.csv`
- Read-only targeted detail queries for stale doctor receivables and issue settlement obligations

Scope: decision planning only. No writes were performed. No allocations, credits, transactions, obligations, migrations, WF-2 changes, or official finance logic were changed.

## A) Summary By Bucket

| Bucket | Count | Amount | Resolution |
|---|---:|---:|---|
| Stale doctor receivables | 11 | 33,800.00 | Void candidate, but only after an approved targeted cleanup |
| Supplier issue/non-final normal payables | 4 | 5,540.00 | Void normal payable candidate or investigate issue workflow |
| Issue settlement obligations | 7 | 4,745.00 | Keep excluded; settlement candidate, not clean FIFO |
| EZ Lab settlement transaction | 1 | 12,000.00 | Keep excluded; future settlement workflow |
| Dr.M Lab supplier overpayment | 1 | 800.00 | Needs business decision |
| Doctor credit candidates | 11 | 8,095.00 | Future credit workflow; do not allocate excess |

Decision: the full historical allocation write should remain paused. A clean-subset write can be designed later, but only after explicitly excluding the IDs in this plan and after one more clean-subset dry run.

## B) Stale Doctor Receivables

All rows below currently have `payment_allocation_count = 0`, so they are not payment-linked. They are stale because the current order state or amount is no longer billable under the current official logic. Recommended action is **void candidate**, not allocation.

| Obligation ID | Case ID | Doctor | Amount | Order ID | Current order status | Actual delivery date | Payment allocations | Why stale | Resolution |
|---|---|---|---:|---|---|---|---:|---|---|
| `6f7dff6e-5ef2-4784-898d-e8afaabc158a` | 1014-2603-1915 | دنتال جاليري | 1,200.00 | `5a0b2be4-1dea-4ae0-90a9-667c9ce56419` | Delivered | 2026-03-26 | 0 | `total_price = 0`; current official receivable is zero | Void candidate |
| `bea42b39-7085-43c0-a6e6-d0fbd2a3c516` | 1014-2603-1914 | دنتال جاليري | 1,200.00 | `50c4d3de-477f-41df-b6c8-09705dfabbd9` | Delivered | 2026-03-26 | 0 | `total_price = 0`; current official receivable is zero | Void candidate |
| `7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c` | 1003-1004-1515 | حاتم الدسوقى | 2,250.00 | `32e6f4f1-d5d4-40f7-830a-db5c1fbeba9d` | Try In | 2026-04-15 | 0 | Order left final delivered/billable state | Void candidate |
| `c2c2664f-49ae-4614-96ca-f48a2a33f523` | 1037-260427-502 | اسلام منير | 12,000.00 | `d7ca5bed-b95e-4881-89b7-65a6149c071a` | Try In Approved | 2026-05-07 | 0 | Order is Try-In approval/finalization, not final doctor receivable | Void candidate |
| `11247e0e-e226-449e-954f-9dff999dabdb` | 1019-260505-598 | احمد حمدى | 725.00 | `37b013ac-ef04-469f-988a-583db46bd09a` | Under Design | 2026-05-09 | 0 | Order moved back to design workflow | Void candidate |
| `a2a6a542-0cbf-4801-a17b-a6dc28ba8d60` | 1033-260507-510 | الشامي | 3,200.00 | `10bdc836-d28e-4f20-be7f-47d833825f49` | Try In | 2026-05-10 | 0 | Order is Try-In, not final delivered receivable | Void candidate |
| `91bd642c-8bc7-4a93-aeb2-4b423a084c19` | 1031-260427-504 | احمد وجدي | 8,700.00 | `c133d7f5-85b6-4979-8893-75731aabb585` | Waiting Dr Approval | 2026-05-10 | 0 | Waiting doctor approval, not final receivable | Void candidate |
| `3bee6d3b-d906-45c8-866b-4dde35d638b6` | 1019-260509-653 | ابراهيم ابو ليلة | 725.00 | `934e66ca-6e2a-42c7-8cb0-022f629531d7` | Under Production | 2026-05-13 | 0 | Order moved back to production | Void candidate |
| `a659d0cf-582b-4f64-b43e-66d8507134a4` | 1019-260509-657 | ابراهيم ابو ليلة | 725.00 | `2d5fb113-4191-46b8-9ecc-c9d50be219a7` | Under Production | 2026-05-13 | 0 | Order moved back to production | Void candidate |
| `f84d605e-92f4-4977-898b-580d1137692f` | 1019-260509-655 | ابراهيم ابو ليلة | 1,625.00 | `17284824-e8dd-4449-b2d3-032323ae8e81` | Rejected | 2026-05-13 | 0 | Rejected case should not keep normal doctor receivable | Void candidate |
| `f7a4f80e-24f1-4d1a-b351-22b81272dd72` | 1019-260511-659 | محمد سالم | 1,450.00 | `f614d9f6-b1b7-4ebc-81bd-c8596d69282f` | Under Production | 2026-05-15 | 0 | Order moved back to production | Void candidate |

Exact IDs safe to propose for a future targeted void preview:

```text
6f7dff6e-5ef2-4784-898d-e8afaabc158a
bea42b39-7085-43c0-a6e6-d0fbd2a3c516
7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c
c2c2664f-49ae-4614-96ca-f48a2a33f523
11247e0e-e226-449e-954f-9dff999dabdb
a2a6a542-0cbf-4801-a17b-a6dc28ba8d60
91bd642c-8bc7-4a93-aeb2-4b423a084c19
3bee6d3b-d906-45c8-866b-4dde35d638b6
a659d0cf-582b-4f64-b43e-66d8507134a4
f84d605e-92f4-4977-898b-580d1137692f
f7a4f80e-24f1-4d1a-b351-22b81272dd72
```

## C) Supplier Issue / Non-Final Normal Payables

These are normal `external_lab_ready` payables on orders that are no longer normal final-ready/final-delivered workflow items. They should not receive automatic FIFO supplier allocation.

| Obligation ID | Case ID | Supplier | Amount | Current order status | Issue/rejection context | Issue settlement exists for same order | Resolution |
|---|---|---|---:|---|---|---|---|
| `c99dbae6-db37-4a32-afb2-dda899c97341` | 1003-1004-1515 | AB Lab | 1,500.00 | Try In | Normal payable exists while order is Try-In | No | Void normal payable candidate / investigate |
| `483dde11-7f0f-4ae7-b0c1-9aba10b9dba6` | 1033-260507-510 | AB Lab | 2,000.00 | Try In | Normal payable exists while order is Try-In | No | Void normal payable candidate / investigate |
| `0d002fac-332f-43e6-8a29-a2ef357ddb67` | 1019-260509-655 | AB Lab | 1,140.00 | Rejected | Normal payable exists on rejected case; rejectedLabCost not set | No | Void normal payable candidate / business decision if lab amount is owed |
| `15ce5e59-3183-44aa-97dd-9ca88a2ac989` | 2021-260503-501 | AB Lab | 900.00 | Rejected | Normal payable exists on rejected case; rejectedLabCost exists as 500 | No active issue settlement found in current report | Void normal payable candidate; create/verify issue settlement later if approved |

Exact IDs to keep excluded from allocation:

```text
c99dbae6-db37-4a32-afb2-dda899c97341
483dde11-7f0f-4ae7-b0c1-9aba10b9dba6
0d002fac-332f-43e6-8a29-a2ef357ddb67
15ce5e59-3183-44aa-97dd-9ca88a2ac989
```

## D) Issue Settlement Obligations

All seven issue settlement obligations match `rejected_lab_cost`, have zero payment allocations, and are unpaid shadow records. They should be kept excluded from clean FIFO until the issue-settlement workflow is approved.

| Obligation ID | Case ID | Supplier | Amount | Order status | rejected_lab_cost | Matches official rejected cost | Payment allocations | Resolution |
|---|---|---|---:|---|---:|---|---:|---|
| `6df860c3-8fb9-4597-9eec-88aaadf2ffb6` | CASE-1771119936390-8 | AB Lab | 550.00 | Rejected | 550.00 | Yes | 0 | Keep as settlement candidate |
| `ce24fd54-a8ab-4dea-ae9a-55a0ee71ceb3` | CASE-1771119936390-14 | AB Lab | 1,500.00 | Rejected | 1,500.00 | Yes | 0 | Keep as settlement candidate |
| `147f7286-a74d-4b2c-a08c-d871ec233844` | 1001-140226-001 | AB Lab | 500.00 | Rejected | 500.00 | Yes | 0 | Keep as settlement candidate |
| `41778378-223e-4a80-914b-8de140e74279` | 1001-140226-002 | AB Lab | 250.00 | Rejected | 250.00 | Yes | 0 | Keep as settlement candidate |
| `fc566db2-9c1d-4d7d-a73c-d72aa37cae9b` | 1034-1204-1641 | AB Lab | 425.00 | Rejected | 425.00 | Yes | 0 | Keep as settlement candidate |
| `a4d22eed-f5d2-409d-ac10-b218b29f0209` | 1034-2104-1346 | Allstars | 320.00 | Rejected | 320.00 | Yes | 0 | Keep as settlement candidate |
| `21b41755-a218-42d0-bdf6-977e47834efd` | 1034-2304-1406 | Dr.M Lab | 1,200.00 | Rejected | 1,200.00 | Yes | 0 | Keep as settlement candidate |

Exact IDs to keep excluded until issue workflow approval:

```text
6df860c3-8fb9-4597-9eec-88aaadf2ffb6
ce24fd54-a8ab-4dea-ae9a-55a0ee71ceb3
147f7286-a74d-4b2c-a08c-d871ec233844
41778378-223e-4a80-914b-8de140e74279
fc566db2-9c1d-4d7d-a73c-d72aa37cae9b
a4d22eed-f5d2-409d-ac10-b218b29f0209
21b41755-a218-42d0-bdf6-977e47834efd
```

## E) Doctor Credit Candidates

These should not be solved with writes in this phase. The clean future allocation can apply payment only up to open obligations. Any excess should wait for account credit support.

| Doctor | Transaction ID | Transaction amount | Excess/credit candidate | Current classification | Resolution |
|---|---|---:|---:|---|---|
| محمد احمد حسن | `1ba0fe43-95bc-44ca-bf56-cd7ab78a3682` | 1,100.00 | 350.00 | Valid credit candidate | Credit workflow later |
| ابو صالح | `370d9752-9387-43a2-a21b-27888f526fad` | 3,070.00 | 520.00 | Valid credit candidate | Credit workflow later |
| عليا الديري | `7a15d742-d3c8-484d-a23c-d0baf8d2a6d0` | 6,900.00 | 150.00 | Valid credit candidate | Credit workflow later |
| احمد مازن | `58481494-2a74-423e-905e-86a9483f9295` | 900.00 | 225.00 | Valid credit candidate | Credit workflow later |
| محمد جلال | `cec1439f-913d-46f1-8ec2-644f17a0f2e1` | 880.00 | 200.00 | Valid credit candidate | Credit workflow later |
| بتول احمد | `2a3093c2-d6fa-4acd-8a65-004ff8c1e5cd` | 750.00 | 250.00 | Valid credit candidate | Credit workflow later |
| سالي | `fa18da1c-1a98-47cd-a1f0-597a955fad7c` | 3,000.00 | 1,000.00 | Valid credit candidate; official adjustment present | Needs account review before credit write |
| ايهم تركاوي | `a98e047c-08ef-4520-af42-f009db005a19` | 1,800.00 | 1,000.00 | Valid credit candidate | Credit workflow later |
| خالد قصر العيني | `ea3301dd-8fb2-411a-8ec8-82c1c7c51625` | 1,000.00 | 200.00 | Valid credit candidate | Credit workflow later |
| رسمى محمد | `ed9a8610-5cba-45ae-af01-121e3f6b8d34` | 1,200.00 | 1,200.00 | Payment with no open obligation in preview | Needs account review before credit write |
| سلمي صلاح | `3dbb296f-252d-4145-87bc-50587f439a5e` | 3,000.00 | 3,000.00 | Payment with no open obligation in preview | Needs account review before credit write |

Exact transaction IDs to exclude from any credit write until credit workflow approval:

```text
1ba0fe43-95bc-44ca-bf56-cd7ab78a3682
370d9752-9387-43a2-a21b-27888f526fad
7a15d742-d3c8-484d-a23c-d0baf8d2a6d0
58481494-2a74-423e-905e-86a9483f9295
cec1439f-913d-46f1-8ec2-644f17a0f2e1
2a3093c2-d6fa-4acd-8a65-004ff8c1e5cd
fa18da1c-1a98-47cd-a1f0-597a955fad7c
a98e047c-08ef-4520-af42-f009db005a19
ea3301dd-8fb2-411a-8ec8-82c1c7c51625
ed9a8610-5cba-45ae-af01-121e3f6b8d34
3dbb296f-252d-4145-87bc-50587f439a5e
```

## F) EZ Lab And Dr.M Lab

### EZ Lab

- Transaction: `d79feb70-a62f-487c-8573-4c487239b60a`
- Amount: 12,000.00
- Description: `تقفيل حساب EZ، دفع نص الفرق بينا وبينهم`
- Interpretation: true account closing/dispute settlement.
- Resolution: keep excluded from FIFO allocation. Handle later through settlement/manual adjustment workflow.

### Dr.M Lab

- Transaction: `22b40b85-4347-4483-b703-08bf37f2e1f9`
- Transaction amount: 11,000.00
- Preview overpayment/manual-review remainder: 800.00
- Related issue settlement obligation: `21b41755-a218-42d0-bdf6-977e47834efd` amount 1,200.00, matched to `rejected_lab_cost`.
- Interpretation: supplier overpayment/manual review, not an automatic credit.
- Resolution: keep the 800.00 excluded until supplier settlement/credit/refund rules are approved.

## G) Exact IDs Safe To Void Later

Safe means safe to include in a future **targeted void preview**, not safe to mutate now.

Doctor stale receivable void candidates:

```text
6f7dff6e-5ef2-4784-898d-e8afaabc158a
bea42b39-7085-43c0-a6e6-d0fbd2a3c516
7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c
c2c2664f-49ae-4614-96ca-f48a2a33f523
11247e0e-e226-449e-954f-9dff999dabdb
a2a6a542-0cbf-4801-a17b-a6dc28ba8d60
91bd642c-8bc7-4a93-aeb2-4b423a084c19
3bee6d3b-d906-45c8-866b-4dde35d638b6
a659d0cf-582b-4f64-b43e-66d8507134a4
f84d605e-92f4-4977-898b-580d1137692f
f7a4f80e-24f1-4d1a-b351-22b81272dd72
```

Supplier normal payable void candidates:

```text
c99dbae6-db37-4a32-afb2-dda899c97341
483dde11-7f0f-4ae7-b0c1-9aba10b9dba6
0d002fac-332f-43e6-8a29-a2ef357ddb67
15ce5e59-3183-44aa-97dd-9ca88a2ac989
```

## H) Exact IDs To Keep Excluded

Issue settlement obligations:

```text
6df860c3-8fb9-4597-9eec-88aaadf2ffb6
ce24fd54-a8ab-4dea-ae9a-55a0ee71ceb3
147f7286-a74d-4b2c-a08c-d871ec233844
41778378-223e-4a80-914b-8de140e74279
fc566db2-9c1d-4d7d-a73c-d72aa37cae9b
a4d22eed-f5d2-409d-ac10-b218b29f0209
21b41755-a218-42d0-bdf6-977e47834efd
```

Settlement/overpayment transactions:

```text
d79feb70-a62f-487c-8573-4c487239b60a
22b40b85-4347-4483-b703-08bf37f2e1f9
```

Doctor credit candidate excess transactions:

```text
1ba0fe43-95bc-44ca-bf56-cd7ab78a3682
370d9752-9387-43a2-a21b-27888f526fad
7a15d742-d3c8-484d-a23c-d0baf8d2a6d0
58481494-2a74-423e-905e-86a9483f9295
cec1439f-913d-46f1-8ec2-644f17a0f2e1
2a3093c2-d6fa-4acd-8a65-004ff8c1e5cd
fa18da1c-1a98-47cd-a1f0-597a955fad7c
a98e047c-08ef-4520-af42-f009db005a19
ea3301dd-8fb2-411a-8ec8-82c1c7c51625
ed9a8610-5cba-45ae-af01-121e3f6b8d34
3dbb296f-252d-4145-87bc-50587f439a5e
```

## I) Exact IDs Safe To Allocate Later

No manual/high-risk item in this plan is directly safe to allocate as-is.

Safe-to-allocate-later refers only to the clean FIFO subset from `historical-allocation-preview.csv` after excluding:
- all IDs in Sections G and H
- any future rows that become newly flagged before the write phase

A clean-subset preview must be regenerated before any write phase.

## J) Items Requiring Business Decision

- Whether to void the 11 stale doctor receivables in one targeted cleanup batch.
- Whether to void the 4 supplier normal payables on issue/non-final orders.
- Whether the 7 issue settlement obligations should become payable allocation targets, remain review-only, or be handled by a separate settlement workflow.
- How to handle EZ Lab account-closing/dispute transaction.
- How to handle Dr.M Lab supplier overpayment remainder.
- Whether to create doctor account credits for the 11 credit candidates after credit workflow exists.

## K) Items Requiring More Investigation

- `15ce5e59-3183-44aa-97dd-9ca88a2ac989` / case `2021-260503-501`: normal payable 900 on rejected order, while `rejected_lab_cost = 500`; investigate whether an issue settlement obligation should exist and whether normal payable should be voided.
- `ed9a8610-5cba-45ae-af01-121e3f6b8d34` / رسمى محمد: full payment appears as credit candidate; verify if there is a missing obligation or true prepayment.
- `3dbb296f-252d-4145-87bc-50587f439a5e` / سلمي صلاح: full payment appears as credit candidate; verify if there is a missing obligation or true prepayment.
- Any pending transaction status should be reviewed before it becomes part of official allocation writes.

## L) Go / No-Go Recommendation

Do **not** proceed to a broad allocation write phase before resolving or explicitly excluding the manual/high-risk items.

Can a clean allocation write proceed before resolving all of these?

Yes, but only if all of the following are true:

1. A clean-subset preview is regenerated with explicit exclusion IDs from this report.
2. The write service hard-blocks excluded obligation IDs and excluded transaction IDs.
3. Doctor overpayment excess is not written as credit yet.
4. Supplier overpayment/settlement items are not written as allocation or credit.
5. Issue settlement obligations remain excluded until the settlement workflow is approved.
6. Stale/issue normal obligations are either voided in a separate approved cleanup or excluded from allocation.

Recommended immediate next step:

1. Run a read-only stale/issue cleanup preview for the 15 void candidates.
2. Review and approve targeted void cleanup separately.
3. Rerun reconciliation and manual review analysis.
4. Only then design the clean-subset allocation write preview.
