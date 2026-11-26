# Order Status V2 production review

Review date: 2026-10-21  
Environment: Supabase `main` / Production  
Mode: read-only

## Deployment verification

- Migration `20261019000000_derive_order_display_status_v2.sql` was the only
  migration pushed in this deployment.
- Supabase migration history records local and remote version
  `20261019000000` as applied.
- The thirteen older, unrelated Doctor Portal migrations remained unapplied.
- The migration creates a presentation-only function and performs no order or
  financial data updates.

## Production comparison

All 1,300 orders were compared between the legacy `orders.status` value and
`derive_order_display_status_v2(production_status, issue_state)`.

| Classification | Orders | Conclusion |
|---|---:|---|
| Exact match | 1,291 | No action required |
| Expected legacy redo encoding | 9 | No correction required |
| Unexpected mismatch | 0 | No correction required |
| Invalid or unknown axes | 0 | No correction required |

The nine expected differences all have `issue_state = 'redo'`, legacy
`status = 'Doctor Rejected'`, and derived status `Redo`. This is the known
legacy encoding that phase 2 intentionally separates.

## Redo evidence review

- Three redo orders have an explicit `remake_requested` event in
  `order_events`.
- The remaining six older orders have an explicit `issue_state` transition to
  `redo` in `order_history` (dated between 2026-07-14 and 2026-07-30).
- No redo row was left without either structured-event or raw-history evidence.

## Decision

No production correction is justified by this review. Rewriting the nine
legacy statuses would be counterproductive while the compatibility mirror and
legacy consumers still exist. They should remain classified as reviewed,
expected differences until the consumer migration is complete.

Re-runnable read-only evidence queries are stored in
`supabase/audits/order_status_v2_production_review.sql`.
