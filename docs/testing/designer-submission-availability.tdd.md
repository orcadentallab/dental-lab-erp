# Designer design-submission availability regression

Reported error: submit_order_design_v2 returned HTTP 400 with
`Order is not available for design submission`.

The RPC requires production_status=designing and issue_state=none. The designer
dashboard offered upload/update regardless of these states and did not catch
submission errors. The supplied log does not identify the affected order, so
its exact production/issue state is not confirmed.

Changes:
- Match the RPC state guard using V2 fields, with Arabic next-step messages.
- Check availability before opening the upload modal and refresh from the server
  again before submitting to account for cached state and concurrent edits.
- Catch failures, retain the typed link, and reset the loading state.
- Disable submit/cancel during a submission.
- Remove the redundant post-RPC technician-status update: the atomic design
  submission already sets technician_status=Pending.
- Keep workflow permissions and database guards unchanged.

Evidence:
- RED: new availability tests ran and failed 15/15 because the check was absent.
  Checkpoint: 0ee9d19, on codex/temporary-laptop-backup-20261030.
- GREEN: 49 unit files, 480/480 tests passed (15 new cases).
- TypeScript project build: passed.
- Vite production build: passed with existing chunk/import notices.
- ESLint for changed production files: no errors; test file excluded by repo config.

Limits:
- No live designer session or browser E2E was run; no E2E/coverage claim is made.
- No production data or database function was changed.
- Need the reported case number and first-design/revision context to confirm
  the specific incident. This source change has not been deployed.
