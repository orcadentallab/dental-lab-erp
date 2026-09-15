import { useState, useEffect, useCallback } from 'react';
import {
    Cpu, Plus, AlertTriangle, Power,
    Edit3, Trash2, Clock, RefreshCw, X, ShieldAlert
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import {
    getMachines, createMachine, updateMachine, deleteMachine,
    getMachineDowntime, reportMachineDown, restoreMachine,
    DOWNTIME_REASONS, type Machine, type MachineDowntime,
    type DowntimeReason, type MachineStatus
} from '../../services/supabase/machines';
import { getStages, type ProductionStage } from '../../services/supabase/production';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

const STATUS_LABELS: Record<MachineStatus, { label: string; bg: string; text: string; border: string }> = {
    running: { label: 'يعمل بكفاءة', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    down: { label: 'متعطل / متوقف', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
    maintenance: { label: 'قيد الصيانة', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    retired: { label: 'خارج الخدمة', bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200' },
};

function formatDuration(startedAt: string, endedAt: string | null): string {
    const start = new Date(startedAt).getTime();
    const end = endedAt ? new Date(endedAt).getTime() : Date.now();
    const diffHours = (end - start) / 3_600_000;
    if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))} دقيقة`;
    if (diffHours < 24) return `${Math.round(diffHours * 10) / 10} ساعة`;
    return `${Math.floor(diffHours / 24)} يوم و ${Math.round(diffHours % 24)} ساعة`;
}

function isDowntimeReason(val: string): val is DowntimeReason {
    return DOWNTIME_REASONS.some((r) => r.code === val);
}

export default function Machines() {
    const { user } = useAuth();
    const { success, error: toastError } = useToast();

    const [machines, setMachines] = useState<Machine[]>([]);
    const [stages, setStages] = useState<ProductionStage[]>([]);
    const [downtimeHistory, setDowntimeHistory] = useState<MachineDowntime[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<'machines' | 'history'>('machines');

    // Modals state
    const [isAddEditOpen, setIsAddEditOpen] = useState(false);
    const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
    const [formData, setFormData] = useState({
        code: '',
        nameAr: '',
        stageId: '',
        capacityUnitsPerRun: '',
        notes: '',
    });

    const [downtimeModalMachine, setDowntimeModalMachine] = useState<Machine | null>(null);
    const [downtimeReason, setDowntimeReason] = useState<DowntimeReason>('breakdown');
    const [downtimeNotes, setDowntimeNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'production_manager';

    const loadData = useCallback(async () => {
        try {
            const [mList, sList, dtList] = await Promise.all([
                getMachines(),
                getStages(),
                getMachineDowntime(),
            ]);
            setMachines(mList);
            setStages(sList);
            setDowntimeHistory(dtList);
        } catch (e) {
            console.error('Failed to load machines data:', e);
            toastError('تعذر تحميل بيانات الأجهزة والأعطال');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [toastError]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const handleOpenAdd = () => {
        setEditingMachine(null);
        setFormData({
            code: '',
            nameAr: '',
            stageId: stages[0]?.id || '',
            capacityUnitsPerRun: '',
            notes: '',
        });
        setIsAddEditOpen(true);
    };

    const handleOpenEdit = (m: Machine) => {
        setEditingMachine(m);
        setFormData({
            code: m.code,
            nameAr: m.nameAr,
            stageId: m.stageId || '',
            capacityUnitsPerRun: m.capacityUnitsPerRun ? String(m.capacityUnitsPerRun) : '',
            notes: m.notes || '',
        });
        setIsAddEditOpen(true);
    };

    const handleSaveMachine = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.code.trim() || !formData.nameAr.trim()) {
            toastError('كود الجهاز واسم الجهاز مطلوبان');
            return;
        }

        setIsSubmitting(true);
        try {
            const capacity = formData.capacityUnitsPerRun ? parseInt(formData.capacityUnitsPerRun, 10) : null;
            if (editingMachine) {
                await updateMachine(editingMachine.id, {
                    code: formData.code,
                    nameAr: formData.nameAr,
                    stageId: formData.stageId || null,
                    capacityUnitsPerRun: capacity,
                    notes: formData.notes,
                });
                success('تم تعديل بيانات الجهاز بنجاح');
            } else {
                await createMachine({
                    code: formData.code,
                    nameAr: formData.nameAr,
                    stageId: formData.stageId || null,
                    capacityUnitsPerRun: capacity,
                    notes: formData.notes,
                });
                success('تم تسجيل الجهاز الجديد بنجاح');
            }
            setIsAddEditOpen(false);
            void loadData();
        } catch (err) {
            console.error('Save machine failed:', err);
            toastError('فشل حفظ بيانات الجهاز');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteMachine = async (m: Machine) => {
        if (!window.confirm(`هل أنت متأكد من حذف/تعطيل الجهاز "${m.nameAr}"؟`)) return;
        try {
            await deleteMachine(m.id);
            success('تم إخراج الجهاز من الخدمة بنجاح');
            void loadData();
        } catch (err) {
            console.error('Delete machine failed:', err);
            toastError('تعذر إخراج الجهاز من الخدمة');
        }
    };

    const handleReportDown = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!downtimeModalMachine) return;

        setIsSubmitting(true);
        try {
            await reportMachineDown(downtimeModalMachine.id, downtimeReason, downtimeNotes);
            success(`تم تسجيل توقف الجهاز "${downtimeModalMachine.nameAr}" بنجاح`);
            setDowntimeModalMachine(null);
            setDowntimeNotes('');
            void loadData();
        } catch (err) {
            console.error('Report downtime failed:', err);
            toastError('تعذر تسجيل توقف الجهاز');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRestoreMachine = async (m: Machine) => {
        try {
            await restoreMachine(m.id);
            success(`تمت إعادة تشغيل الجهاز "${m.nameAr}" بنجاح`);
            void loadData();
        } catch (err) {
            console.error('Restore machine failed:', err);
            toastError('تعذر إعادة تشغيل الجهاز');
        }
    };

    const downCount = machines.filter(m => m.status === 'down').length;

    if (isLoading) {
        return (
            <div className="p-8 text-center text-slate-500" dir="rtl">
                جارِ تحميل سجل الأجهزة والأعطال…
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                        <Cpu className="w-7 h-7 text-primary-600" />
                        الأجهزة والأعطال التشغيلية
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        ربط الماكينات بالمراحل التشغيلية وإدارة فترات التوقف والأعطال آلياً
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setIsRefreshing(true);
                            void loadData();
                        }}
                        disabled={isRefreshing}
                        className="flex items-center gap-1.5"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        تحديث
                    </Button>
                    {isManagerOrAdmin && (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleOpenAdd}
                            className="flex items-center gap-1.5"
                        >
                            <Plus className="w-4 h-4" />
                            إضافة جهاز جديد
                        </Button>
                    )}
                </div>
            </div>

            {/* Down Machines Banner */}
            {downCount > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between gap-3 text-red-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 rounded-xl">
                            <ShieldAlert className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <div className="font-bold text-base">
                                يوجد {downCount} جهاز متوقف / معطل في المعمل حالياً!
                            </div>
                            <div className="text-xs text-red-600">
                                الحالات التابعة للمراحل المتأثرة قد تتعرض للتعطل حتى يتم الإصلاح
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-slate-200 gap-4">
                <button
                    onClick={() => setActiveTab('machines')}
                    className={`pb-3 text-sm font-bold border-b-2 flex items-center gap-2 ${
                        activeTab === 'machines'
                            ? 'border-primary-600 text-primary-600'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Cpu className="w-4 h-4" />
                    قائمة الماكينات ({machines.length})
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`pb-3 text-sm font-bold border-b-2 flex items-center gap-2 ${
                        activeTab === 'history'
                            ? 'border-primary-600 text-primary-600'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Clock className="w-4 h-4" />
                    سجل الأعطال والتوقفات ({downtimeHistory.length})
                </button>
            </div>

            {/* Machines Tab */}
            {activeTab === 'machines' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {machines.length === 0 ? (
                        <div className="col-span-full bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
                            لا توجد أجهزة مسجلة حتى الآن.
                        </div>
                    ) : (
                        machines.map((m) => {
                            const st = STATUS_LABELS[m.status];
                            const isDown = m.status === 'down';
                            return (
                                <Card
                                    key={m.id}
                                    className={`p-5 transition-all border ${
                                        isDown ? 'border-red-300 bg-red-50/20' : 'border-slate-200'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-bold text-slate-900 text-lg">
                                                    {m.nameAr}
                                                </h3>
                                                <span className="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                                    {m.code}
                                                </span>
                                            </div>
                                            <div className="text-xs text-primary-700 font-semibold mt-1">
                                                المرحلة المرتبطة: {m.stageNameAr || 'غير محددة'}
                                            </div>
                                        </div>

                                        <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${st.bg} ${st.text} ${st.border}`}>
                                            {st.label}
                                        </span>
                                    </div>

                                    <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                        <div>
                                            <span className="text-slate-400 block">حمولة الشوطة:</span>
                                            <span className="font-bold text-slate-800">
                                                {m.capacityUnitsPerRun ? `${m.capacityUnitsPerRun} وحدة` : 'غير محددة'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-slate-400 block">الحالة التشغيلية:</span>
                                            <span className="font-bold text-slate-800">
                                                {m.isActive ? 'مفعل بالمعمل' : 'معطل'}
                                            </span>
                                        </div>
                                    </div>

                                    {m.notes && (
                                        <p className="mt-2 text-xs text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                            {m.notes}
                                        </p>
                                    )}

                                    {/* Actions */}
                                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5">
                                            {isDown ? (
                                                <button
                                                    onClick={() => void handleRestoreMachine(m)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors"
                                                >
                                                    <Power className="w-3.5 h-3.5" />
                                                    إعادة تشغيل (تم الإصلاح)
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => {
                                                        setDowntimeModalMachine(m);
                                                        setDowntimeReason('breakdown');
                                                        setDowntimeNotes('');
                                                    }}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-bold transition-colors"
                                                >
                                                    <AlertTriangle className="w-3.5 h-3.5" />
                                                    تسجيل عطل / توقف
                                                </button>
                                            )}
                                        </div>

                                        {isManagerOrAdmin && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleOpenEdit(m)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
                                                    title="تعديل الجهاز"
                                                >
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => void handleDeleteMachine(m)}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
                                                    title="إخراج من الخدمة"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            );
                        })
                    )}
                </div>
            )}

            {/* Downtime History Tab */}
            {activeTab === 'history' && (
                <Card className="overflow-hidden border border-slate-200">
                    <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                    <th className="p-3">الجهاز</th>
                                    <th className="p-3">نوع التوقف</th>
                                    <th className="p-3">وقت البدء</th>
                                    <th className="p-3">وقت الانتهاء</th>
                                    <th className="p-3">المدة الكلية</th>
                                    <th className="p-3">الملاحظات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {downtimeHistory.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-slate-400">
                                            لا توجد سجلات أعطال سابقة
                                        </td>
                                    </tr>
                                ) : (
                                    downtimeHistory.map((dt) => {
                                        const reasonObj = DOWNTIME_REASONS.find(r => r.code === dt.reason);
                                        const isOngoing = !dt.endedAt;
                                        return (
                                            <tr key={dt.id} className={isOngoing ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                                                <td className="p-3 font-bold text-slate-800">
                                                    {dt.machineNameAr} ({dt.machineCode})
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded-full font-bold ${
                                                        dt.reason === 'breakdown' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                                                    }`}>
                                                        {reasonObj?.label || dt.reason}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-slate-600 font-mono">
                                                    {new Date(dt.startedAt).toLocaleString('ar-EG')}
                                                </td>
                                                <td className="p-3 text-slate-600 font-mono">
                                                    {dt.endedAt ? (
                                                        new Date(dt.endedAt).toLocaleString('ar-EG')
                                                    ) : (
                                                        <span className="text-red-600 font-bold flex items-center gap-1">
                                                            <Clock className="w-3.5 h-3.5 animate-spin" /> مستمر حتى الآن
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 font-bold text-slate-700">
                                                    {formatDuration(dt.startedAt, dt.endedAt)}
                                                </td>
                                                <td className="p-3 text-slate-500 max-w-xs truncate">
                                                    {dt.notes || '—'}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Add / Edit Machine Modal */}
            {isAddEditOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">
                                {editingMachine ? 'تعديل بيانات الجهاز' : 'تسجيل جهاز تشغيلي جديد'}
                            </h2>
                            <button
                                onClick={() => setIsAddEditOpen(false)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveMachine} className="space-y-4 text-sm">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    كود الجهاز الفريد (مثال: PRN-01, FURN-01) *
                                </label>
                                <Input
                                    type="text"
                                    value={formData.code}
                                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                    placeholder="PRN-01"
                                    required
                                    className="font-mono"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    اسم الجهاز (مثال: طابعة Formlabs 3B) *
                                </label>
                                <Input
                                    type="text"
                                    value={formData.nameAr}
                                    onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                                    placeholder="اسم الماكينة"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    المرحلة الإنتاجية المرتبطة بالجهاز
                                </label>
                                <select
                                    value={formData.stageId}
                                    onChange={(e) => setFormData({ ...formData, stageId: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500"
                                >
                                    <option value="">-- بدون مرحلة محددة --</option>
                                    {stages.map((st) => (
                                        <option key={st.id} value={st.id}>
                                            {st.nameAr} ({st.code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    سعة الشوطة / الدفعة (عدد الوحدات لكل شوطة):
                                </label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={formData.capacityUnitsPerRun}
                                    onChange={(e) => setFormData({ ...formData, capacityUnitsPerRun: e.target.value })}
                                    placeholder="مثال: 20"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    ملاحظات فنية / مواصفات
                                </label>
                                <textarea
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    rows={2}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500"
                                    placeholder="أية تفاصيل إضافية..."
                                />
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsAddEditOpen(false)}
                                    disabled={isSubmitting}
                                >
                                    إلغاء
                                </Button>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'جارِ الحفظ…' : 'حفظ الجهاز'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Report Downtime Modal */}
            {downtimeModalMachine && (
                <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-red-200">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-red-700 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-red-600" />
                                تسجيل توقف / عطل: {downtimeModalMachine.nameAr}
                            </h2>
                            <button
                                onClick={() => setDowntimeModalMachine(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleReportDown} className="space-y-4 text-sm">
                            <p className="text-xs text-slate-600 leading-relaxed bg-red-50 p-3 rounded-xl border border-red-100">
                                تسجيل العطل سيحول حالة الجهاز إلى <strong>متوقف</strong> ويخصم زمن التوقف من زمن المرحلة آلياً في التقارير لعدم ظلم الفنيين.
                            </p>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    سبب التوقف *
                                </label>
                                <select
                                    value={downtimeReason}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (isDowntimeReason(val)) {
                                            setDowntimeReason(val);
                                        }
                                    }}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 font-bold"
                                    required
                                >
                                    {DOWNTIME_REASONS.map((r) => (
                                        <option key={r.code} value={r.code}>
                                            {r.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    وصف العطل / الإجراء المطلوب:
                                </label>
                                <textarea
                                    value={downtimeNotes}
                                    onChange={(e) => setDowntimeNotes(e.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500"
                                    placeholder="مثال: ذراع التحريك مكسور بحاجة لقطعة غيار..."
                                />
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setDowntimeModalMachine(null)}
                                    disabled={isSubmitting}
                                >
                                    إلغاء
                                </Button>
                                <Button
                                    type="submit"
                                    className="bg-red-600 hover:bg-red-700 text-white font-bold"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'جارِ التسجيل…' : 'تسجيل التوقف الآن'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
