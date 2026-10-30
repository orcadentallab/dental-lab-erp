# Release file inventory — 2026-10-30

Comparison: current workspace against origin/master `ea159d1`. CRLF-only differences excluded. Untracked files included; nested worktrees excluded. Categories identify release ownership; shared files require hunk-level separation. This inventory is not evidence of production deployment.

## designer_overlap

| File | Change | Uncommitted content |
|---|---|---|
| `docs/testing/designer-submission-availability.tdd.md` | added | no |
| `docs/testing/designer-submission-production-hotfix.md` | deleted | no |
| `docs/testing/designer-workspace-access.tdd.md` | deleted | no |
| `scratch/designer-workspace-review.md` | added | yes |
| `src/pages/DesignerStats.tsx` | modified | no |
| `tests/unit/designer-legacy-write.test.ts` | deleted | no |

## doctor_portal

| File | Change | Uncommitted content |
|---|---|---|
| `docs/archive/DOCTOR_PORTAL_MASTER_PLAN_2026-10-07_HISTORY_AR.md` | added | no |
| `docs/DOCTOR_CODE_POLICY_AND_MERGE_REVIEW_AR.md` | added | no |
| `docs/DOCTOR_PORTAL_MASTER_PLAN_AR.md` | added | no |
| `docs/DOCTOR_PORTAL_RELEASE_AR.md` | added | no |
| `docs/DOCTOR_PORTAL_REVIEW_2026-10-07_AR.md` | added | no |
| `playwright.doctor-portal.config.ts` | added | no |
| `scripts/doctor-portal-qa.ps1` | added | no |
| `scripts/doctor-portal-release-check.ps1` | added | no |
| `scripts/seed-doctor-portal-demo.mjs` | added | no |
| `src/components/doctors/DoctorForm.tsx` | modified | no |
| `src/components/doctors/DoctorLinkRequestsModal.tsx` | added | no |
| `src/components/doctors/DoctorManualAccess.tsx` | added | no |
| `src/components/doctors/DoctorPasswordAccess.tsx` | added | no |
| `src/components/doctors/DoctorPasswordField.tsx` | added | no |
| `src/components/doctors/DoctorPhoneFields.tsx` | added | no |
| `src/components/doctors/NewDoctorRegistration.tsx` | added | no |
| `src/layouts/DoctorPortalLayout.tsx` | added | no |
| `src/lib/doctorContacts.ts` | added | no |
| `src/lib/doctorIdentity.ts` | added | no |
| `src/pages/doctor/DoctorCenterTeam.tsx` | added | no |
| `src/pages/doctor/DoctorFinance.tsx` | modified | no |
| `src/pages/doctor/DoctorOrders.tsx` | modified | no |
| `src/pages/doctor/DoctorSupport.tsx` | added | no |
| `src/pages/doctor/NewOrderRequest.tsx` | modified | no |
| `src/pages/DoctorPortalInbox.tsx` | added | no |
| `src/pages/Doctors.tsx` | modified | no |
| `src/pages/Login.tsx` | modified | no |
| `src/services/auth/doctorAuthService.ts` | added | no |
| `src/services/auth/doctorManualAccessService.ts` | added | no |
| `src/services/auth/doctorPasswordService.ts` | added | no |
| `src/services/auth/MetaCloudOtpSender.ts` | added | no |
| `src/services/auth/MockOtpSender.ts` | added | no |
| `src/services/auth/types.ts` | added | no |
| `src/services/doctorPortalService.ts` | added | no |
| `src/services/supabase/doctors.ts` | modified | no |
| `supabase/manual/doctor_merge_review_2003_2024_read_only.sql` | added | no |
| `supabase/manual/doctor_portal_release_read_only.sql` | added | no |
| `supabase/migrations/20261004000000_doctor_portal_phone_auth_and_linking.sql` | added | no |
| `supabase/migrations/20261007010000_doctor_onboarding_and_order_destination.sql` | added | no |
| `supabase/migrations/20261007020000_doctor_region_codes_and_names.sql` | added | no |
| `supabase/migrations/20261007030000_doctor_manual_access.sql` | added | no |
| `supabase/migrations/20261007040000_doctor_password_registration_and_invitations.sql` | added | no |
| `supabase/migrations/20261011000000_doctor_registration_contacts_and_address_review.sql` | added | no |
| `supabase/migrations/20261011010000_doctor_portal_scope_intake_and_monthly_reads.sql` | added | no |
| `supabase/migrations/20261011030000_doctor_case_file_limits_and_audit.sql` | added | no |
| `supabase/migrations/20261011040000_prevent_duplicate_center_child_registration.sql` | added | no |
| `supabase/migrations/20261011050000_doctor_service_catalog_projection.sql` | added | no |
| `supabase/migrations/20261011060000_separate_scan_storage_limits.sql` | added | no |
| `supabase/tests/database/doctor_manual_access.test.sql` | added | no |
| `supabase/tests/database/doctor_onboarding_and_destination.test.sql` | added | no |
| `supabase/tests/database/doctor_password_registration.test.sql` | added | no |
| `supabase/tests/database/doctor_portal_phone_auth_and_linking.test.sql` | added | no |
| `supabase/tests/database/doctor_portal_scope_and_intake.test.sql` | added | no |
| `supabase/tests/database/doctor_region_codes_and_names.test.sql` | added | no |
| `supabase/tests/database/doctor_registration_contacts.test.sql` | added | no |
| `tests/doctor-manual-access.qa.ts` | added | no |
| `tests/doctor-password.qa.ts` | added | no |
| `tests/doctor-portal-live.qa.ts` | added | no |
| `tests/doctor-portal.qa.ts` | added | no |
| `tests/unit/doctor-auth-service.test.ts` | added | no |
| `tests/unit/doctor-identity.test.ts` | added | no |
| `tests/unit/doctor-manual-access.test.ts` | added | no |
| `tests/unit/doctor-password.test.ts` | added | no |
| `tests/unit/doctor-portal-files.test.ts` | added | no |

