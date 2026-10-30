import { useEffect, useState } from 'react';
import { watchForAppUpdate } from '../lib/appUpdates';

export default function AppUpdateNotice() {
    const [needsReload, setNeedsReload] = useState(false);

    useEffect(() => watchForAppUpdate(window, () => setNeedsReload(true)), []);

    if (!needsReload) return null;

    return (
        <div role="alert" dir="rtl" className="fixed inset-x-3 top-3 z-[10000] mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xl">
            <p className="font-bold">تعذر تحميل جزء من التطبيق. حدّث الصفحة لتحميل النسخة الحالية.</p>
            <p className="mt-1 text-sm">احتفظ بأي تعديلات غير محفوظة قبل التحديث.</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-amber-900 px-4 py-2 font-bold text-white">
                تحديث الصفحة
            </button>
        </div>
    );
}
