# Representative edit approval: edited case delivery

Acceptance: an undelivered remake is editable directly; its parent's delivery,
legacy display status and planned date do not require approval. Once the edited
case has been delivered, representative/coordinator edits require admin approval,
including after a return. Existing role, field and issue guards remain in place.

Implementation: the locked `v_old` row is passed to
`order_edit_requires_admin_approval`; no parent lookup occurs. The UI mirrors
that predicate. No existing orders or pending proposals are modified.

Validation:
- RED: four new unit tests failed before the predicate was implemented.
- GREEN: 56 tests passed across the new suite, lifecycle helpers, workflow
  retirement and issue actions. `tsc -b` passed. Production-file ESLint passed.
- Seven pgTAP assertions cover the database predicate and RPC wiring. Not run:
  the local Docker engine is unavailable. Migration has not been deployed.
- Git checkpoints were not created in the pre-existing modified worktree.

Run database validation with:
`supabase test db supabase/tests/database/rep_edit_own_delivery.test.sql --local`

Self-evaluation: accuracy 4/5 (SQL execution remains unverified); completeness
4/5 (deployment and database tests pending); clarity 4/5 (delivery evidence is
explicit); actionability 4/5 (migration and runnable SQL tests supplied);
conciseness 4/5 (report includes verification limits). Overall 4.0/5.
Highest priority: run pgTAP on a migrated local database, then deploy the migration
and verify the reported case. The production incident's exact cause is still
unconfirmed; this change makes the intended approval contract explicit.
