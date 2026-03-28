import { useState, useEffect } from 'react';
import { db, type Doctor } from '../services/db';
import { Plus, Search, MapPin, Phone, AlertTriangle, Edit, FileSpreadsheet, Printer } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { exportToExcel } from '../lib/exportUtils';
import { generateGenericTablePDF } from '../services/pdfService';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import { useTranslation } from '../translations';
import { matchArabic } from '../lib/searchUtils';

export default function Doctors() {
    const { user } = useAuth();
    const { t } = useTranslation();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [services, setServices] = useState<import('../services/db').Service[]>([]);
    // const [representatives, setRepresentatives] = useState<User[]>([]); - REMOVED
    const [showModal, setShowModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newDoctor, setNewDoctor] = useState({
        name: '',
        phone: '',
        phone2: '',
        address: '',
        doctorCode: '',
        representativeName: '',
        representativeId: '',
        customPrices: {} as Record<string, number>
    });
    const [error, setError] = useState<string | null>(null);

    const normalizeText = (text: string) => {
        if (!text) return '';
        return text
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي');
    };

    useEffect(() => {
        const loadData = async () => {
            // Load Doctors and Services
            try {
                const [doctorsData, servicesData] = await Promise.all([
                    db.getDoctors(),
                    db.getServices()
                ]);
                setDoctors(doctorsData);
                setServices(servicesData);
            } catch (error) {
                console.error('Error loading doctors:', error);
            }
        };
        loadData();
    }, []);

    const openAddModal = () => {
        setEditingId(null);
        setNewDoctor({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '', customPrices: {} });
        setError(null);
        setShowModal(true);
    };

    const openEditModal = (doc: Doctor) => {
        setEditingId(doc.id);
        setNewDoctor({
            name: doc.name,
            phone: doc.phone,
            phone2: doc.phone2 || '',
            address: doc.address,
            doctorCode: doc.doctorCode,
            representativeName: doc.representativeName,
            representativeId: doc.representativeId || '',
            customPrices: doc.customPrices || {}
        });
        setError(null);
        setShowModal(true);
    };

    const handleSaveDoctor = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            // Validation: Duplicate Check (Case Insensitive)
            const normalizedName = normalizeText(newDoctor.name);
            const normalizedCode = newDoctor.doctorCode.trim().toUpperCase();

            // Check duplicates (excluding current doctor if editing)
            const nameExists = doctors.find(doc =>
                doc.id !== editingId &&
                doc.name &&
                normalizeText(doc.name) === normalizedName
            );
            const codeExists = doctors.find(doc =>
                doc.id !== editingId &&
                doc.doctorCode &&
                doc.doctorCode.trim().toUpperCase() === normalizedCode
            );

            if (nameExists) {
                setError(`⚠️ هذا الاسم موجود بالفعل: ${nameExists.name} `);
                return;
            }

            if (codeExists) {
                setError(`⚠️ هذا الكود مستخدم بالفعل للطبيب: ${codeExists.name} (${codeExists.doctorCode})`);
                return;
            }

            if (editingId) {
                // Update
                const updatedDoc = await db.updateDoctor(editingId, {
                    ...newDoctor,
                    name: newDoctor.name.trim(),
                    doctorCode: normalizedCode
                });
                if (updatedDoc) {
                    setDoctors(doctors.map(d => d.id === editingId ? updatedDoc : d));
                }
            } else {
                // Create
                const doc = await db.addDoctor({
                    ...newDoctor,
                    name: newDoctor.name.trim(),
                    doctorCode: normalizedCode
                });
                setDoctors([...doctors, doc]);
            }

            setShowModal(false);
            setEditingId(null);
            setNewDoctor({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '', customPrices: {} });

        } catch (err: unknown) {
            console.error('Save Doctor Error:', err);
            setError('حدث خطأ غير متوقع أثناء الحفظ.');
        }
    };


    const [sortBy, setSortBy] = useState<'name' | 'code' | 'rep'>('name');

    // ...

    const filteredDoctors = doctors
        .filter(doc => {
            const term = searchTerm.trim();
            if (!term) return true;

            return (
                matchArabic(doc.name, term) ||
                doc.phone.includes(term) ||
                (doc.phone2 && doc.phone2.includes(term)) ||
                (doc.doctorCode && matchArabic(doc.doctorCode, term))
            );
        })
        .sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'code') return (a.doctorCode || '').localeCompare(b.doctorCode || '');
            // if (sortBy === 'rep') return (a.representativeName || '').localeCompare(b.representativeName || '');
            return 0;
        });

    // Access Control for Export/Print
    const canExport = ['admin', 'accountant', 'lab'].includes(user?.role || '');

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{t.doctors.title}</h1>
                <div className="flex gap-2">
                    {canExport && (
                        <>
                            <button
                                onClick={() => {
                                    exportToExcel(
                                        filteredDoctors.map(doc => ({
                                            'الكود': doc.doctorCode,
                                            'اسم الطبيب': doc.name,
                                            'الهاتف': doc.phone,
                                            'هاتف 2': doc.phone2 || '-',
                                            'العنوان': doc.address,
                                            // 'المندوب': doc.representativeName || '-'
                                        })),
                                        `doctors_${new Date().toISOString().split('T')[0]} `,
                                        'الأطباء'
                                    );
                                }}
                                className="flex items-center gap-2 bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition-colors"
                                title="تصدير Excel"
                            >
                                <FileSpreadsheet size={18} />
                                <span className="hidden sm:inline">Excel</span>
                            </button>
                            <button
                                onClick={() => {
                                    generateGenericTablePDF(
                                        'قائمة الأطباء',
                                        [
                                            { header: 'الكود', key: 'code' },
                                            { header: 'اسم الطبيب', key: 'name' },
                                            { header: 'الهاتف', key: 'phone' },
                                            { header: 'العنوان', key: 'address' }
                                        ],
                                        filteredDoctors.map(doc => ({
                                            code: doc.doctorCode,
                                            name: doc.name,
                                            phone: doc.phone,
                                            address: doc.address
                                        })),
                                        DEFAULT_LAB_INFO
                                    );
                                }}
                                className="flex items-center gap-2 bg-gray-600 text-white px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                                title="طباعة"
                            >
                                <Printer size={18} />
                                <span className="hidden sm:inline">طباعة</span>
                            </button>
                        </>
                    )}
                    <button
                        onClick={openAddModal}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 dark:shadow-none"
                    >
                        <Plus size={20} />
                        <span>{t.doctors.newDoctor}</span>
                    </button>
                </div>
            </div>

            {/* Search and Sort Toolbar */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm mb-6 flex flex-col md:flex-row gap-4 border border-transparent dark:border-gray-700">
                <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={20} />
                    <input
                        type="text"
                        placeholder="بحث باسم الطبيب، الكود، أو رقم الهاتف..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        aria-label="بحث عن طبيب"
                        className="w-full pr-10 pl-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    />
                </div>
                <div className="flex items-center gap-2 min-w-[200px]">
                    <span className="text-gray-600 dark:text-gray-400 text-sm whitespace-nowrap">ترتيب حسب:</span>
                    <select
                        className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white cursor-pointer"
                        value={sortBy}
                        aria-label="ترتيب حسب"
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'name' || val === 'code' || val === 'rep') {
                                setSortBy(val);
                            }
                        }}
                    >
                        <option value="name">الاسم</option>
                        <option value="code">كود الطبيب</option>
                        {/* <option value="rep">المندوب</option> */}
                    </select>
                </div>
            </div>

            {/* Doctors Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDoctors.map((doc) => (
                    <div key={doc.id} className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow relative group">

                        {/* Edit Button (Admin or Assigned Rep) - Now anyone can edit? "everyone can see" */}
                        {/* Assuming Reps can edit doctors they work with, or just generic edit because they are 'Owners' of the relationship in their mind?? */}
                        {/* With no ownership link, maybe allow edit for all logged in users as per policy? */}
                        <button
                            onClick={() => openEditModal(doc)}
                            className="absolute top-4 left-4 p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full transition-all opacity-0 group-hover:opacity-100"
                            title="تعديل بيانات الطبيب"
                        >
                            <Edit size={18} />
                        </button>

                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg border border-blue-200 dark:border-blue-800">
                                    {doc.name.charAt(0)}
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{doc.name}</h3>
                                    <span className="text-xs bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 px-2 py-1 rounded mt-1 inline-block border border-gray-200 dark:border-gray-600">
                                        {doc.doctorCode}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                            <div className="flex items-center gap-2">
                                <Phone size={16} className="text-gray-400 dark:text-gray-500" />
                                <span dir="ltr" className="font-mono">{doc.phone}</span>
                                {doc.phone2 && <span dir="ltr" className="text-gray-400 dark:text-gray-500 text-xs block font-mono"> / {doc.phone2}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <MapPin size={16} className="text-gray-400 dark:text-gray-500" />
                                <span>{doc.address}</span>
                            </div>
                            {/* {doc.representativeName && (
                                <div className="flex items-center gap-2">
                                    <UserIcon size={16} className="text-gray-400 dark:text-gray-500" />
                                    <span>المندوب: <span className="font-semibold text-blue-600 dark:text-blue-400">{doc.representativeName}</span></span>
                                </div>
                            )} */}
                        </div>

                        {doc.customPrices && Object.keys(doc.customPrices).length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-3 text-left">أسعار خاصة (بيع)</h4>
                                <div className="flex flex-col gap-1.5">
                                    {Object.entries(doc.customPrices).map(([service, price]) => (
                                        <div key={service} className="flex justify-between items-center bg-gray-50 dark:bg-gray-800/50 px-2 py-1.5 rounded-md">
                                            <span className="text-xs font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded">{price}</span>
                                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{service}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                                {editingId ? 'تعديل بيانات الطبيب' : 'إضافة طبيب جديد'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="إغلاق">✕</button>
                        </div>

                        <form onSubmit={handleSaveDoctor} className="p-6 space-y-4">
                            {error && (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm font-bold flex items-center gap-2">
                                    <AlertTriangle size={18} />
                                    {error}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم الطبيب</label>
                                <input
                                    required
                                    type="text"
                                    aria-label="اسم الطبيب"
                                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                    value={newDoctor.name}
                                    onChange={e => {
                                        setNewDoctor({ ...newDoctor, name: e.target.value });
                                        setError(null);
                                    }}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رقم الهاتف</label>
                                    <input
                                        required
                                        type="tel"
                                        aria-label="رقم الهاتف"
                                        className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                        value={newDoctor.phone}
                                        onChange={e => setNewDoctor({ ...newDoctor, phone: e.target.value })}
                                    />
                                    <input
                                        type="tel"
                                        placeholder="رقم هاتف 2 (اختياري)"
                                        className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 mt-2 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                        value={newDoctor.phone2 || ''}
                                        aria-label="رقم هاتف إضافي"
                                        onChange={e => setNewDoctor({ ...newDoctor, phone2: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">كود الطبيب</label>
                                    <input
                                        required
                                        placeholder="مثال: AHM"
                                        type="text"
                                        aria-label="كود الطبيب"
                                        className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 uppercase dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                        value={newDoctor.doctorCode}
                                        onChange={e => {
                                            setNewDoctor({ ...newDoctor, doctorCode: e.target.value.toUpperCase() });
                                            setError(null);
                                        }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">العنوان</label>
                                <input
                                    required
                                    type="text"
                                    aria-label="العنوان"
                                    className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                    value={newDoctor.address}
                                    onChange={e => setNewDoctor({ ...newDoctor, address: e.target.value })}
                                />
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                                <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-2">أسعار بيع خاصة للطبيب</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">اترك الحقل فارغاً لاستخدام السعر الأساسي الافتراضي من القائمة.</p>
                                
                                <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                                    {services.map(service => (
                                        <div key={service.id} className="flex justify-between items-center bg-gray-50 dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-700">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{service.name}</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    placeholder="السعر الأساسي"
                                                    className="w-24 p-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                                                    value={newDoctor.customPrices[service.name] !== undefined ? newDoctor.customPrices[service.name] : ''}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setNewDoctor(prev => {
                                                            const updated = { ...prev.customPrices };
                                                            if (val === '') {
                                                                delete updated[service.name];
                                                            } else {
                                                                updated[service.name] = Number(val);
                                                            }
                                                            return { ...prev, customPrices: updated };
                                                        });
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>


                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors dark:bg-blue-600 dark:hover:bg-blue-700"
                                >
                                    {editingId ? 'حفظ التغييرات' : 'حفظ الطبيب'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