## erp_v2_finance

| File | Change | Uncommitted content |
|---|---|---|
| `docs/audits/2026-10-19-legacy-statement-date-incident-ar.md` | added | no |
| `docs/audits/2026-10-21-order-status-v2-production-review.md` | added | no |
| `docs/ORDER_STATUS_PHASE_0_1_INVENTORY.md` | modified | no |
| `docs/ORDER_WORKFLOW_V2_REMAINING_PLAN.md` | modified | no |
| `docs/testing/dashboard-rejected-breakdown.tdd.md` | added | no |
| `docs/testing/order-status-phase-2.tdd.md` | added | no |
| `docs/testing/order-status-phase-3-runtime.tdd.md` | added | no |
| `docs/testing/order-status-phase-4-parity.tdd.md` | added | no |
| `docs/testing/order-status-phase-5-mirror-off.tdd.md` | added | no |
| `src/components/dashboard/AlertCard.tsx` | modified | no |
| `src/components/dashboard/OrderListItem.tsx` | modified | no |
| `src/components/dashboard/orderListLayout.ts` | added | no |
| `src/components/dashboard/OrderListModal.tsx` | modified | no |
| `src/components/finance/AccountInfoPanel.tsx` | modified | no |
| `src/components/finance/doctorReceivablesFallback.ts` | added | no |
| `src/components/finance/DoctorReceivablesModal.tsx` | modified | no |
| `src/components/finance/OrderAnalysisTab.tsx` | modified | no |
| `src/components/finance/StatementTab.tsx` | modified | no |
| `src/components/GlobalSearch.tsx` | modified | no |
| `src/components/orders/OrderBoard.tsx` | modified | no |
| `src/components/orders/OrderList.tsx` | modified | no |
| `src/components/orders/WorkflowActionBar.tsx` | modified | no |
| `src/constants/accountingRegistration.ts` | modified | no |
| `src/constants/dashboardOrderGroups.ts` | added | no |
| `src/constants/financialObligations.ts` | modified | no |
| `src/constants/orderDerivedStatusV2.ts` | added | no |
| `src/constants/orderLifecycle.ts` | modified | yes |
| `src/constants/orderStatementFinancials.ts` | added | no |
| `src/constants/workflowTransitions.ts` | modified | no |
| `src/lib/excelImporter.ts` | modified | no |
| `src/lib/smartSearch.ts` | modified | no |
| `src/lib/workflowPermissions.ts` | modified | no |
| `src/pages/Accounts.tsx` | modified | no |
| `src/pages/AgingReport.tsx` | modified | no |
| `src/pages/AIAnalytics.tsx` | modified | no |
| `src/pages/Analytics.tsx` | modified | no |
| `src/pages/BalanceSnapshot.tsx` | modified | no |
| `src/pages/CaseRegistration.tsx` | modified | no |
| `src/pages/CashFlow.tsx` | modified | no |
| `src/pages/Dashboard.tsx` | modified | no |
| `src/pages/DashboardNew.tsx` | modified | no |
| `src/pages/Orders.tsx` | modified | no |
| `src/pages/production/Shipments.tsx` | modified | no |
| `src/pages/Statements.tsx` | modified | no |
| `src/services/dashboardService.ts` | modified | no |
| `src/services/statementService.ts` | modified | no |
| `src/services/supabase/financialReconciliationPreview.ts` | modified | no |
| `src/services/supabase/historicalObligationsPreview.ts` | modified | no |
| `src/services/supabase/orders.ts` | modified | yes |
| `src/services/supabase/orderWorkflow.ts` | modified | no |
| `src/services/supabase/production.ts` | modified | no |
| `src/utils/orderUtils.tsx` | modified | no |
| `supabase/audits/order_status_dependency_inventory.sql` | modified | no |
| `supabase/audits/order_status_parity_phase4.sql` | added | no |
| `supabase/audits/order_status_phase4_remote_preflight.sql` | added | no |
| `supabase/audits/order_status_phase5_post_pilot.sql` | added | no |
| `supabase/audits/order_status_v2_production_review.sql` | added | no |
| `supabase/manual/legacy_statement_dates_read_only.sql` | added | no |
| `supabase/manual/workflow_v2_mirror_off_rollback.sql` | added | no |
| `supabase/manual/workflow_v2_mirror_off_staging_smoke.sql` | added | no |
| `supabase/manual/workflow_v2_production_drift_reconcile_20261027.sql` | added | no |
| `supabase/manual/workflow_v2_production_portal_drift_20261027.sql` | added | no |
| `supabase/migrations/20261019000000_derive_order_display_status_v2.sql` | added | no |
| `supabase/migrations/20261022000000_retire_runtime_status_financial_guards.sql` | added | no |
| `supabase/migrations/20261022010000_runtime_status_mirror_and_rpc_writers.sql` | added | no |
| `supabase/migrations/20261022020000_retire_remaining_transition_status_updates.sql` | added | no |
| `supabase/migrations/20261022030000_order_intake_state_v2.sql` | added | no |
| `supabase/migrations/20261022040000_retire_pending_review_status_reads.sql` | added | no |
| `supabase/migrations/20261022050000_retire_doctor_portal_delivered_status_fallback.sql` | added | no |
| `supabase/migrations/20261022060000_retire_accounting_registration_status_reads.sql` | added | no |
| `supabase/migrations/20261022070000_retire_dashboard_status_reads.sql` | added | no |
| `supabase/migrations/20261022080000_mirror_status_on_v2_inserts.sql` | added | no |
| `supabase/migrations/20261022090000_doctor_portal_inserts_write_v2_axes.sql` | added | no |
| `supabase/migrations/20261022100000_retire_analytics_summary_status_reads.sql` | added | no |
| `supabase/migrations/20261022110000_retire_top_report_status_reads.sql` | added | no |
| `supabase/migrations/20261022120000_retire_doctor_report_status_reads.sql` | added | no |
| `supabase/migrations/20261022130000_retire_cost_quality_status_reads.sql` | added | no |
| `supabase/migrations/20261022140000_orders_update_policy_uses_v2.sql` | added | no |
| `supabase/migrations/20261022150000_retire_reverse_status_triggers.sql` | added | no |
| `supabase/migrations/20261022160000_retire_operational_status_metadata.sql` | added | no |
| `supabase/migrations/20261022170000_workflow_status_parity_audit.sql` | added | no |
| `supabase/migrations/20261027010000_disable_legacy_status_mirror.sql` | added | no |
| `supabase/tests/database/financial_obligations_integration.test.sql` | modified | no |
| `supabase/tests/database/order_status_derivation_v2.test.sql` | added | no |
| `supabase/tests/database/order_status_mirror_off_phase5.test.sql` | added | no |
| `supabase/tests/database/order_status_parity_audit_phase4.test.sql` | added | no |
| `supabase/tests/database/order_status_runtime_retirement_phase3.test.sql` | added | no |
| `supabase/tests/database/security_definer_rpc_grants.test.sql` | modified | no |
| `tests/financialObligations.spec.ts` | modified | no |
| `tests/orderEvents.spec.ts` | modified | no |
| `tests/orderLifecycle.spec.ts` | modified | no |
| `tests/unit/accounting-registration-candidates.test.ts` | modified | no |
| `tests/unit/dashboard-order-groups-v2.test.ts` | added | no |
| `tests/unit/dashboard-pagination.test.ts` | modified | no |
| `tests/unit/doctor-receivables-fallback.test.ts` | added | no |
| `tests/unit/financial-obligation-lifecycle.test.ts` | modified | no |
| `tests/unit/financial-obligations.test.ts` | modified | no |
| `tests/unit/order-derived-status-v2.test.ts` | added | no |
| `tests/unit/order-import-workflow-v2.test.ts` | added | no |
| `tests/unit/order-statement-financials.test.ts` | added | no |
| `tests/unit/order-workflow-status-retirement.test.ts` | added | yes |
| `tests/unit/smart-search-v2.test.ts` | added | no |
| `tests/workflow-helpers.spec.ts` | modified | no |
| `tests/workflowTransitions.spec.ts` | modified | no |

