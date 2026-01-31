import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { financeService, type Adjustment } from '../../services/financeService';
import { db, type Doctor, type Supplier } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { Calculator, ArrowRightLeft, Save } from 'lucide-react';

export default function AdjustmentsPanel() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    // const [loading, setLoading] = useState(true); // removed unused loading

    const [newAdj, setNewAdj] = useState({
        entityType: 'doctor', // 'doctor' | 'supplier'
        entityId: '',
        amount: '',
        type: 'charge', // 'charge' (+ to Debt) | 'credit' (- from Debt)
        date: new Date().toISOString().split('T')[0],
        reason: ''
    });

    if (!isAdmin) return <div className="p-8 text-center text-red-500">غير مصرح لك بدخول هذه الصفحة</div>;

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        // setLoading(true);
        try {
            const [adjs, docs, sups] = await Promise.all([
                financeService.getAdjustments(),
                db.getDoctors(),
                db.getSuppliers()
            ]);
            setAdjustments(adjs);
            setDoctors(docs);
            setSuppliers(sups);
        } catch (e) {
            console.error(e);
        } finally {
            // setLoading(false);
        }
    }

    async function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        try {
            await financeService.addAdjustment({
                entity_type: newAdj.entityType as any,
                entity_id: newAdj.entityId,
                amount: parseFloat(newAdj.amount),
                type: newAdj.type as any,
                date: newAdj.date,
                reason: newAdj.reason
            });
            setNewAdj({ ...newAdj, amount: '', reason: '' });
            loadData();
            alert('تم إضافة القيد بنجاح');
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء الحفظ');
        }
    }

    const getEntityName = (type: string, id: string) => {
        if (type === 'doctor') return doctors.find(d => d.id === id)?.name || 'طبيب غير معروف';
        if (type === 'supplier') return suppliers.find(s => s.id === id)?.name || 'مورد غير معروف';
        return 'غير معروف';
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Form */}
            <Card className="p-6 lg:col-span-1 h-fit">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Calculator className="text-blue-600" />
                    إضافة قيد / تسوية
                </h2>

                <form onSubmit={handleAdd} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">الجهة</label>
                        <select
                            className="w-full p-2 border border-gray-200 rounded-lg"
                            value={newAdj.entityType}
                            onChange={e => setNewAdj({ ...newAdj, entityType: e.target.value, entityId: '' })}
                        >
                            <option value="doctor">طبيب</option>
                            <option value="supplier">مورد</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">الاسم</label>
                        <select
                            className="w-full p-2 border border-gray-200 rounded-lg"
                            value={newAdj.entityId}
                            onChange={e => setNewAdj({ ...newAdj, entityId: e.target.value })}
                            required
                        >
                            <option value="">اختر...</option>
                            {newAdj.entityType === 'doctor' ? (
                                doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                            ) : (
                                suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                            )}
                        </select>
                    </div>

                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <label className="block text-sm font-medium text-gray-700 mb-2">نوع الحركة</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="adjType"
                                    checked={newAdj.type === 'charge'}
                                    onChange={() => setNewAdj({ ...newAdj, type: 'charge' })}
                                />
                                <span className="text-red-700 font-bold text-sm">إضافة على الحساب (مدين)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="adjType"
                                    checked={newAdj.type === 'credit'}
                                    onChange={() => setNewAdj({ ...newAdj, type: 'credit' })}
                                />
                                <span className="text-green-700 font-bold text-sm">خصم من الحساب (دائن)</span>
                            </label>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {newAdj.type === 'charge'
                                ? 'مثال: غرامة، خدمة إضافية غير مسجلة'
                                : 'مثال: خصم خاص، تعويض، تسوية دائنة'}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                        <Input
                            type="number"
                            value={newAdj.amount}
                            onChange={e => setNewAdj({ ...newAdj, amount: e.target.value })}
                            required
                            min="0"
                            step="0.01"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">التاريخ</label>
                        <Input
                            type="date"
                            value={newAdj.date}
                            onChange={e => setNewAdj({ ...newAdj, date: e.target.value })}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">السبب / البيان</label>
                        <Input
                            value={newAdj.reason}
                            onChange={e => setNewAdj({ ...newAdj, reason: e.target.value })}
                            required
                            placeholder="سبب القيد..."
                        />
                    </div>

                    <Button type="submit" variant="primary" className="w-full">
                        <Save size={16} className="ml-2" /> حفظ القيد
                    </Button>
                </form>
            </Card>

            {/* List */}
            <Card className="lg:col-span-2 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <ArrowRightLeft className="text-gray-500" />
                        سجل القيود والتسويات
                    </h2>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-bold">
                            <tr>
                                <th className="p-4">التاريخ</th>
                                <th className="p-4">الجهة</th>
                                <th className="p-4">النوع</th>
                                <th className="p-4">البيان</th>
                                <th className="p-4">المبلغ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {adjustments.map(adj => (
                                <tr key={adj.id} className="hover:bg-gray-50">
                                    <td className="p-4 text-sm text-gray-600 font-mono">{adj.date}</td>
                                    <td className="p-4 font-bold text-gray-800">
                                        {getEntityName(adj.entity_type, adj.entity_id)}
                                        <span className="block text-xs text-gray-400 font-normal">
                                            {adj.entity_type === 'doctor' ? 'طبيب' : 'مورد'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        {adj.type === 'charge' ? (
                                            <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">مدين (+)</span>
                                        ) : (
                                            <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">دائن (-)</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">{adj.reason}</td>
                                    <td className={`p-4 font-bold font-mono ${adj.type === 'charge' ? 'text-red-600' : 'text-green-600'}`}>
                                        {adj.amount.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                            {adjustments.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-400">لا توجد قيود مسجلة</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
