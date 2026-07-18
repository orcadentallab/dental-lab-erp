# Dental Lab ERP — Project Summary

Last updated: 2026-07-18

## Purpose and current shape

Dental Lab ERP is an Arabic RTL web application for running a dental laboratory: cases and production, doctors and their branches, external labs, finance, employee affairs, reporting, and doctor follow-up. It has a public marketing site at `/`, a role-based internal ERP, and a doctor portal.

The production application is a React single-page app backed directly by Supabase for authentication, PostgreSQL, RLS, triggers, and RPCs. `backend/` contains a separate Express service, but is not the main application backend.

## Stack

- React 19, TypeScript 5.9, Vite 7, React Router 7, Tailwind CSS.
- Supabase JS 2.90 for auth and data; database logic lives in `supabase/migrations/`.
- Zod validation, Framer Motion, Lucide, XLSX, jsPDF/html2canvas/react-to-print.
- Vitest (`npm test`) and Playwright are installed; Vercel and Netlify deployment configuration are present.

Main commands:

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

## Application areas

- **Orders and production:** case registration, items and teeth, design/external-lab assignment, files, delivery dates, priority, comments, history, and audit events.
- **Doctors:** CRM records, multi-branch support, account data, retention analysis, segmentation, and scheduled follow-ups.
- **Finance:** transactions, account statements, aging, balance snapshots, billing settings, financial obligations, allocations, reconciliation, and exports/printing.
- **Cashboxes:** cash, bank, Vodafone Cash, InstaPay, and other balances; internal transfers, reconciliation snapshots, and optional transfer fees.
- **Employees:** employee profiles, salary processing, manual commissions, advances, custody, adjustments, and employee-related transactions.
- **Reporting:** dashboard, quality, analytics, issues, designer statistics, AI analytics, and marketing analytics.

## Access and routes

Roles are `admin`, `lab`, `representative`, `accountant`, `designer`, and `doctor`. Route guards live in `src/App.tsx`; RLS, triggers, and RPCs are also part of enforcement.

| Area | Main routes | Typical access |
| --- | --- | --- |
| Operations | `/dashboard`, `/orders`, `/quality` | Admin, lab, representative; designer on dashboard/orders |
| Doctors | `/doctors`, `/doctors/retention` | Admin, representative |
| Accounts/settings | `/accounts`, `/settings` | Varies by role; designers can access accounts |
| Employees | `/employees`, `/employees/:id` | Admin, accountant, representative |
| Finance | `/finance`, `/suppliers`, `/case-registration`, `/balance-snapshot`, `/statements`, `/aging-report` | Admin, accountant |
| Administration | `/analytics`, `/ai-analytics`, `/users`, `/services`, `/issues-report`, `/marketing-analytics`, `/designer-stats` | Admin |
| Doctor portal | `/doctor/new-request`, `/doctor/my-orders`, `/doctor/account` | Doctor |

`/staff` remains a redirect to `/employees`.

## Workflow and order data

The legacy `orders.status` field remains in active use, while the workflow layer also uses `production_status` and `issue_state`. Workflow synchronization and guards were revised after the original WF-1 compatibility work.

- Production includes `not_started`, `designing`, `in_production`, `try_in_ready`, `waiting_doctor`, `finalization`, `final_ready`, and `final_delivered`.
- Issue handling now distinguishes returns, cancellations, **doctor rejection**, **lab rejection**, and redo-related flows. The status-to-workflow sync was updated in July 2026.
- Representative edits are audited and governed by the workflow permission layer. See `docs/orders-field-permissions.md` before changing order updates.
- Orders support redo links, manual/design/rejected-lab costs, event/history tracking, doctor branch names, archival, and soft deletion (`is_deleted`).

Order and finance behavior are tightly coupled: delivery, returns, rejections, and cancellation can affect obligations and balances. Treat workflow changes as finance-sensitive changes.

## Finance and cashboxes

`financial_obligations` remains the primary structured model for doctor receivables and supplier/external-lab payables, alongside transactions. The project includes billing settings, FIFO allocation previews, historical backfill, and reconciliation helpers.

Cashbox support (July 2026) adds `cashboxes`, `cashbox_transfers`, and `cashbox_reconciliations`. Transactions can be associated with a cashbox and a linked fee transaction. Admins manage cashboxes; admins and accountants can view, transfer, and reconcile them under RLS policies.

## Database status

The migration history starts at `001_initial_schema.sql` and continues through the July 2026 timestamped migrations. Important recent changes include:

- 087–098: expanded order auditing, stricter representative edits, financial RLS, rejection status handling, doctor branches, analytics adjustments, and workflow fixes.
- 2026-07-01: order soft deletion support.
- 2026-07-05–06: employee management, doctor retention configuration/analytics/follow-up RPCs, and related security/visibility fixes.
- 2026-07-11: atomic order update, redo/workflow sync, audit-field expansion, and designer workflow guards.
- 2026-07-13: cashboxes, cashbox types, fee/savings settings, and cashbox save/update behavior.

The current migration files are the repository record; do not use the old “migration 086 is current” statement as a deployment reference.

## Repository map

- `src/App.tsx` — routes and role access.
- `src/pages/` — ERP pages; `src/pages/doctor/` — doctor portal.
- `src/components/orders/` and `src/components/finance/` — feature UI.
- `src/services/supabase/` — Supabase queries and RPC wrappers.
- `src/services/db.ts` and `src/services/supabase/types.ts` — domain/data mappings.
- `src/constants/`, `src/lib/`, `src/context/` — business constants, client utilities, and app contexts.
- `supabase/migrations/` — schema, RLS, functions, and triggers.
- `docs/` — setup, deployment, security, workflow runbooks, and audits.
- `tests/` and `testsprite_tests/` — test suites and generated test assets.

## Development notes

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, then run `npm run dev` (normally Vite at `http://localhost:5173`). Before deploying, run typecheck, lint, tests appropriate to the change, and a production build; confirm the required Supabase migrations and RLS policies are applied.

Suggested onboarding order:

1. `src/App.tsx` for access and page structure.
2. `src/services/db.ts` plus `src/services/supabase/` for data boundaries.
3. `docs/orders-field-permissions.md` and workflow constants before changing orders.
4. Finance obligation and cashbox services before changing delivery, payments, or balances.
