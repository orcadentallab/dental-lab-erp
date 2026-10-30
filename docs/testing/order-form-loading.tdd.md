# Order form reference data loading

Journey: opening a saved case keeps successfully fetched reference lists visible even when another list request fails. Incomplete initialization must not allow saving or recompute saved costs from missing catalogs.

Validation: `node node_modules/vitest/vitest.mjs run tests/unit/order-form-loading.test.ts`.

- RED: 1 failed, 1 passed; a rejected list request rejected the combined load (`Error: Unavailable`).
- GREEN: 2 passed; successful data survives and a failed request is distinct from an empty successful response.
- `node node_modules/typescript/bin/tsc -b`: passed.
- ESLint on changed production files: no errors.

The form now publishes successful lists, preserves the saved doctor ID, skips cost initialization after a failed request, displays an alert, and blocks submission while loading or after failure.

## Live diagnosis — 2026-10-30

Inspected the user's existing Edge session on `https://orcalab.vercel.app/orders`. Opening the edit modal reproduced missing doctor, service, representative, and supplier labels.

- Console: `Failed to fetch dynamically imported module: https://orcalab.vercel.app/assets/serviceFamilyService-CYW6TbeV.js`; the module response had MIME type `text/html`.
- Independent public HTTP GET confirmed status 200 with `Content-Type: text/html; charset=utf-8` and HTML content for that old asset URL.
- The running tab referenced `index-CU7ecnzr.js`, while the current document referenced `index-DRk4TZjH.js`. This confirms stale deployment assets, not a doctor database lookup failure.
- Hard reload retained the case URL and restored the saved doctor label, `Scanner Rent`, representative, and external lab. The fresh console contained no load errors. No case was submitted or modified.
- The saved designer name could still be absent from the select although present on the card. The form filtered users by their current designer role, losing historical assignments. The local fix retains the assigned user as a disabled historical option without offering other non-designers.

## Durable local changes and validation

- Exclude `/assets/` from the SPA fallback so missing chunks are not returned as HTML.
- Revalidate HTML with `Cache-Control: no-cache`, leaving hashed asset caching alone.
- Display an explicit reload action on `vite:preloadError`; do not automatically reload or suppress the rejection that protects the form from incomplete initialization.
- Update the form's error instruction to refresh the page: reopening alone cannot repair a cached failed module import.
- Routing RED: 2 failed, 1 passed before the configuration fix; GREEN after the fix.
- Historical designer RED: 1 failed, 2 passed before retaining the assigned user; GREEN after the fix.
- Focused final run: 3 files, 8 tests passed (`order-form-loading`, `deployment-assets`, `app-updates`).
- Final full unit run: 57 files, 523 tests passed.
- Final TypeScript project build, Vite production build, and ESLint on changed production files: passed. Vite reported existing mixed static/dynamic import warnings.

Gaps: no coverage measurement; the new recovery notice and historical-designer option were not exercised in a browser. The durable code/config changes are local and have not been deployed. No checkpoint commits were created; unrelated workspace changes were preserved.

Self-evaluation (`agent-self-evaluation`): accuracy 4/5 (live console, HTTP response, and restored labels agree; recovery UI lacks browser validation); completeness 4/5 (live failure resolved; durable changes still need deployment); clarity 4/5 (Arabic refresh guidance with unsaved-edit notice; no in-place retry); actionability 4/5 (tested source ready; deployment remains); conciseness 4/5 (small notice and loader helpers; tests and evidence add files).

Routing follow-up: Vercel honored the first publish but its active SPA fallback still returned HTML for the retired chunk URL. Replaced the rewrite rule with ordered Vercel routes: preserve immutable caching for /assets/, no-cache for application pages, consult the filesystem first, return 404 for a missing asset, then apply the SPA fallback. This follow-up is committed separately after live verification.
