import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export type IssueCauseCategory = 'lab' | 'doctor' | 'scan' | 'design' | 'communication' | 'other';

interface Props {
    issueType: 'returned' | 'rejected' | 'cancelled' | 'redo';
    onSubmit: (cause: IssueCauseCategory, notes: string) => void;
    onCancel: () => void;
    isLoading?: boolean;
}

const CAUSE_LABELS: Record<IssueCauseCategory, string> = {
    lab: 'خطأ في المعمل',
    doctor: 'طلب الدكتور',
    scan: 'مشكلة في السكان',
    design: 'مشكلة في التصميم',
    communication: 'خلل في التواصل',
    other: 'أخرى',
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
    returned: 'إرجاع للتعديل',
    rejected: 'رفض',
    cancelled: 'إلغاء',
    redo: 'إعادة إنتاج',
};

export default function IssuePanel({ issueType, onSubmit, onCancel, isLoading }: Props) {
    const [cause, setCause] = useState<IssueCauseCategory>('other');
    const [notes, setNotes] = useState('');

    return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                <span className="text-sm font-bold text-red-700">{ISSUE_TYPE_LABELS[issueType]} — سجّل السبب</span>
            </div>
            <div>
                <label className="block text-xs font-bold text-surface-600 mb-1">نوع السبب</label>
                <select
                    value={cause}
                    onChange={(e) => setCause(e.target.value as IssueCauseCategory)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white"
                >
                    {Object.entries(CAUSE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className="block text-xs font-bold text-surface-600 mb-1">ملاحظات (اختياري)</label>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="وصف المشكلة..."
                    className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm resize-none"
                />
            </div>
            <div className="flex gap-2 justify-end">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-1.5 text-sm font-bold text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
                >
                    تراجع
                </button>
                <button
                    type="button"
                    onClick={() => onSubmit(cause, notes)}
                    disabled={isLoading}
                    className="px-4 py-1.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                >
                    {isLoading ? 'جاري الحفظ...' : 'تأكيد وتسجيل'}
                </button>
            </div>
        </div>
    );
}
