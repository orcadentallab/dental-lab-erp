import { describe, it, expect } from 'vitest';
import { isVisibleInAccountStatement, isDesignerPayable, isDoctorRejectedStatus, isLabRejectedStatus } from '../../src/lib/orderStatusHelpers';

describe('Order Status Helpers - Financial Relevance & Statement Visibility', () => {
    describe('isVisibleInAccountStatement', () => {
        it('should show terminal orders when not deleted', () => {
            const terminalStatuses = ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Rejected'];
            for (const status of terminalStatuses) {
                expect(isVisibleInAccountStatement({ status, isDeleted: false })).toBe(true);
                expect(isVisibleInAccountStatement({ status, isDeleted: null })).toBe(true);
                // Should show even when archived
                expect(isVisibleInAccountStatement({ status, isDeleted: false, isArchived: true })).toBe(true);
            }
        });

        it('should NOT show terminal orders when isDeleted is true', () => {
            const terminalStatuses = ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Rejected'];
            for (const status of terminalStatuses) {
                expect(isVisibleInAccountStatement({ status, isDeleted: true })).toBe(false);
                expect(isVisibleInAccountStatement({ status, isDeleted: true, isArchived: true })).toBe(false);
            }
        });

        it('should NOT show in-progress orders (even if not deleted)', () => {
            const inProgressStatuses = [
                'Pending', 'In Progress', 'New Case', 'Under Design',
                'Waiting Dr Approval', 'Under Production', 'Try In',
                'Try In Approved', 'Ready', 'Returned for Adjustments', 'Pending Review'
            ];
            for (const status of inProgressStatuses) {
                expect(isVisibleInAccountStatement({ status, isDeleted: false })).toBe(false);
                expect(isVisibleInAccountStatement({ status, isDeleted: false, isArchived: true })).toBe(false);
            }
        });

        it('should return false if order or status is missing', () => {
            expect(isVisibleInAccountStatement({ isDeleted: false })).toBe(false);
            expect(isVisibleInAccountStatement({ status: null, isDeleted: false })).toBe(false);
        });
    });

    describe('isDoctorRejectedStatus', () => {
        it('should return true for Doctor Rejected and legacy Rejected', () => {
            expect(isDoctorRejectedStatus('Doctor Rejected')).toBe(true);
            expect(isDoctorRejectedStatus('Rejected')).toBe(true);
            expect(isDoctorRejectedStatus('Lab Rejected')).toBe(false);
            expect(isDoctorRejectedStatus(null)).toBe(false);
        });
    });

    describe('isLabRejectedStatus', () => {
        it('should return true only for Lab Rejected', () => {
            expect(isLabRejectedStatus('Lab Rejected')).toBe(true);
            expect(isLabRejectedStatus('Doctor Rejected')).toBe(false);
            expect(isLabRejectedStatus(null)).toBe(false);
        });
    });

    describe('Regression Scenarios - Supplier Financial Calculations', () => {
        // Supplier cost calculation logic simulation
        const calculateSupplierCost = (o: { status: string; isDeleted?: boolean; isArchived?: boolean; rejectedLabCost?: number }) => {
            if (!isVisibleInAccountStatement(o)) {
                return null; // Excluded from statements/balances entirely
            }

            const hasRejectionCost = isDoctorRejectedStatus(o.status) && typeof o.rejectedLabCost === 'number';
            const isRelevant = (!isDoctorRejectedStatus(o.status) || hasRejectionCost) &&
                (o.status === 'Delivered' || o.status === 'Cancelled' || isLabRejectedStatus(o.status) || hasRejectionCost);

            if (!isRelevant) return 0; // Or not relevant, but let's return 0 cost

            let cost = 500; // Simulated standard cost
            if (o.status === 'Cancelled' || isLabRejectedStatus(o.status)) {
                cost = 0;
            } else if (isDoctorRejectedStatus(o.status)) {
                cost = hasRejectionCost ? o.rejectedLabCost! : 0;
            }
            return cost;
        };

        it('Doctor Rejected order with isArchived: true and rejectedLabCost > 0 must still appear in supplier balance with the cost', () => {
            const order = {
                status: 'Doctor Rejected',
                isArchived: true,
                isDeleted: false,
                rejectedLabCost: 350
            };

            // 1. Must be visible in statement
            expect(isVisibleInAccountStatement(order)).toBe(true);

            // 2. Cost must be exactly the rejectedLabCost (350)
            expect(calculateSupplierCost(order)).toBe(350);
        });

        it('Lab Rejected order (archived or not) must never appear with any cost', () => {
            const orderArchived = {
                status: 'Lab Rejected',
                isArchived: true,
                isDeleted: false,
                rejectedLabCost: 350 // Even if someone mistakenly inputs rejection cost
            };
            const orderNotArchived = {
                status: 'Lab Rejected',
                isArchived: false,
                isDeleted: false
            };

            // 1. Both must be visible in statement (so we know they are processed as 0-cost, like Cancelled)
            expect(isVisibleInAccountStatement(orderArchived)).toBe(true);
            expect(isVisibleInAccountStatement(orderNotArchived)).toBe(true);

            // 2. Cost must be exactly 0
            expect(calculateSupplierCost(orderArchived)).toBe(0);
            expect(calculateSupplierCost(orderNotArchived)).toBe(0);
        });

        it('In-progress order (e.g. status: Under Design) must never appear in statement/balance totals', () => {
            const order = {
                status: 'Under Design',
                isArchived: false,
                isDeleted: false
            };

            // 1. Must NOT be visible in account statement
            expect(isVisibleInAccountStatement(order)).toBe(false);

            // 2. Result of cost calculation should be null (excluded entirely)
            expect(calculateSupplierCost(order)).toBeNull();
        });
    });

    // ─── isDesignerPayable ──────────────────────────────────────────────────────
    describe('isDesignerPayable', () => {
        it('terminal order (Delivered) is payable even without designStatus', () => {
            expect(isDesignerPayable({ status: 'Delivered' })).toBe(true);
        });

        it('all terminal statuses are payable', () => {
            const terminals = ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Rejected'];
            for (const status of terminals) {
                expect(isDesignerPayable({ status })).toBe(true);
            }
        });

        // ✅ KEY BUSINESS RULE FIX
        it('split order with designStatus=completed is payable even when order is still Under Production', () => {
            expect(isDesignerPayable({
                status: 'Under Production',
                workflowType: 'split',
                designStatus: 'completed',
            })).toBe(true);
        });

        it('split order with designStatus=completed is payable for all non-terminal production statuses', () => {
            const inProgressStatuses = ['Under Production', 'Try In', 'Try In Approved', 'Ready'];
            for (const status of inProgressStatuses) {
                expect(isDesignerPayable({
                    status,
                    workflowType: 'split',
                    designStatus: 'completed',
                })).toBe(true);
            }
        });

        it('split order with designStatus NOT completed is NOT payable', () => {
            expect(isDesignerPayable({
                status: 'Under Design',
                workflowType: 'split',
                designStatus: 'in_progress',
            })).toBe(false);
        });

        it('split order with designStatus=waiting_approval is NOT payable', () => {
            expect(isDesignerPayable({
                status: 'Waiting Dr Approval',
                workflowType: 'split',
                designStatus: 'waiting_approval',
            })).toBe(false);
        });

        it('non-split order with completed-like status is still payable via terminal path', () => {
            // non-split orders don't have designStatus, but they can still be Delivered
            expect(isDesignerPayable({ status: 'Delivered', workflowType: 'standard' })).toBe(true);
        });

        it('soft-deleted order is NOT payable even if design is completed', () => {
            expect(isDesignerPayable({
                status: 'Under Production',
                workflowType: 'split',
                designStatus: 'completed',
                isDeleted: true,
            })).toBe(false);
        });

        it('soft-deleted terminal order is NOT payable', () => {
            expect(isDesignerPayable({ status: 'Delivered', isDeleted: true })).toBe(false);
        });

        it('returns false for null/undefined order', () => {
            expect(isDesignerPayable(null as unknown as object)).toBe(false);
            expect(isDesignerPayable(undefined as unknown as object)).toBe(false);
        });

        it('returns false when status and designStatus are both missing', () => {
            expect(isDesignerPayable({})).toBe(false);
        });
    });
});
