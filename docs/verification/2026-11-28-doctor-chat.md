# Doctor Chat Feature Verification (2026-11-28)

## Scope & Architecture
- **Branch**: `feature/doctor-chat` (based on `origin/master` `5d0a394e`)
- **Database Migration**: `supabase/migrations/20261128151319_doctor_chat.sql` (additive only; extends `doctor_support_threads` and `doctor_support_posts`, adds `doctor_support_reads`, `doctor_support_reviews`, private `doctor-chat-files` storage bucket, RPCs, triggers, and restrictive RLS policies).

## Implemented Capabilities
1. **Directory Workspace ("الدليل")**:
   - Added `محادثات الأطباء` (`/directory/doctor-chat`, capability `view_doctor_chat`) with unread badge (`get_doctor_chat_unread`).
   - Added `سجل نهاية اليوم` (`/directory/doctor-chat-log`, capability `view_doctor_chat_log`, admin-only).
   - Redirected legacy `/doctor-support-inbox` to `/directory/doctor-chat`.
2. **Per-Case Chat & Internal Notes Separation**:
   - Added `CaseDoctorChatButton` and `CaseDoctorChatDrawer` on Orders (`Orders.tsx`, `OrderCard.tsx`, `OrderBoard.tsx`, `OrderList.tsx`) and Designer Dashboard (`DesignerDashboard.tsx`).
   - Two distinct tabs: `محادثة الطبيب` (visible to doctor) and `ملاحظات داخلية` (`order_comments`, restricted from `doctor` role via `order_comments_exclude_doctors` RLS policy).
3. **Doctor Portal Thread**:
   - Upgraded `DoctorSupport.tsx`, `SupportConversation.tsx`, `DoctorOrders.tsx`, and `DoctorPortalLayout.tsx` with `DoctorChatThread` (unread counts, attachment upload/download via `doctor-chat-files`, mark-as-read receipts).
4. **Staff Notifications**:
   - `notify_doctor_chat_post` trigger emits `doctor_chat_message` notifications to `admin` and `coordinator` on every incoming doctor message, and also to the assigned `designer` / `secondary_designer` on `design` and `try_in` contexts.
   - Opening the thread calls `mark_doctor_chat_read`, clearing both thread unread count and matching `in_app_notifications`.
5. **Admin-Only End-of-Day Log**:
   - `get_doctor_chat_log` and `review_doctor_chat_log` (guarded by `admin` role check `42501`) track incoming doctor messages, notified recipients, first lab reply time, and review sign-off.

## Verification
- **Typecheck**: `npm run typecheck` — passed (0 errors).
- **Build**: `npm run build` — passed.
- **Unit Tests**: `npm test` (Vitest) — 77 files, 636 tests passed.
- **Database Tests**: `supabase test db supabase/tests/database --local` (pgTAP on clean QA reset) — 75 files, 1,516 tests passed (including `doctor_chat.test.sql`).
