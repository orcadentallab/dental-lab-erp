import type { CaseLocation } from '../../constants/workflow';
import { MapPin } from 'lucide-react';

const LOCATION_LABELS: Record<CaseLocation, string> = {
    pending_intake: 'في الاستقبال',
    with_designer: 'عند المصمم',
    internal_design: 'قسم التصميم',
    with_external_lab: 'عند المعمل الخارجي',
    internal_production: 'قسم الإنتاج',
    internal_ready_try_in: 'عند الطبيب (تراي آن)',
    with_doctor_waiting: 'عند الطبيب',
    internal_finalization: 'إنتاج نهائي',
    internal_ready_final: 'جاهزة للتسليم',
    with_doctor_final: 'تم التسليم',
    issue_review: 'مراجعة المشكلة',
    on_hold: 'موقوف',
    closed: 'مغلق',
};

const LOCATION_COLORS: Record<CaseLocation, string> = {
    pending_intake: 'text-gray-500',
    with_designer: 'text-violet-600',
    internal_design: 'text-purple-600',
    with_external_lab: 'text-sky-600',
    internal_production: 'text-blue-600',
    internal_ready_try_in: 'text-orange-600',
    with_doctor_waiting: 'text-orange-600',
    internal_finalization: 'text-indigo-600',
    internal_ready_final: 'text-emerald-600',
    with_doctor_final: 'text-green-700',
    issue_review: 'text-red-600',
    on_hold: 'text-orange-700',
    closed: 'text-gray-400',
};

interface Props {
    location: CaseLocation;
}

export default function CaseLocationChip({ location }: Props) {
    return (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${LOCATION_COLORS[location]}`}>
            <MapPin size={10} />
            {LOCATION_LABELS[location]}
        </span>
    );
}
