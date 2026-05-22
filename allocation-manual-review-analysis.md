# Allocation Manual Review Analysis

Generated from:
- `historical-allocation-preview.md`
- `historical-allocation-preview.csv`

Scope: read-only analysis only. No allocations, credits, transactions, obligations, migrations, WF-2 work, or official finance logic were changed.

## A) Manual Review Summary

- Total manual review items: **20**
- Total amount involved: **25,640.00**
- Entities involved:
  - External labs: **AB Lab**, **Allstars**, **Dr.M Lab**, **EZ Lab**
  - Doctors: **محمد احمد حسن**, **ابو صالح**, **عليا الديري**, **احمد مازن**, **محمد جلال**, **بتول احمد**, **سالي**, **ايهم تركاوي**, **خالد قصر العيني**, **رسمى محمد**, **سلمي صلاح**

Reason categories:

| Category | Count | Amount | Decision bucket |
|---|---:|---:|---|
| Issue settlement obligations | 7 | 4,745.00 | Issue settlement - manual handling |
| Doctor overpayment / credit candidates | 11 | 8,095.00 | Credit/overpayment candidate |
| Supplier settlement/dispute payment | 1 | 12,000.00 | Settlement/dispute - exclude from auto-allocation |
| Supplier overpayment/manual review | 1 | 800.00 | Needs business decision |

## B) High-Risk Exclusions Summary

- Total high-risk exclusions: **15**
- Total amount involved: **39,340.00**

Why excluded from FIFO:

| Category | Count | Amount | Reason |
|---|---:|---:|---|
| Stale doctor receivables | 11 | 33,800.00 | Order is currently non-billable/stale, so doctor receivable should not receive payment allocation yet. |
| Supplier obligations on issue/non-final orders | 4 | 5,540.00 | Normal supplier payable belongs to issue/non-final status and needs issue/settlement review instead of FIFO. |

## C) Item Classification

### Issue Settlement - Manual Handling

These are valid shadow issue-settlement candidates, but should not be mixed into normal FIFO until the issue settlement workflow is approved.

| Entity | Obligation | Case ID | Amount | Recommended action |
|---|---|---|---:|---|
| AB Lab | `6df860c3-8fb9-4597-9eec-88aaadf2ffb6` | CASE-1771119936390-8 | 550.00 | Require issue settlement business decision |
| AB Lab | `ce24fd54-a8ab-4dea-ae9a-55a0ee71ceb3` | CASE-1771119936390-14 | 1,500.00 | Require issue settlement business decision |
| AB Lab | `147f7286-a74d-4b2c-a08c-d871ec233844` | 1001-140226-001 | 500.00 | Require issue settlement business decision |
| AB Lab | `41778378-223e-4a80-914b-8de140e74279` | 1001-140226-002 | 250.00 | Require issue settlement business decision |
| AB Lab | `fc566db2-9c1d-4d7d-a73c-d72aa37cae9b` | 1034-1204-1641 | 425.00 | Require issue settlement business decision |
| Allstars | `a4d22eed-f5d2-409d-ac10-b218b29f0209` | 1034-2104-1346 | 320.00 | Require issue settlement business decision |
| Dr.M Lab | `21b41755-a218-42d0-bdf6-977e47834efd` | 1034-2304-1406 | 1,200.00 | Require issue settlement business decision |

### Credit / Overpayment Candidates

These should not block clean FIFO allocation, but the excess must not be written as ordinary allocation. It needs the future account credit phase.

| Doctor | Transaction | Credit candidate |
|---|---|---:|
| محمد احمد حسن | `1ba0fe43-95bc-44ca-bf56-cd7ab78a3682` | 350.00 |
| ابو صالح | `370d9752-9387-43a2-a21b-27888f526fad` | 520.00 |
| عليا الديري | `7a15d742-d3c8-484d-a23c-d0baf8d2a6d0` | 150.00 |
| احمد مازن | `58481494-2a74-423e-905e-86a9483f9295` | 225.00 |
| محمد جلال | `cec1439f-913d-46f1-8ec2-644f17a0f2e1` | 200.00 |
| بتول احمد | `2a3093c2-d6fa-4acd-8a65-004ff8c1e5cd` | 250.00 |
| سالي | `fa18da1c-1a98-47cd-a1f0-597a955fad7c` | 1,000.00 |
| ايهم تركاوي | `a98e047c-08ef-4520-af42-f009db005a19` | 1,000.00 |
| خالد قصر العيني | `ea3301dd-8fb2-411a-8ec8-82c1c7c51625` | 200.00 |
| رسمى محمد | `ed9a8610-5cba-45ae-af01-121e3f6b8d34` | 1,200.00 |
| سلمي صلاح | `3dbb296f-252d-4145-87bc-50587f439a5e` | 3,000.00 |

