# Admin production override

The three-dot override now selects canonical `production_status` values using
the shared Arabic labels. Pending Review belongs to intake and is excluded.
The service resolves the authenticated caller and requires admin. Normal workflow
actions are unchanged. Final delivery retains the V2 delivery RPC and financial
effects; other targets use the audited production-axis service. Issue and intake
axes are not implicitly cleared. No database migration or Doctor Portal change.

RED: two new regressions failed on the old dropdown/service. GREEN: 54 files,
484 unit tests passed. Changed-source ESLint and diff checks passed. TypeScript
and Vite build passed. No authenticated browser mutation was performed.

Self-evaluation: accuracy 4/5 (source/build/unit proof; no live admin action),
completeness 4/5 (production states and authorization covered; browser acceptance
pending), clarity 4/5 (shared labels; separate intake state explained),
actionability 4/5 (release ready; production verification follows), conciseness
4/5 (two production files). Overall 4.0/5. Follow-up: verify the deployed menu
under an admin session without modifying a customer order merely for testing.
