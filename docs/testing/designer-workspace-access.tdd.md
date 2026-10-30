# Designer workspace access — release verification

Primary designers use the dashboard for case management. Orders and production tasks are absent from navigation/search/default favourites and blocked by direct-route capability guards. Active assigned cases remain visible through requests for details, doctor approval and production. Terminal delivered, rejected, cancelled, archived and deleted cases are excluded. Uploaded designs remain in the submitted tab; revisions remain in the pending tab.

Release is based on origin/master 61f9748, retaining its V2 transition fixes. Only designer-workspace changes were transferred from the working checkout.

Validation: eight focused test files, 110 tests passed; tsc -b passed; Vite production build passed; git diff --check passed. ESLint passed on the changed components/helpers; orders.ts has two pre-existing unused-parameter errors (_userId and _userName) outside this patch. No database migration is required.

No live designer credentials were used. Production browser verification is limited to public page/asset availability; authenticated behaviour is covered by route and visibility regression tests.
