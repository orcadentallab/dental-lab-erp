# Dashboard rejected-cases breakdown — TDD evidence

## Source and user journey

No plan file was used. The journey was derived from the dashboard request: as a staff user, I can see within the returned-cases card how many orders are doctor rejections and how many are production redos, without changing the combined list opened by the card.

## RED / GREEN evidence

| Guarantee | Test | Result | Evidence |
|---|---|---|---|
| `doctor_rejected` and `redo` orders are counted separately and totalled together | `tests/unit/dashboard-order-groups-v2.test.ts` | PASS | RED: helper missing; GREEN: targeted run passed 7/7 |
| The dashboard card receives both Arabic labels and the breakdown | `tests/unit/dashboard-order-groups-v2.test.ts` | PASS | RED: labels/prop missing; GREEN: targeted run passed 7/7 |
| Existing unit behavior remains intact | `npm run test:unit` | PASS | 48 files, 465 tests passed |
| Types and production bundle remain valid | `npm run typecheck`; `npm run build` | PASS | Both commands completed successfully |

## Coverage and gaps

The repository has no configured coverage script or coverage provider. The focused unit tests, full unit suite, typecheck, and production build were run. Browser E2E was not needed because the change is a passive count display and does not alter navigation or workflow actions.

## Merge evidence

No checkpoint commits were created because the working tree already contains unrelated user changes. The RED and GREEN outcomes are preserved above without staging or committing those files.
