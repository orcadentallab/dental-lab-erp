# RLS and privileged-RPC review — 2026-08-01

## Production-change preview

- Financial records changed: **0**
- Orders, transactions, obligations, allocations, and credits changed: **0**
- Financial amount changed: **EGP 0.00**
- Scope: policies, grants, and function authorization only

## Confirmed findings fixed

1. `order_issues` was the only public application table without RLS. Direct
   access is now limited to admin SELECT/UPDATE; trigger-based audit inserts
   continue to run as the function owner.
2. `ai_insights` trusted the frontend and allowed every authenticated user to
   read and mutate every report. Its four operations are now admin-only in RLS.
3. Six reporting RPCs used `SECURITY DEFINER` and historical grants made them
   executable by `anon`. Their public signatures are preserved behind wrappers:
   - analytics and top-list RPCs: admin only;
   - finance dashboard: admin/accountant;
   - operational dashboard: internal staff roles only.
4. Client execution was revoked from every trigger-only `SECURITY DEFINER`
   function.
5. Historical anonymous grants were removed from admin review, representative
   edit, employee settlement, doctor-retention analytics, and follow-up RPCs.

The intentionally anonymous `get_email_by_username` login helper remains
available. Identity helpers may also be called anonymously but return no profile
role/entity/user when `auth.uid()` is null.

## Verification

- Clean local migration replay: passed.
- Database integration tests: 5 files, 91 assertions, passed.
- RLS role matrix: 21 assertions covering anon, admin, accountant,
  representative, and doctor behavior.
- Unit tests: 112 passed.
- ESLint: 0 errors; 50 pre-existing warnings.
- Production build: passed.
- Database lint: no errors; two pre-existing `unused variable` warnings in the
  doctor-retention RPCs.

