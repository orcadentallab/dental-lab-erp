# Accounting re-registration legacy cleanup preview

Generated from a read-only production query on 2026-07-31. No production rows were changed.

Execution note: the first guarded cleanup restored 66 archived rows. A second guard showed that the remaining 7 reviewed rows carried the same backfill timestamp but were non-archived. A corrective migration therefore targets those exact seven UUIDs so cleanup follows the general accounting rule and does not depend on operational archive state. Financial columns remain unchanged.

## Proposed change

- Restore `is_registered = true` and clear `needs_accounting_reregistration` for the 73 legacy rows below.
- All rows were unregistered with the identical `updated_at` value `2026-07-30T18:39:03.882929+00:00`, created by the blanket backfill migration. Of these, 66 were archived and 7 were non-archived.
- Financial columns changed: **none**. Exact financial change: **EGP 0.00**.
- Stored amounts below are a preservation check; they remain unchanged.

## Totals preserved

| Rows | Stored sale price | Discount | Effective lab cost | Rejected lab cost | Effective design price | Rejected designer cost |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 73 | 190,000 | 150 | 107,230 | 21,410 | 2,400 | 0 |

| Status | Rows | Stored sale price | Discount | Effective lab cost | Rejected lab cost | Effective design price |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cancelled | 18 | 46,625 | 0 | 27,230 | 0 | 0 |
| Doctor Rejected | 53 | 136,725 | 150 | 75,760 | 21,410 | 2,100 |
| Lab Rejected | 2 | 6,650 | 0 | 4,240 | 0 | 300 |

## Exact records

Amounts are EGP. `Effective lab` is `COALESCE(manual_cost, cost, 0)` and `Effective design` is `COALESCE(manual_design_price, design_price, 0)`.