### Settlement/Dispute - Exclude from Auto-Allocation

| Entity | Transaction | Amount | Recommended action |
|---|---|---:|---|
| EZ Lab | `d79feb70-a62f-487c-8573-4c487239b60a` | 12,000.00 | Exclude from FIFO and handle through settlement/dispute workflow |

### Supplier Overpayment - Needs Business Decision

| Entity | Transaction | Amount | Recommended action |
|---|---|---:|---|
| Dr.M Lab | `22b40b85-4347-4483-b703-08bf37f2e1f9` | 800.00 | Do not create supplier credit automatically; require admin decision |

### Stale Obligation - Do Not Allocate Yet

| Entity | Obligation | Case ID | Amount | Recommended action |
|---|---|---|---:|---|
| دنتال جاليري | `6f7dff6e-5ef2-4784-898d-e8afaabc158a` | 1014-2603-1915 | 1,200.00 | Require obligation correction/void review first |
| دنتال جاليري | `bea42b39-7085-43c0-a6e6-d0fbd2a3c516` | 1014-2603-1914 | 1,200.00 | Require obligation correction/void review first |
| حاتم الدسوقى | `7470c5b1-f4da-4e77-ac1d-b2c8e144ae2c` | 1003-1004-1515 | 2,250.00 | Require obligation correction/void review first |
| اسلام منير | `c2c2664f-49ae-4614-96ca-f48a2a33f523` | 1037-260427-502 | 12,000.00 | Require obligation correction/void review first |
| سمارت دنتل سنتر - د حازم البلتاجى | `11247e0e-e226-449e-954f-9dff999dabdb` | 1019-260505-598 | 725.00 | Require obligation correction/void review first |
| الشامي | `a2a6a542-0cbf-4801-a17b-a6dc28ba8d60` | 1033-260507-510 | 3,200.00 | Require obligation correction/void review first |
| احمد وجدي | `91bd642c-8bc7-4a93-aeb2-4b423a084c19` | 1031-260427-504 | 8,700.00 | Require obligation correction/void review first |
| سمارت دنتل سنتر - د حازم البلتاجى | `3bee6d3b-d906-45c8-866b-4dde35d638b6` | 1019-260509-653 | 725.00 | Require obligation correction/void review first |
| سمارت دنتل سنتر - د حازم البلتاجى | `a659d0cf-582b-4f64-b43e-66d8507134a4` | 1019-260509-657 | 725.00 | Require obligation correction/void review first |
| سمارت دنتل سنتر - د حازم البلتاجى | `f84d605e-92f4-4977-898b-580d1137692f` | 1019-260509-655 | 1,625.00 | Require obligation correction/void review first |
| سمارت دنتل سنتر - د حازم البلتاجى | `f7a4f80e-24f1-4d1a-b351-22b81272dd72` | 1019-260511-659 | 1,450.00 | Require obligation correction/void review first |

### Data Mismatch / Issue Workflow - Investigate Before Allocation

| Entity | Obligation | Case ID | Amount | Recommended action |
|---|---|---|---:|---|
| AB Lab | `c99dbae6-db37-4a32-afb2-dda899c97341` | 1003-1004-1515 | 1,500.00 | Review whether normal payable should be voided/replaced by issue settlement |
| AB Lab | `483dde11-7f0f-4ae7-b0c1-9aba10b9dba6` | 1033-260507-510 | 2,000.00 | Review whether normal payable should be voided/replaced by issue settlement |
| AB Lab | `0d002fac-332f-43e6-8a29-a2ef357ddb67` | 1019-260509-655 | 1,140.00 | Review whether normal payable should be voided/replaced by issue settlement |
| AB Lab | `15ce5e59-3183-44aa-97dd-9ca88a2ac989` | 2021-260503-501 | 900.00 | Review whether normal payable should be voided/replaced by issue settlement |

