import type { ProductionStatus, IssueState } from './workflow';

export interface WorkflowAction {
    id: string;
    label: string;
    targetLegacyStatus: string;
    variant: 'primary' | 'success' | 'warning' | 'danger' | 'default';
    icon?: string;
    requiresConfirmation?: boolean;
    confirmMessage?: string;
    requiresNote?: boolean;
    notePlaceholder?: string;
    adminOnly?: boolean;
}

export function getForwardActions(
    productionStatus: ProductionStatus,
    issueState: IssueState,
    orderContext: {
        workflowType?: string | null;
        deliveryType?: string | null;
        designUrl?: string | null;
        status?: string;
    }
): WorkflowAction[] {

    if (issueState === 'doctor_rejected' || issueState === 'lab_rejected' || issueState === 'cancelled' || issueState === 'redo') {
        return [];
    }

    if (issueState === 'on_hold') {
        return [{
            id: 'resume_from_hold',
            label: 'رفع الإيقاف',
            targetLegacyStatus: 'Under Production',
            variant: 'primary',
            icon: 'Play',
        }];
    }

    switch (productionStatus) {
        case 'not_started':
            if (orderContext.status === 'Pending Review') return [];
            return [
                ...(orderContext.workflowType === 'split' ? [{
                    id: 'start_design',
                    label: 'بدء التصميم',
                    targetLegacyStatus: 'Under Design',
                    variant: 'primary' as const,
                    icon: 'PenTool',
                }] : []),
                {
                    id: 'start_production',
                    label: 'إرسال للإنتاج',
                    targetLegacyStatus: 'Under Production',
                    variant: 'primary' as const,
                    icon: 'Play',
                },
            ];

        case 'designing':
            if (orderContext.designUrl) {
                return [{
                    id: 'to_production',
                    label: 'إرسال للإنتاج',
                    targetLegacyStatus: 'Under Production',
                    variant: 'primary',
                    icon: 'ArrowRight',
                }];
            }
            return [];

        case 'in_production': {
            const dt = (orderContext.deliveryType || '').toLowerCase();
            const isTryIn = dt === 'tryin' || dt === 'try_in';
            const mainAction: WorkflowAction = isTryIn
                ? { id: 'try_in_ready', label: 'Try-In جاهز', targetLegacyStatus: 'Try In', variant: 'primary', icon: 'Package' }
                : { id: 'ready', label: 'جاهز للتسليم', targetLegacyStatus: 'Ready', variant: 'success', icon: 'PackageCheck' };
            const returnToDesign: WorkflowAction = {
                id: 'return_to_design',
                label: 'رجوع للتصميم',
                targetLegacyStatus: 'Under Design',
                variant: 'warning',
                icon: 'PenTool',
                requiresConfirmation: true,
                confirmMessage: 'سيتم إرجاع الحالة لمرحلة التصميم. الرجاء إدخال سبب التعديل:',
                requiresNote: true,
                notePlaceholder: 'سبب الرجوع للتصميم…',
            };
            return [mainAction, returnToDesign];
        }

        case 'try_in_ready':
        case 'waiting_doctor':
            return [
                {
                    id: 'try_in_approved',
                    label: 'Try-In تمت الموافقة',
                    targetLegacyStatus: 'Try In Approved',
                    variant: 'primary',
                    icon: 'CheckCircle',
                },
                {
                    id: 'return_to_design',
                    label: 'رجوع للتصميم',
                    targetLegacyStatus: 'Under Design',
                    variant: 'warning',
                    icon: 'PenTool',
                    requiresConfirmation: true,
                    confirmMessage: 'سيتم إرجاع الحالة لمرحلة التصميم. الرجاء إدخال سبب التعديل:',
                    requiresNote: true,
                    notePlaceholder: 'سبب الرجوع للتصميم (مثال: اللون غير مناسب، التطابق غير صحيح…)',
                },
            ];

        case 'finalization':
            return [{
                id: 'final_ready',
                label: 'جاهز فاينال',
                targetLegacyStatus: 'Ready',
                variant: 'success',
                icon: 'PackageCheck',
            }];

        case 'final_ready':
            return [{
                id: 'deliver',
                label: 'تسليم',
                targetLegacyStatus: 'Delivered',
                variant: 'success',
                icon: 'Truck',
                requiresConfirmation: true,
                confirmMessage: 'هل أنت متأكد من تسليم هذا الأوردر؟ سيتم نقله إلى الأرشيف.',
            }];

        case 'final_delivered':
            return [];

        default:
            return [];
    }
}

export function getIssueActions(
    issueState: IssueState,
    userRole?: string
): WorkflowAction[] {
    if (
        issueState === 'doctor_rejected' ||
        issueState === 'lab_rejected' ||
        issueState === 'cancelled' ||
        issueState === 'redo'
    ) return [];

    const actions: WorkflowAction[] = [];

    if (issueState !== 'returned') {
        actions.push({
            id: 'return',
            label: 'إرجاع للتعديل',
            targetLegacyStatus: 'Returned for Adjustments',
            variant: 'warning',
            icon: 'RotateCcw',
            requiresConfirmation: true,
            confirmMessage: 'سيتم إرجاع الأوردر للتعديل وسيبقى نشطاً. الرجاء إدخال سبب التعديل:',
            requiresNote: true,
            notePlaceholder: 'سبب التعديل…',
        });
    }

    if (userRole === 'admin' || userRole === 'representative') {
        actions.push({
            id: 'reject',
            label: 'مرتجع طبيب',
            targetLegacyStatus: 'Doctor Rejected',
            variant: 'danger',
            icon: 'XCircle',
            requiresConfirmation: true,
            confirmMessage: 'هل أنت متأكد من رفض الأوردر (مرتجع طبيب)؟',
            adminOnly: true,
        });
        actions.push({
            id: 'lab_reject',
            label: 'رفض المعمل',
            targetLegacyStatus: 'Lab Rejected',
            variant: 'danger',
            icon: 'XCircle',
            requiresConfirmation: true,
            confirmMessage: 'هل أنت متأكد من رفض المعمل للأوردر؟',
            adminOnly: true,
        });
        actions.push({
            id: 'cancel',
            label: 'إلغاء',
            targetLegacyStatus: 'Cancelled',
            variant: 'danger',
            icon: 'Ban',
            requiresConfirmation: true,
            confirmMessage: 'هل أنت متأكد من إلغاء الأوردر؟',
            adminOnly: true,
        });
    }

    return actions;
}

export function getRedoAction(): WorkflowAction {
    return {
        id: 'redo',
        label: 'إعادة إنتاج',
        targetLegacyStatus: 'New Case',
        variant: 'warning',
        icon: 'RefreshCw',
        requiresConfirmation: true,
        confirmMessage: 'سيتم إغلاق هذا الأوردر وإنشاء أوردر جديد مرتبط به. هل أنت متأكد؟',
        adminOnly: true,
    };
}