| # | Case ID | Order UUID | Status | Sale | Discount | Effective lab | Rejected lab | Effective design |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 6009-260717-502 | b4f4ba4e-cc54-4260-84dd-d70a9f7782ad | Lab Rejected | 5700 | 0 | 3600 | 0 | 300 |
| 2 | 1037-260715-509 | 6468e77a-f222-409e-9afd-c8ce024315d2 | Doctor Rejected | 400 | 0 | 0 | 0 | 0 |
| 3 | 1049-260715-508 | d9221659-7177-49c8-8b13-c23f119e6dcc | Doctor Rejected | 750 | 0 | 450 | 0 | 50 |
| 4 | 1049-260707-503 | 23707af0-190a-4890-b7b7-6f23c81515a5 | Doctor Rejected | 750 | 0 | 450 | 0 | 50 |
| 5 | 3006-260706-517 | c18bdb1b-567e-4d1d-a4bb-6a907e953502 | Doctor Rejected | 9000 | 0 | 4320 | 2100 | 450 |
| 6 | 1049-260623-501 | 1f3ede2f-6c4e-408a-9442-e31fa9d4e788 | Doctor Rejected | 7600 | 0 | 5440 | 0 | 400 |
| 7 | 3006-260620-514 | 9bc2eb13-8f0a-4758-ac93-413a49d20afd | Doctor Rejected | 1000 | 0 | 0 | 0 | 0 |
| 8 | 3006-260620-513 | 42b923e5-286e-4b9d-a2d9-8690a63d419c | Doctor Rejected | 100 | 0 | 0 | 0 | 0 |
| 9 | 1033-260615-531 | eb38ed1a-7f94-4b6d-b2d3-50971f355d30 | Doctor Rejected | 1500 | 0 | 960 | 480 | 100 |
| 10 | 3006-260615-510 | e40bb1b2-4317-4e1c-a8a7-d00f010236d4 | Doctor Rejected | 600 | 0 | 0 | 0 | 0 |
| 11 | 3006-260615-511 | f9b8686e-1ccc-49a2-be12-b52ec3749a3a | Doctor Rejected | 10700 | 0 | 4910 | 1680 | 350 |
| 12 | 3006-260613-507 | 2e8e63e1-77c2-4fb7-9a3f-7761b6be1ced | Doctor Rejected | 3800 | 0 | 1920 | 1400 | 200 |
| 13 | 6008-260606-501 | 0c118dee-4c88-4f20-b636-fdd5d7ea814a | Doctor Rejected | 1750 | 0 | 1000 | 500 | 0 |
| 14 | 2016-260525-513 | 33303af6-6c3a-4ed2-9b5a-987dcf3064d7 | Doctor Rejected | 1500 | 0 | 1000 | 480 | 0 |
| 15 | 2023-260521-501 | f889fe49-2c9e-4b01-8019-57a6779e6b61 | Doctor Rejected | 2000 | 0 | 1420 | 850 | 100 |
| 16 | 6007-260519-501 | 1cbf492a-a025-41e5-9a7c-496e48559228 | Cancelled | 9500 | 0 | 6400 | 0 | 0 |
| 17 | 1033-260519-516 | 30f62799-b68d-4564-8b36-47dd46915a31 | Cancelled | 750 | 0 | 500 | 0 | 0 |
| 18 | 2004-260517-574 | b5786e4a-bdc2-40ca-a82d-84b353bee3cf | Doctor Rejected | 450 | 0 | 280 | 0 | 0 |
| 19 | 3009-260516-502 | 7d7f8b93-29ba-4de8-b810-85920b81850a | Cancelled | 3000 | 0 | 2000 | 0 | 0 |
| 20 | 3008-260514-501 | b5453580-3175-4ce1-a2f2-f8bca1c2065e | Cancelled | 3000 | 0 | 2000 | 0 | 0 |
| 21 | 1001-260511-522 | cec8c9a6-c53c-40e7-9ebe-18f1fbfb7cd5 | Cancelled | 750 | 0 | 500 | 0 | 0 |
| 22 | 1001-260511-521 | ff556344-bc54-4ab1-948f-beaeba24c0d0 | Cancelled | 750 | 0 | 500 | 0 | 0 |
| 23 | 1001-260511-520 | 84d48eb2-6607-4e09-85ba-117be1fcac87 | Lab Rejected | 950 | 0 | 640 | 0 | 0 |
| 24 | 1027-260510-506 | c6b60ae3-7b6f-4d6a-8c70-8742199497c1 | Cancelled | 600 | 0 | 100 | 0 | 0 |
| 25 | 1019-260509-655 | 17284824-e8dd-4449-b2d3-032323ae8e81 | Doctor Rejected | 1625 | 0 | 1350 | 675 | 100 |
| 26 | 5021-260509-520 | 64bf93e3-bb2b-4d51-97e7-349fd1e33304 | Doctor Rejected | 1500 | 0 | 1000 | 500 | 0 |
| 27 | 1503-260507-511 | 4f0f9156-ac82-4c3b-a785-2e501dd2f71d | Cancelled | 12000 | 0 | 3950 | 0 | 0 |
| 28 | 2022-260506-502 | 77e3f425-61ee-4c39-aa6f-fbb9d97276dd | Cancelled | 1500 | 0 | 900 | 0 | 0 |
| 29 | 2022-260506-501 | 1aaeaea6-282f-4c59-af94-f855836a2419 | Cancelled | 750 | 0 | 450 | 0 | 0 |
| 30 | 5021-260506-518 | a40950b3-5c26-48d2-b262-4ed12f8379a3 | Doctor Rejected | 2250 | 0 | 1500 | 750 | 0 |
| 31 | 1019-260506-600 | 876af125-d8ca-4e68-9294-ca58cff992c5 | Doctor Rejected | 1450 | 0 | 900 | 500 | 0 |
| 32 | 2021-260503-501 | fa0bb85d-623d-4bdd-9375-a5f84a49bcdc | Doctor Rejected | 1500 | 0 | 900 | 500 | 0 |
| 33 | 5021-260428-517 | 9c5bb148-b323-454c-9079-c3b021529ed7 | Doctor Rejected | 1500 | 0 | 1000 | 0 | 0 |
| 34 | 1031-260427-504 | c133d7f5-85b6-4979-8893-75731aabb585 | Doctor Rejected | 8700 | 0 | 5100 | 2550 | 300 |
| 35 | 5021-260427-516 | ff09cbee-6c5a-4f69-bbd6-a7394b07d06e | Doctor Rejected | 7500 | 0 | 5000 | 0 | 0 |
| 36 | 1034-2304-1406 | 4fd293f2-b50b-4c6b-9d15-d99cb0a9f6d1 | Doctor Rejected | 1150 | 150 | 1200 | 1200 | 0 |
| 37 | 1038-2104-2132 | 86cfe8f7-2999-47c6-8fa5-40c609bf8beb | Cancelled | 750 | 0 | 450 | 0 | 0 |
| 38 | 1034-2104-1346 | e57743a0-53b8-4c90-90bc-4ff0d7d82fe4 | Doctor Rejected | 950 | 0 | 640 | 320 | 0 |
| 39 | 1008-1904-1529 | 19ff94e4-b9c4-43c3-97fe-55382b2b2db6 | Cancelled | 7400 | 0 | 5520 | 0 | 0 |
| 40 | 1014-1804-1246 | 3574bca8-dc9c-4fa6-b8de-97d9408fefdc | Doctor Rejected | 1350 | 0 | 420 | 420 | 0 |
| 41 | 1019-1504-2124 | 3ce27378-c947-4988-adb0-a542126cb79b | Cancelled | 725 | 0 | 500 | 0 | 0 |
| 42 | 1034-1204-1641 | ff89a169-f6f6-4925-8992-779813f7712d | Doctor Rejected | 1400 | 0 | 850 | 425 | 0 |
| 43 | 1003-1004-1515 | 32e6f4f1-d5d4-40f7-830a-db5c1fbeba9d | Doctor Rejected | 2250 | 0 | 1500 | 0 | 0 |
| 44 | 3003-1004-1238 | e5b19f26-36b4-4ddf-be33-7958bf9e60a1 | Cancelled | 600 | 0 | 300 | 0 | 0 |
| 45 | 1020-3103-1435 | 27c27f0a-5841-4fe4-bba7-70ad401c2934 | Cancelled | 950 | 0 | 650 | 0 | 0 |
| 46 | 1003-1503-1542 | 12aaa23b-6306-4594-b7f3-3608d0751f11 | Doctor Rejected | 1850 | 0 | 1380 | 0 | 0 |
| 47 | 6005-0903-2016 | 1450ef0e-af0d-4f9c-9f6e-4ce39442908e | Doctor Rejected | 2800 | 0 | 1930 | 0 | 0 |
| 48 | 2005-2802-2245 | 69be3e5b-d831-4830-bfbf-e32aa66deb8b | Doctor Rejected | 750 | 0 | 500 | 250 | 0 |
| 49 | 5018-2502-2150 | c2fe4a20-f5e4-40ec-b603-d6a4015ca742 | Doctor Rejected | 2000 | 0 | 1330 | 1330 | 0 |
| 50 | 1017-170226-001 | 0239961f-9b5f-4086-a3e8-85291436307b | Doctor Rejected | 4500 | 0 | 3000 | 0 | 0 |
| 51 | CASE-1771119936390-7 | 39e33ed2-7418-4da4-b03f-3e722941520d | Doctor Rejected | 600 | 0 | 300 | 0 | 0 |
| 52 | CASE-1771119936390-13 | 58f5cf31-f090-4328-a04c-9ae7eed9b65a | Cancelled | 600 | 0 | 350 | 0 | 0 |
| 53 | CASE-1771119936390-14 | 90801eff-9caa-4d26-8f30-161d824f1702 | Doctor Rejected | 4500 | 0 | 3000 | 1500 | 0 |
| 54 | CASE-1771119936390-8 | b5a8a1a4-9a09-4448-b233-bd877a5f12eb | Doctor Rejected | 4500 | 0 | 3000 | 550 | 0 |
| 55 | CASE-1771119936390-11 | e80146bb-746a-49e4-9101-4a58e4f5a4c3 | Cancelled | 2000 | 0 | 1480 | 0 | 0 |
| 56 | 1001-140226-002 | 743d49a2-28fe-406d-8a04-ecaf2bd469c9 | Doctor Rejected | 750 | 0 | 500 | 250 | 0 |
| 57 | 1001-140226-001 | d3da7b11-13a7-472d-9991-104fe0bca675 | Doctor Rejected | 1500 | 0 | 1000 | 500 | 0 |
| 58 | 3002-080226-001 | 453ec4e9-1bfd-4768-9fa6-5dbb9dd77d92 | Cancelled | 1000 | 0 | 680 | 0 | 0 |
| 59 | CASE-1770402907833-29 | 23f334c2-391f-4cee-b341-eff419f8f2f2 | Doctor Rejected | 750 | 0 | 500 | 0 | 0 |
| 60 | CASE-1770402907833-18 | 54c23d47-3140-4438-9f5b-99634b90fde1 | Doctor Rejected | 2000 | 0 | 1480 | 0 | 0 |
| 61 | CASE-1770402907832-15 | 7a9706e9-5911-4d0c-afd6-5c01e02df53e | Doctor Rejected | 1500 | 0 | 900 | 0 | 0 |
| 62 | CASE-1770402907832-16 | 9e4ed766-10f1-4fb5-9616-d214b7a327ce | Doctor Rejected | 6900 | 0 | 5040 | 0 | 0 |
| 63 | CASE-1769820310811-86 | 3130bb04-9fe4-4204-b7f3-f8ac609d1dc2 | Doctor Rejected | 3000 | 0 | 0 | 0 | 0 |
| 64 | CASE-1769820310811-64 | 4cb1b417-98e3-4a18-81a8-e7f0cdab6e85 | Doctor Rejected | 600 | 0 | 350 | 350 | 0 |
| 65 | CASE-1769820310811-63 | 7e8fb90c-9679-48f1-afd0-e735612f234e | Doctor Rejected | 600 | 0 | 350 | 350 | 0 |
| 66 | CASE-1769820310811-74 | 92b00ffa-dc33-4126-966a-6b5e3cc8ae60 | Doctor Rejected | 900 | 0 | 650 | 0 | 0 |
| 67 | CASE-1769820310811-84 | aa2762f9-c6b5-48cd-951e-2dba76a366be | Doctor Rejected | 6900 | 0 | 5040 | 0 | 0 |
| 68 | CASE-1769820310810-32 | f33ecb06-5a0c-4078-90b8-1637c0040b13 | Doctor Rejected | 3000 | 0 | 2000 | 1000 | 0 |
| 69 | CASE-1768129706976-105 | 549d1d9c-88bd-4b6f-aa9c-3c9c2a191316 | Doctor Rejected | 3400 | 0 | 0 | 0 | 0 |
| 70 | CASE-1768129706977-162 | 7d04c187-70d9-404e-8312-2c0af286a891 | Doctor Rejected | 450 | 0 | 0 | 0 | 0 |
| 71 | CASE-1768129706976-97 | b86fab61-ca12-4f1b-9501-947d883e0a92 | Doctor Rejected | 3800 | 0 | 0 | 0 | 0 |
| 72 | CASE-1768129706977-163 | e5c5ad92-644a-4b9e-9988-7b50d5193b99 | Doctor Rejected | 350 | 0 | 0 | 0 | 0 |
| 73 | CASE-1768129706975-2 | f1b8162c-60f4-4533-ac2b-653c36bf654e | Doctor Rejected | 3800 | 0 | 0 | 0 | 0 |