## D) Entity-Level Focus

### EZ Lab

- Difference source: account-closing/dispute payment candidate.
- Manual review amount: **12,000.00**
- Recommendation: **exclude permanently from auto-allocation** unless an admin explicitly converts it into a settlement/adjustment record later.

### AB Lab

- Issue settlement obligations: **5 rows / 3,225.00**
- High-risk normal payable exclusions: **4 rows / 5,540.00**
- Recommendation: do not include AB Lab issue-related items in clean FIFO. First decide which normal payables should be voided and which issue settlements are valid payable amounts.

### Dr.M Lab

- Issue settlement obligation: **1,200.00**
- Supplier payment overage/manual review: **800.00**
- Recommendation: handle through issue settlement and supplier overpayment review. Do not create supplier credit automatically.

### Allstars

- Issue settlement obligation: **320.00**
- Entity-level report still shows ordinary remaining unpaid of **43,557.00**, but only the issue settlement item is manual-review blocked.
- Recommendation: clean normal Allstars allocations can proceed later, excluding the issue settlement item until approved.

### Doctors With Credit Candidates

- Total doctor credit candidates: **8,095.00**
- Recommendation: clean FIFO allocation can proceed later for the portion that matches obligations, but the excess should wait for account credit support.

### Doctors With Large Remaining Unpaid

Largest remaining unpaid items in the preview:

| Doctor | Remaining unpaid | Decision |
|---|---:|---|
| سمارت دنتل سنتر - د حازم البلتاجى | 62,300.00 | Needs review because stale obligations are present |
| دنتال جاليري | 18,650.00 | Needs review because stale obligations are present |
| احمد وجدي | 14,500.00 | Needs review because stale obligation is present |
| اسلام منير | 14,450.00 | Needs review because stale obligation is present |
| دنتاليا د احمد جمال | 13,700.00 | likely safe unpaid balance, no manual-risk flag in report |
| خالد العامري | 12,500.00 | official adjustment present; review before write |
| فتحي فوزي | 12,000.00 | difference present; investigate before write |
| محمد حمدى | 11,850.00 | likely safe unpaid balance, no manual-risk flag in report |

## E) Recommended Next Action Per Bucket

| Bucket | Action |
|---|---|
| Safe normal FIFO subset | Proceed to a future write preview for clean subset only, excluding all rows listed in this analysis. |
| Doctor credit candidates | Allocate only up to obligation balances later; create doctor credits only after credit workflow approval. |
| Supplier settlement/dispute | Exclude from FIFO. Use future settlement/manual adjustment workflow. |
| Issue settlement obligations | Keep manual until issue-settlement workflow is approved. |
| Stale doctor obligations | Do not allocate. Run targeted stale-obligation cleanup preview first. |
| Supplier issue/non-final normal payables | Do not allocate. Decide whether to void normal payable or convert/reconcile through issue settlement. |
| Data mismatch/difference rows | Investigate before any allocation write. |

## F) Final Go/No-Go Recommendation

Recommendation: **Go for an allocation write phase only for the clean subset, not for the full dataset.**

Clean subset estimate:

- Preview proposed allocation amount: **1,814,870.00**
- This amount already excludes the explicitly flagged high-risk obligations and the EZ Lab settlement transaction from proposed allocation.
- Treat **1,814,870.00** as the maximum clean allocation candidate before a final pre-write dry run.

Excluded/manual amount estimate:

- Manual review queue amount: **25,640.00**
- High-risk exclusions amount: **39,340.00**
- Combined decision-held amount: **64,980.00**

Exact exclusions before any write phase:

- EZ Lab transaction `d79feb70-a62f-487c-8573-4c487239b60a`
- Dr.M Lab transaction `22b40b85-4347-4483-b703-08bf37f2e1f9`
- All 7 issue settlement obligations listed in Section C
- All 11 stale doctor receivables listed in Section C
- All 4 supplier issue/non-final normal payables listed in Section C
- All 11 doctor credit excess amounts listed in Section C until account credits are implemented

Before any write phase, run one more read-only clean-subset preview that explicitly filters these exclusions and reports the exact rows that would be written.
