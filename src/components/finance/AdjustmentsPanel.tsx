/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { useState, useEffect, useRef } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { financeService, type Adjustment } from '../../services/financeService';
import { db, type Doctor, type Supplier, type User } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { Calculator, ArrowRightLeft, Save, Search, Pencil, Trash2, X } from 'lucide-react';
import { isDesignerUser } from '../../lib/userRoles';

export default function AdjustmentsPanel() {
    const { user } = useAuth();
    const isAllowed = ['admin', 'accountant'].includes(user?.role || '');

    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
    const [designerSearchQuery, setDesignerSearchQuery] = useState('');
    const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
    const [showDesignerDropdown, setShowDesignerDropdown] = useState(false);
    const doctorDropdownRef = useRef<HTMLDivElement>(null);
    const designerDropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdowns when clicking outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (doctorDropdownRef.current && !doctorDropdownRef.current.contains(e.target as Node)) {
                setShowDoctorDropdown(false);
            }
            if (designerDropdownRef.current && !designerDropdownRef.current.contains(e.target as Node)) {
                setShowDesignerDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);

    const [newAdj, setNewAdj] = useState({
        entityType: 'doctor', // 'doctor' | 'supplier' | 'designer'
        entityId: '',
        amount: '',
        type: 'charge', // 'charge' (+ to Debt) | 'credit' (- from Debt)
        date: new Date().toISOString().split('T')[0],
        reason: ''
    });

    async function loadData() {
        try {
            const [adjs, docs, sups, usrs] = await Promise.all([
                financeService.getAdjustments(),
                db.getDoctors(),
                db.getSuppliers(),
                db.getUsers()
            ]);
            setAdjustments(adjs);
            setDoctors(docs);
            setSuppliers(sups);
            setDesigners((usrs || []).filter(isDesignerUser));
        } catch (e) {
            console.error(e);
        }
    }

    useEffect(() => {
        if (isAllowed) {
            Promise.resolve().then(() => {
                loadData().catch(console.error);
            });
        }
    }, [isAllowed]);

    if (!isAllowed) return <div className="p-8 text-center text-red-500">غير مصرح لك بدخول هذه الصفحة</div>;

    async function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        if (!newAdj.entityId) {
            alert('يرجى اختيار الطبيب أو المورد أو المصمم');
            return;
        }
        try {
            if (editingId) {
                await financeService.updateAdjustment(editingId, {
                    entity_type: newAdj.entityType as 'doctor' | 'supplier' | 'designer',
                    entity_id: newAdj.entityId,
                    amount: parseFloat(newAdj.amount),
                    type: newAdj.type as 'charge' | 'credit',
                    date: newAdj.date,
                    reason: newAdj.reason
                });
                setEditingId(null);
                alert('تم تعديل القيد بنجاح');
            } else {
                await financeService.addAdjustment({
                    entity_type: newAdj.entityType as 'doctor' | 'supplier' | 'designer',
                    entity_id: newAdj.entityId,
                    amount: parseFloat(newAdj.amount),
                    type: newAdj.type as 'charge' | 'credit',
                    date: newAdj.date,
                    reason: newAdj.reason
                });
                alert('تم إضافة القيد بنجاح');
            }
            setNewAdj({ ...newAdj, amount: '', reason: '', entityId: '' });
            setDoctorSearchQuery('');
            setDesignerSearchQuery('');
            loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء الحفظ');
        }
    }

    function handleEdit(adj: Adjustment) {
        setEditingId(adj.id);
        setNewAdj({
            entityType: adj.entity_type,
            entityId: adj.entity_id,
            amount: adj.amount.toString(),
            type: adj.type,
            date: adj.date,
            reason: adj.reason || ''
        });
        if (adj.entity_type === 'doctor') {
            const doc = doctors.find(d => d.id === adj.entity_id);
            setDoctorSearchQuery(doc ? `${doc.name}${doc.doctorCode ? ` (${doc.doctorCode})` : ''}` : '');
            setDesignerSearchQuery('');
        } else if (adj.entity_type === 'designer') {
            const des = designers.find(d => d.id === adj.entity_id);
            setDesignerSearchQuery(des ? des.name : '');
            setDoctorSearchQuery('');
        } else {
            setDoctorSearchQuery('');
            setDesignerSearchQuery('');
        }
    }

    function handleCancelEdit() {
        setEditingId(null);
        setDoctorSearchQuery('');
        setDesignerSearchQuery('');
        setNewAdj({ entityType: 'doctor', entityId: '', amount: '', type: 'charge', date: new Date().toISOString().split('T')[0], reason: '' });
    }

    async function handleDelete(id: string) {
        if (user?.role !== 'admin') {
            alert('عفواً، صلاحية حذف القيود والتسويات المالية مقتصرة على المسؤول (Admin) فقط.');
            return;
        }
        if (!confirm('هل تريد حذف هذا القيد؟ سيتم تحديث رصيد الحساب تلقائياً.')) return;
        try {
            await financeService.deleteAdjustment(id);
            loadData();
            alert('تم حذف القيد بنجاح');
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء الحذف');
        }
    }

    const getEntityName = (type: string, id: string) => {
        if (type === 'doctor') return doctors.find(d => d.id === id)?.name || 'طبيب غير معروف';
        if (type === 'supplier') return suppliers.find(s => s.id === id)?.name || 'مورد غير معروف';
        if (type === 'designer') return designers.find(d => d.id === id)?.name || 'مصمم غير معروف';
        return 'غير معروف';
    };

    const getEntityCode = (type: string, id: string) => {
        if (type === 'doctor') return doctors.find(d => d.id === id)?.doctorCode || '';
        return '';
    };

    // Filter doctors for searchable combobox
    const filteredDoctors = doctors.filter(d => {
        if (!doctorSearchQuery) return true;
        const q = doctorSearchQuery.toLowerCase();
        return d.name.toLowerCase().includes(q) || (d.doctorCode || '').toLowerCase().includes(q);
    });

    // Filter designers for searchable combobox
    const filteredDesigners = designers.filter(d => {
        if (!designerSearchQuery) return true;
        const q = designerSearchQuery.toLowerCase();
        return d.name.toLowerCase().includes(q) || (d.username || '').toLowerCase().includes(q);
    });

    // Filter adjustments based on search query (by entity name or doctor code)
    const filteredAdjustments = adjustments.filter(adj => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const name = getEntityName(adj.entity_type, adj.entity_id).toLowerCase();
        const code = getEntityCode(adj.entity_type, adj.entity_id).toLowerCase();
        return name.includes(q) || code.includes(q);
    });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Form */}
            <Card className="p-6 lg:col-span-1 h-fit">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Calculator className="text-blue-600" />
                    {editingId ? 'تعديل القيد' : 'إضافة قيد / تسوية'}
                </h2>

                {editingId && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                        <span className="text-amber-700 text-sm font-bold">✏️ وضع التعديل</span>
                        <button onClick={handleCancelEdit} className="text-amber-600 hover:text-amber-800 transition-colors" title="إلغاء التعديل">
                            <X size={18} />
                        </button>
                    </div>
                )}

                <form onSubmit={handleAdd} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">الجهة</label>
                        <select
                            className="w-full p-2 border border-gray-200 rounded-lg"
                            value={newAdj.entityType}
                            onChange={e => setNewAdj({ ...newAdj, entityType: e.target.value, entityId: '' })}
                            title="اختر الجهة"
                        >
                            <option value="doctor">طبيب</option>
                            <option value="supplier">مورد</option>
                            <option value="designer">مصمم</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">الاسم</label>
                        {newAdj.entityType === 'doctor' ? (
                            <div className="relative" ref={doctorDropdownRef}>
                                <div className="relative">
                                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                    <input
                                        type="text"
                                        placeholder="ابحث بالاسم أو الكود..."
                                        value={doctorSearchQuery}
                                        onChange={e => {
                                            setDoctorSearchQuery(e.target.value);
                                            setShowDoctorDropdown(true);
                                            // Clear selection if user types
                                            if (newAdj.entityId) {
                                                setNewAdj({ ...newAdj, entityId: '' });
                                            }
                                        }}
                                        onFocus={() => setShowDoctorDropdown(true)}
                                        className="w-full pl-3 pr-10 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-300 text-sm"
                                    />
                                </div>
                                {showDoctorDropdown && (
                                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                        {filteredDoctors.length === 0 ? (
                                            <div className="p-3 text-sm text-gray-400 text-center">لا توجد نتائج</div>
                                        ) : (
                                            filteredDoctors.map(d => (
                                                <button
                                                    key={d.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setNewAdj({ ...newAdj, entityId: d.id });
                                                        setDoctorSearchQuery(`${d.name}${d.doctorCode ? ` (${d.doctorCode})` : ''}`);
                                                        setShowDoctorDropdown(false);
                                                    }}
                                                    className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 transition-colors flex items-center justify-between ${newAdj.entityId === d.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                                                >
                                                    <span className="font-medium">{d.name}</span>
                                                    {d.doctorCode && <span className="text-xs text-gray-400 font-mono">{d.doctorCode}</span>}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                                {/* Hidden required input for form validation */}
                                <input type="hidden" value={newAdj.entityId} required />
                            </div>
                        ) : newAdj.entityType === 'designer' ? (
                            <div className="relative" ref={designerDropdownRef}>
                                <div className="relative">
                                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                    <input
                                        type="text"
                                        placeholder="ابحث باسم المصمم..."
                                        value={designerSearchQuery}
                                        onChange={e => {
                                            setDesignerSearchQuery(e.target.value);
                                            setShowDesignerDropdown(true);
                                            if (newAdj.entityId) {
                                                setNewAdj({ ...newAdj, entityId: '' });
                                            }
                                        }}
                                        onFocus={() => setShowDesignerDropdown(true)}
                                        className="w-full pl-3 pr-10 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-300 text-sm"
                                    />
                                </div>
                                {showDesignerDropdown && (
                                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                        {filteredDesigners.length === 0 ? (
                                            <div className="p-3 text-sm text-gray-400 text-center">لا توجد نتائج</div>
                                        ) : (
                                            filteredDesigners.map(d => (
                                                <button
                                                    key={d.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setNewAdj({ ...newAdj, entityId: d.id });
                                                        setDesignerSearchQuery(d.name);
                                                        setShowDesignerDropdown(false);
                                                    }}
                                                    className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 transition-colors flex items-center justify-between ${newAdj.entityId === d.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                                                >
                                                    <span className="font-medium">{d.name}</span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                                <input type="hidden" value={newAdj.entityId} required />
                            </div>
                        ) : (
                            <select
                                className="w-full p-2 border border-gray-200 rounded-lg"
                                value={newAdj.entityId}
                                onChange={e => setNewAdj({ ...newAdj, entityId: e.target.value })}
                                required
                                title="اختر المورد"
                            >
                                <option value="">اختر...</option>
                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        )}
                    </div>

                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <label className="block text-sm font-medium text-gray-700 mb-2">نوع الحركة</label>
                        <div className="flex flex-col gap-2.5">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="adjType"
                                    checked={newAdj.type === 'charge'}
                                    onChange={() => setNewAdj({ ...newAdj, type: 'charge' })}
                                />
                                <span className="text-red-700 font-bold text-sm">
                                    {newAdj.entityType === 'doctor'
                                        ? 'إضافة مديونية على الطبيب (مدين +)'
                                        : newAdj.entityType === 'supplier'
                                        ? 'خصم من مستحقات المورد (مدين -)'
                                        : 'خصم من مستحقات المصمم (مدين -)'}
                                </span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="adjType"
                                    checked={newAdj.type === 'credit'}
                                    onChange={() => setNewAdj({ ...newAdj, type: 'credit' })}
                                />
                                <span className="text-green-700 font-bold text-sm">
                                    {newAdj.entityType === 'doctor'
                                        ? 'خصم من حساب الطبيب (دائن -)'
                                        : newAdj.entityType === 'supplier'
                                        ? 'إضافة لمستحقات المورد (دائن +)'
                                        : 'إضافة لمستحقات المصمم (دائن +)'}
                                </span>
                            </label>
                        </div>
                        <p className="text-xs text-gray-500 mt-3 border-t border-gray-200 pt-2 font-medium leading-relaxed">
                            {newAdj.entityType === 'doctor' ? (
                                newAdj.type === 'charge'
                                    ? 'تزيد المبلغ المستحق عليه للمعمل (مثال: غرامة، شحن إضافي، خدمات إضافية غير مسجلة)'
                                    : 'تقلل المبلغ المستحق عليه للمعمل (مثال: خصم خاص، تعويض حالة تالفة، رصيد دائن)'
                            ) : newAdj.entityType === 'supplier' ? (
                                newAdj.type === 'charge'
                                    ? 'تقلل مستحقات المورد المطلوب دفعها له (مثال: جزاء تأخير، خصم متفق عليه، خصم مرتجعات)'
                                    : 'تزيد مستحقات المورد المطلوب دفعها له (مثال: تكلفة إضافية لخدمة، رصيد افتتاحى دائن)'
                            ) : (
                                newAdj.type === 'charge'
                                    ? 'تقلل مستحقات المصمم المطلوب دفعها له (مثال: جزاء تأخير، خصم إعادة عمل حالة)'
                                    : 'تزيد مستحقات المصمم المطلوب دفعها له (مثال: حافز إضافي، عمولة استثنائية، رصيد افتتاحى دائن)'
                            )}
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
                        <Save size={16} className="ml-2" /> {editingId ? 'حفظ التعديل' : 'حفظ القيد'}
                    </Button>
                </form>
            </Card>

            {/* List */}
            <Card className="lg:col-span-2 overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <ArrowRightLeft className="text-gray-500" />
                            سجل القيود والتسويات
                        </h2>
                        <span className="text-sm text-gray-400">{filteredAdjustments.length} قيد</span>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="بحث بالاسم أو كود الطبيب..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-4 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-300 text-sm font-medium transition-all"
                        />
                    </div>
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
                                <th className="p-4 w-24">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredAdjustments.map(adj => (
                                <tr key={adj.id} className="hover:bg-gray-50">
                                    <td className="p-4 text-sm text-gray-600 font-mono">{adj.date}</td>
                                    <td className="p-4 font-bold text-gray-800">
                                        {getEntityName(adj.entity_type, adj.entity_id)}
                                        <span className="block text-xs text-gray-400 font-normal">
                                            {adj.entity_type === 'doctor' ? 'طبيب' : adj.entity_type === 'supplier' ? 'مورد' : 'مصمم'}
                                            {getEntityCode(adj.entity_type, adj.entity_id) && (
                                                <span className="mr-1 font-mono">({getEntityCode(adj.entity_type, adj.entity_id)})</span>
                                            )}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        {adj.type === 'charge' ? (
                                            adj.entity_type === 'doctor' ? (
                                                <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">مدين (+)</span>
                                            ) : (
                                                <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">مدين (-)</span>
                                            )
                                        ) : (
                                            adj.entity_type === 'doctor' ? (
                                                <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">دائن (-)</span>
                                            ) : (
                                                <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">دائن (+)</span>
                                            )
                                        )}
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">{adj.reason}</td>
                                    <td className={`p-4 font-bold font-mono ${adj.type === 'charge' ? 'text-red-600' : 'text-green-600'}`}>
                                        {adj.amount.toLocaleString()}
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleEdit(adj)}
                                                className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors"
                                                title="تعديل"
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            {user?.role === 'admin' && (
                                                <button
                                                    onClick={() => handleDelete(adj.id)}
                                                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                                                    title="حذف"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredAdjustments.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-400">
                                        {searchQuery ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد قيود مسجلة'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