## form_deployment_recovery

| File | Change | Uncommitted content |
|---|---|---|
| `docs/testing/order-form-loading.tdd.md` | added | yes |
| `src/components/AppUpdateNotice.tsx` | added | yes |
| `src/components/orders/OrderForm.tsx` | modified | yes |
| `src/lib/appUpdates.ts` | added | yes |
| `src/lib/orderFormLoading.ts` | added | yes |
| `src/main.tsx` | modified | yes |
| `tests/unit/app-updates.test.ts` | added | yes |
| `tests/unit/deployment-assets.test.ts` | added | yes |
| `tests/unit/order-form-loading.test.ts` | added | yes |
| `vercel.json` | modified | yes |

## generated_artifacts

| File | Change | Uncommitted content |
|---|---|---|
| `playwright-report/index.html` | modified | yes |
| `supabase/.temp/cli-latest` | modified | yes |

## migration_bom_only

| File | Change | Uncommitted content |
|---|---|---|
| `supabase/migrations/20260914000000_internal_lab_technician_rls.sql` | modified | no |

## monthly_reports

| File | Change | Uncommitted content |
|---|---|---|
| `public/fonts/IBMPlexSansArabic-Bold.ttf` | added | no |
| `public/fonts/IBMPlexSansArabic-OFL.txt` | added | no |
| `public/fonts/IBMPlexSansArabic-Regular.ttf` | added | no |
| `scripts/check-monthly-report-pdf.py` | added | no |
| `scripts/verify-monthly-report.mjs` | added | no |
| `src/services/comprehensiveReportService.ts` | modified | no |
| `src/services/reports/monthlyReportModel.ts` | added | no |
| `src/services/reports/monthlyReportPdf.ts` | added | no |
| `src/services/supabase/monthlyReportData.ts` | added | no |
| `tests/fixtures/monthly-report.ts` | added | no |
| `tests/unit/monthly-report-data.test.ts` | added | no |
| `tests/unit/monthly-report-export.test.ts` | added | no |
| `tests/unit/monthly-report-model.test.ts` | added | no |

## preview_backup

| File | Change | Uncommitted content |
|---|---|---|
| `.gitignore` | modified | no |
| `CLICK_TO_DEPLOY_PREVIEW.bat` | added | no |
| `deploy-preview.ps1` | added | no |
| `docs/PREVIEW_DEPLOYMENT_AR.md` | added | no |
| `docs/TEMPORARY_LAPTOP_TRANSFER.md` | added | no |
| `LOCAL PREVIEW Data.bat` | added | no |
| `LOCAL PREVIEW Data.cmd` | added | no |
| `Local Production Data.bat` | added | no |
| `run-deploy-preview.ps1` | added | no |
| `start-local-preview.ps1` | added | no |
| `supabase/seeds/local_preview_admin.sql` | added | no |

## representative_edits

| File | Change | Uncommitted content |
|---|---|---|
| `docs/testing/rep-edit-own-delivery.tdd.md` | added | yes |
| `src/components/orders/OrderCard.tsx` | modified | yes |
| `src/components/orders/RepEditModal.tsx` | modified | yes |
| `supabase/migrations/20261030000000_rep_edit_uses_own_delivery.sql` | added | yes |
| `supabase/tests/database/rep_edit_own_delivery.test.sql` | added | yes |
| `tests/unit/rep-edit-delivery-approval.test.ts` | added | yes |

## shared

| File | Change | Uncommitted content |
|---|---|---|
| `docs/SECURITY_ADVISOR_2026-10-07.md` | added | no |
| `docs/security-advisor-2026-10-07-production.jpg` | added | no |
| `package.json` | modified | yes |
| `src/App.tsx` | modified | yes |
| `src/components/orders/CaseAttachments.tsx` | modified | no |
| `src/lib/storage.ts` | modified | no |
| `src/lib/validation.ts` | modified | no |
| `src/pages/Users.tsx` | modified | no |
| `src/services/db.ts` | modified | no |
| `src/services/supabase/shippingService.ts` | modified | no |
| `src/services/supabase/types.ts` | modified | no |
| `src/services/supabase/users.ts` | modified | no |
| `supabase/tests/database/audit_and_reporting_view_security.test.sql` | added | no |

## shared_database

| File | Change | Uncommitted content |
|---|---|---|
| `supabase/migrations/20261007000000_harden_audit_table_and_reporting_views.sql` | added | no |
| `supabase/migrations/20261011020000_fix_production_sync_route_record_alias.sql` | added | no |

