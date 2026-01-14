import { useState, useEffect } from 'react';
import { db, type Doctor, type Order, type Service, type OrderItem, type User, type Supplier } from '../../services/db';
import { generateCaseId } from '../../utils/caseId';
import { Plus, Trash2, AlertTriangle, CheckCircle, Truck, Settings, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface OrderFormProps {
    onCancel: () => void;
    onSubmit: (order: Omit<Order, 'id'>) => void;
    initialData?: Order;
}

// Local interface for Form State (teethNumbers is string for input)
interface FormOrderItem extends Omit<OrderItem, 'teethNumbers'> {
    teethNumbers: string;
}

export default function OrderForm({ onCancel, onSubmit, initialData }: OrderFormProps) {
    const { user } = useAuth();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    // const [representatives, setRepresentatives] = useState<User[]>([]);
    const [representatives, setRepresentatives] = useState<User[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [existingOrders, setExistingOrders] = useState<Order[]>([]);

    // Doctor Search State
    const [doctorSearchTerm, setDoctorSearchTerm] = useState('');
    const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
    const [doctorId, setDoctorId] = useState(initialData?.doctorId || '');
    const [patientName, setPatientName] = useState(initialData?.patientName || '');
    const [shade, setShade] = useState(initialData?.shade || '');
    const [stlUrl, setStlUrl] = useState(initialData?.stlUrl || '');
    const [imagesUrl, setImagesUrl] = useState(initialData?.imagesUrl || '');
    const [discount, setDiscount] = useState(initialData?.discount || 0);

    // Full Add Doctor State
    const [showDoctorModal, setShowDoctorModal] = useState(false);
    const [newDoctor, setNewDoctor] = useState({
        name: '',
        phone: '',
        phone2: '',
        address: '',
        doctorCode: '',
        representativeName: '',
        representativeId: '' // Track ID
    });
    const [doctorError, setDoctorError] = useState<string | null>(null);

    const normalizeText = (text: string) => {
        if (!text) return '';
        return text
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[أإآ]/g, 'ا') // Normalize Alefs
            .replace(/ة/g, 'ه')     // Normalize Ta Marbuta
            .replace(/ى/g, 'ي');    // Normalize Ya
    };

    const handleAddDoctorFull = async () => {
        setDoctorError(null);

        try {
            // Validation: Duplicate Check
            const normalizedName = normalizeText(newDoctor.name);
            const normalizedCode = newDoctor.doctorCode.trim().toUpperCase();

            if (!normalizedName || !normalizedCode) {
                setDoctorError('يرجى ملء جميع الحقول المطلوبة');
                return;
            }

            // Create
            const doc = await db.addDoctor({
                ...newDoctor,
                name: newDoctor.name.trim(),
                doctorCode: normalizedCode
            });

            const updatedDoctors = await db.getDoctors();
            setDoctors(updatedDoctors);
            setDoctorId(doc.id);
            setShowDoctorModal(false);
            setNewDoctor({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '' });

        } catch (err: unknown) {
            console.error('Add Doctor Error:', err);
            setDoctorError('حدث خطأ غير متوقع أثناء الحفظ.');
        }
    };

    // Header Info
    // Header Info

    // Helper for default date (Today + 3 Days)
    const getDefaultDate = () => {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        return d.toISOString().split('T')[0];
    };

    const [deliveryDate, setDeliveryDate] = useState(initialData?.deliveryDate || getDefaultDate());

    const [instructions, setInstructions] = useState(initialData?.instructions || '');
    const [selectedSupplier, setSelectedSupplier] = useState(initialData?.supplierId || '');
    const [representativeId, setRepresentativeId] = useState(initialData?.representativeId || '');

    // Split Workflow State
    const [workflowType, setWorkflowType] = useState<'full' | 'split'>(initialData?.workflowType || 'full');
    const [designerId, setDesignerId] = useState(initialData?.designerId || '');

    // New Fields
    const [deliveryType, setDeliveryType] = useState<'Final' | 'TryIn'>(initialData?.deliveryType || 'Final');
    const [needsDesignReview, setNeedsDesignReview] = useState(initialData?.needsDesignReview || false);
    const [isUrgent, setIsUrgent] = useState(initialData?.isUrgent || false);

    // Backdating Support
    const [receivedDate, setReceivedDate] = useState(initialData?.createdAt ? new Date(initialData.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    // Items
    const [items, setItems] = useState<FormOrderItem[]>(initialData?.items && initialData.items.length > 0 ? initialData.items.map(i => ({
        serviceType: i.serviceType,
        teethNumbers: Array.isArray(i.teethNumbers) ? i.teethNumbers.join(',') : i.teethNumbers,
        price: i.price
    })) : [
        { serviceType: '', teethNumbers: '', price: 0 }
    ]);



    useEffect(() => {
        const loadData = async () => {
            try {
                const [doctorsData, servicesData, suppliersData, usersData, ordersData] = await Promise.all([
                    db.getDoctors(),
                    Promise.resolve(db.getServices()),
                    Promise.resolve(db.getSuppliers()),
                    Promise.resolve(db.getUsers()),
                    db.getOrders()
                ]);
                setDoctors(doctorsData);
                // Sort services Z-A (descending) as requested
                setServices(servicesData.sort((a, b) => b.name.localeCompare(a.name)));

                // Default Service Logic: Use the first sorted service for the initial empty item
                if (!initialData && servicesData.length > 0) {
                    const defaultService = servicesData[0].name;
                    setItems(prevItems => prevItems.map(item =>
                        item.serviceType === '' ? { ...item, serviceType: defaultService } : item
                    ));
                }

                setSuppliers(suppliersData);
                // setRepresentatives(usersData.filter(u => u.role === 'representative'));
                setSuppliers(suppliersData);
                setRepresentatives(usersData.filter(u => u.role === 'representative' || (u.role === 'admin' && u.username !== 'admin')));
                setDesigners(usersData.filter(u => u.role === 'designer'));
                setExistingOrders(ordersData);
            } catch (error) {
                console.error('Error loading form data:', error);
            }
        };
        loadData();
    }, [initialData]);
    const handleRemoveItem = (index: number) => {
        if (items.length > 1) {
            const newItems = [...items];
            newItems.splice(index, 1);
            setItems(newItems);
        }
    };

    const handleAddItem = () => {
        if (services.length > 0) {
            setItems([...items, { serviceType: services[0].name, teethNumbers: '', price: 0 }]);
        } else {
            setItems([...items, { serviceType: '', teethNumbers: '', price: 0 }]);
        }
    };

    const updateItem = (index: number, field: keyof FormOrderItem, value: FormOrderItem[keyof FormOrderItem]) => {
        const newItems = [...items];
        const currentItem = { ...newItems[index], [field]: value };
        newItems[index] = currentItem;
        setItems(newItems);
    };

    // Calculate Total
    const subTotal = items.reduce((sum, item) => {
        const count = item.teethNumbers ? item.teethNumbers.split(',').length : 0;
        const svc = services.find(s => s.name === item.serviceType);
        const unitPrice = svc ? svc.sellingPrice : 0;
        const lineTotal = count * unitPrice;
        return sum + lineTotal;
    }, 0);

    const total = subTotal - discount;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!doctorId) {
            alert('يرجى اختيار الطبيب');
            return;
        }

        // Validate Items
        const invalidItems = items.filter(i => {
            const validTeeth = i.teethNumbers.split(/[\s,]+/).filter(t => t.trim().length > 0);
            return validTeeth.length === 0;
        });

        if (invalidItems.length > 0) {
            alert('يرجى إدخال أرقام الأسنان بشكل صحيح لكل البنود (مثال: 11, 21)');
            return;
        }

        const doc = doctors.find(d => d.id === doctorId);



        // Calculate Cost based on Workflow
        let calculatedCost = 0;
        if (workflowType === 'full') {
            // Full Outsource (Supplier) or Internal (Default Cost)
            calculatedCost = items.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.split(',').length : 0;
                const svc = services.find(s => s.name === item.serviceType);

                let unitCost = svc ? svc.costPrice : 0;
                // If Outsource, check if Supplier has custom price
                if (selectedSupplier) {
                    const sup = suppliers.find(s => s.id === selectedSupplier);
                    if (sup && sup.customPrices && sup.customPrices[item.serviceType]) {
                        unitCost = sup.customPrices[item.serviceType];
                    }
                }
                return sum + (unitCost * count);
            }, 0);
        } else {
            // Split Workflow: Designer Cost + Milling Cost
            const designer = designers.find(d => d.id === designerId);
            const designerRate = designer?.unitRate || 0;

            const sup = suppliers.find(s => s.id === selectedSupplier);

            calculatedCost = items.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.split(',').length : 0;
                const svc = services.find(s => s.name === item.serviceType);

                // Designer Cost
                const dCost = designerRate * count;

                // Milling Cost
                let mCost = 0;
                if (sup && sup.millingPrices && sup.millingPrices[item.serviceType]) {
                    mCost = sup.millingPrices[item.serviceType] * count;
                } else if (svc) {
                    // Fallback to default cost if no milling price set (approximate)
                    mCost = (svc.costPrice * 0.5) * count;
                }

                return sum + dCost + mCost;
            }, 0);
        }

        // Calculate Design Price separately for tracking
        let totalDesignPrice = 0;
        if (workflowType === 'split') {
            const designer = designers.find(d => d.id === designerId);
            const designerRate = designer?.unitRate || 0;
            totalDesignPrice = items.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.split(',').length : 0;
                return sum + (designerRate * count);
            }, 0);
        }

        onSubmit({
            caseId: initialData?.caseId || (doc ? generateCaseId(doc.doctorCode, existingOrders) : 'UNKNOWN'),
            doctorId,
            patientName,
            items: items.map(i => ({
                ...i,
                teethNumbers: i.teethNumbers.split(',').map(s => s.trim()).filter(Boolean)
            })),
            shade,
            instructions: instructions || undefined,
            stlUrl: stlUrl || undefined,
            imagesUrl: imagesUrl || undefined,
            status: initialData?.status || 'New Case',
            technicianStatus: initialData?.technicianStatus || 'Pending',
            deliveryDate,
            createdAt: new Date(receivedDate).toISOString(),

            totalPrice: total,
            cost: calculatedCost,
            workflowType,
            designerId: workflowType === 'split' ? designerId : undefined,
            designStatus: workflowType === 'split' ? 'pending' : undefined,
            designPrice: workflowType === 'split' ? totalDesignPrice : 0,
            discount,
            priority: isUrgent ? 'Urgent' : 'Normal',
            deliveryType,
            needsDesignReview,
            isUrgent,
            supplierId: selectedSupplier || undefined,

            representativeId: representativeId || undefined,
            comments: initialData?.comments || []
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">

            {/* 1. TOP BAR: Date & Urgency */}
            <div className={`p-4 rounded-2xl border transition-all ${isUrgent ? 'bg-red-50 border-red-200 shadow-red-100' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100 shadow-blue-100'} shadow-sm`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${isUrgent ? 'bg-red-600 text-white' : 'bg-white text-blue-600'}`}>
                            {isUrgent ? <AlertTriangle size={24} className="animate-pulse" /> : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            )}
                        </div>
                        <div>
                            <label className={`block text-sm font-bold ${isUrgent ? 'text-red-900' : 'text-blue-900'}`}>تاريخ استلام الطلب</label>
                            <input
                                type="date"
                                required
                                aria-label="تاريخ الاستلام"
                                className={`bg-transparent font-mono font-bold text-lg outline-none ${isUrgent ? 'text-red-700' : 'text-blue-700'}`}
                                value={receivedDate}
                                onChange={(e) => setReceivedDate(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Urgent Toggle */}
                    <div className="flex items-center gap-2">
                        {/* Representative Dropdown (Moved Here) */}
                        <div className="relative">
                            <select
                                className="appearance-none bg-white border border-blue-200 text-blue-800 text-sm font-bold py-2.5 px-4 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm hover:border-blue-300"
                                aria-label="المندوب"
                                value={representativeId}
                                onChange={(e) => setRepresentativeId(e.target.value)}
                                disabled={user?.role === 'representative'}
                            >
                                <option value="">-- المندوب --</option>
                                {representatives.map(rep => (
                                    <option key={rep.id} value={rep.id}>{rep.name}</option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-blue-500">
                                <UserIcon size={14} />
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setIsUrgent(!isUrgent)}
                            className={`cursor-pointer px-4 py-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isUrgent ? 'bg-red-600 border-red-600 text-white shadow-lg shadow-red-200 scale-105' : 'bg-white border-gray-200 text-gray-500 hover:border-red-300'}`}
                        >
                            <AlertTriangle size={20} className={isUrgent ? 'animate-bounce' : ''} />
                            <span className="font-bold hidden sm:inline">{isUrgent ? 'مستعجل جداً' : 'مستعجل'}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* 2. Patient & Doctor Info (Left Column) */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Patient Card */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4 relative">
                        <div className="absolute top-0 right-0 w-1 h-full bg-blue-500"></div>
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <UserIcon size={20} className="text-blue-500" />
                            بيانات المريض والطبيب
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Doctor Select */}
                            <div className="relative z-20">
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">الطبيب المعالج</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        required
                                        aria-label="بحث عن طبيب"
                                        placeholder="ابحث باسم الطبيب أو الكود..."
                                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-semibold"
                                        value={doctorSearchTerm}
                                        onChange={(e) => {
                                            setDoctorSearchTerm(e.target.value);
                                            setIsDoctorDropdownOpen(true);
                                            if (!e.target.value) setDoctorId('');
                                        }}
                                        onFocus={() => setIsDoctorDropdownOpen(true)}
                                        disabled={!!initialData}
                                    />
                                    <Plus
                                        size={18}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 cursor-pointer hover:bg-blue-100 rounded p-0.5"
                                        onClick={() => setShowDoctorModal(true)}
                                    />

                                    {/* Dropdown */}
                                    {isDoctorDropdownOpen && !initialData && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl max-h-60 overflow-y-auto z-50">
                                            {doctors.filter(doc =>
                                                doc.name.toLowerCase().includes(doctorSearchTerm.toLowerCase()) ||
                                                doc.doctorCode.toLowerCase().includes(doctorSearchTerm.toLowerCase())
                                            ).length > 0 ? (
                                                doctors.filter(doc =>
                                                    doc.name.toLowerCase().includes(doctorSearchTerm.toLowerCase()) ||
                                                    doc.doctorCode.toLowerCase().includes(doctorSearchTerm.toLowerCase())
                                                ).map(doc => (
                                                    <div
                                                        key={doc.id}
                                                        className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0"
                                                        onClick={() => {
                                                            setDoctorId(doc.id);
                                                            setDoctorSearchTerm(doc.name);
                                                            setIsDoctorDropdownOpen(false);
                                                        }}
                                                    >
                                                        <div className="font-bold text-gray-800">{doc.name}</div>
                                                        <div className="text-xs text-gray-500 flex justify-between mt-1">
                                                            <span className="bg-gray-100 px-1.5 rounded">{doc.doctorCode}</span>
                                                            <span>{doc.phone}</span>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="p-4 text-center">
                                                    <p className="text-sm text-gray-500 mb-2">طبيب غير موجود</p>
                                                    <button type="button" onClick={() => setShowDoctorModal(true)} className="text-blue-600 text-sm font-bold hover:underline">إضافة طبيب جديد</button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Patient Name */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">اسم المريض</label>
                                <input
                                    type="text"
                                    required
                                    aria-label="اسم المريض"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-semibold"
                                    value={patientName}
                                    onChange={(e) => setPatientName(e.target.value)}
                                    placeholder="الاسم الثلاثي"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Case Details Card */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-1 h-full bg-indigo-500"></div>
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <span className="bg-indigo-100 p-1 rounded-lg text-indigo-600"><CheckCircle size={18} /></span>
                                تفاصيل التركيبة (Items)
                            </h3>
                            <button
                                type="button"
                                onClick={handleAddItem}
                                className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-100 transition-colors flex items-center gap-1"
                            >
                                <Plus size={14} /> إضافة صنف
                            </button>
                        </div>

                        {/* Items Table-like Grid */}
                        <div className="space-y-3">
                            {items.map((item, index) => (
                                <div key={index} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-gray-50 p-3 rounded-xl border border-gray-100 group hover:border-indigo-200 transition-colors">
                                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center font-bold text-gray-400 text-xs shadow-sm border border-gray-100">
                                        {index + 1}
                                    </div>

                                    <div className="flex-1 w-full sm:w-auto">
                                        <select
                                            className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                            value={item.serviceType}
                                            onChange={(e) => updateItem(index, 'serviceType', e.target.value)}
                                            aria-label="نوع الخدمة"
                                        >
                                            {services.map(s => (
                                                <option key={s.id} value={s.name}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex-[2] w-full sm:w-auto">
                                        <input
                                            type="text"
                                            className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none placeholder:text-gray-400 text-left ltr"
                                            placeholder="Teeth Numbers (e.g. 11, 21)"
                                            value={item.teethNumbers}
                                            onChange={(e) => updateItem(index, 'teethNumbers', e.target.value)}
                                        />
                                    </div>

                                    {items.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveItem(index)}
                                            className="text-gray-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                            aria-label="حذف"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Shade & Instructions */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">اللون (Shade)</label>
                                <input
                                    type="text"
                                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={shade}
                                    onChange={(e) => setShade(e.target.value)}
                                    placeholder="A1, A2..."
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">رابط الديجيتال (STL URL)</label>
                                <input
                                    type="url"
                                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ltr text-left text-sm text-blue-600 underline"
                                    placeholder="https://..."
                                    value={stlUrl}
                                    onChange={(e) => setStlUrl(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Images Link */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">رابط صور الحالة (اختياري)</label>
                            <input
                                type="url"
                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ltr text-left text-sm text-green-600 underline"
                                placeholder="https://drive.google.com/... أو أي رابط صور"
                                value={imagesUrl}
                                onChange={(e) => setImagesUrl(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">ملاحظات فنية</label>
                            <textarea
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none h-20 resize-none text-sm"
                                placeholder="تعليمات هامة للمعمل..."
                                aria-label="ملاحظات فنية"
                                value={instructions}
                                onChange={(e) => setInstructions(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* 3. Delivery & Workflow (Right Column) */}
                <div className="space-y-6">
                    {/* Delivery Info */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-1 h-full bg-green-500"></div>
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <span className="bg-green-100 p-1 rounded-lg text-green-600"><Truck size={18} /></span>
                            معلومات التسليم
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">تاريخ التسليم المتوقع</label>
                                <input
                                    type="date"
                                    required
                                    aria-label="تاريخ التسليم"
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none font-bold text-gray-700"
                                    value={deliveryDate}
                                    onChange={(e) => setDeliveryDate(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">نوع التسليم</label>
                                <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1 rounded-xl">
                                    <button
                                        type="button"
                                        onClick={() => setDeliveryType('Final')}
                                        className={`py-2 rounded-lg text-sm font-bold transition-all ${deliveryType === 'Final' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        Final
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDeliveryType('TryIn')}
                                        className={`py-2 rounded-lg text-sm font-bold transition-all ${deliveryType === 'TryIn' ? 'bg-white text-orange-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        Try-In
                                    </button>
                                </div>
                            </div>

                            {/* Design Review Checkbox */}
                            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${needsDesignReview ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-transparent hover:bg-gray-100'}`}>
                                <input
                                    type="checkbox"
                                    className="mt-1 w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                    checked={needsDesignReview}
                                    onChange={(e) => setNeedsDesignReview(e.target.checked)}
                                />
                                <div>
                                    <span className={`block text-sm font-bold ${needsDesignReview ? 'text-orange-800' : 'text-gray-600'}`}>مراجعة التصميم</span>
                                    <span className="text-xs text-gray-400">إرسال صور التصميم قبل التنفيذ</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Workflow Settings */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-1 h-full bg-purple-500"></div>
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <span className="bg-purple-100 p-1 rounded-lg text-purple-600"><Settings size={18} /></span>
                            نظام العمل (Workflow)
                        </h3>

                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setWorkflowType('full')}
                                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-bold transition-all ${workflowType === 'full' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-500'}`}
                                >
                                    شغل كامل
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setWorkflowType('split')}
                                    className={`flex-1 py-2 px-3 rounded-xl border text-sm font-bold transition-all ${workflowType === 'split' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-500'}`}
                                >
                                    تجزئة (Split)
                                </button>
                            </div>

                            {workflowType === 'split' && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <select
                                        className="w-full p-2 bg-purple-50/50 border border-purple-100 rounded-lg text-sm"
                                        value={designerId}
                                        aria-label="اختر المصمم"
                                        onChange={e => setDesignerId(e.target.value)}
                                    >
                                        <option value="">اختر المصمم...</option>
                                        {designers.map(d => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                        ))}
                                    </select>
                                    <select
                                        className="w-full p-2 bg-purple-50/50 border border-purple-100 rounded-lg text-sm"
                                        value={selectedSupplier}
                                        aria-label="اختر المعمل"
                                        onChange={e => setSelectedSupplier(e.target.value)}
                                    >
                                        <option value="">اختر معمل الخراطة...</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {workflowType === 'full' && (
                                <select
                                    className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                                    value={selectedSupplier}
                                    aria-label="اختر المعمل الخارجي"
                                    onChange={(e) => setSelectedSupplier(e.target.value)}
                                >
                                    <option value="">-- معمل داخلي / Outsource --</option>
                                    {suppliers.map(sup => (
                                        <option key={sup.id} value={sup.id}>{sup.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 4. Representative (REMOVED - Moved to Top) */}

            {/* Footer Info & Actions */}
            <div className="flex items-center justify-between pt-6 border-t mt-8">
                <div>
                    <span className="block text-xs text-gray-500 font-bold uppercase mb-1">الإجمالي التقديري</span>
                    <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-blue-600">{total.toLocaleString()} <span className="text-sm text-gray-400">ج.م</span></span>

                        {/* Discount Field */}
                        <div className="flex flex-col">
                            <label className="text-[10px] text-gray-400 font-bold uppercase">خصم</label>
                            <input
                                type="number"
                                min="0"
                                className="w-20 p-1 border border-gray-200 rounded text-sm text-center focus:ring-1 focus:ring-blue-500 outline-none"
                                value={discount}
                                onChange={(e) => setDiscount(Number(e.target.value))}
                                placeholder="0"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-6 py-3 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        إلغاء
                    </button>
                    <button
                        type="submit"
                        className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 hover:shadow-blue-300 transform hover:-translate-y-1"
                    >
                        {initialData ? 'حفظ التعديلات' : 'إنشاء الأوردر'}
                    </button>
                </div>
            </div>

            {/* Doctor Modal */}
            {
                showDoctorModal && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <h2 className="text-xl font-bold text-gray-800">إضافة طبيب جديد</h2>
                                <button onClick={() => setShowDoctorModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors">✕</button>
                            </div>

                            <div className="p-6 space-y-4">
                                {doctorError && (
                                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-bold flex items-center gap-2">
                                        <AlertTriangle size={18} />
                                        {doctorError}
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">اسم الطبيب</label>
                                    <input
                                        required
                                        type="text"
                                        aria-label="اسم الطبيب"
                                        className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={newDoctor.name}
                                        onChange={e => {
                                            setNewDoctor({ ...newDoctor, name: e.target.value });
                                            setDoctorError(null);
                                        }}
                                        placeholder="د. ..."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                                        <input
                                            required
                                            type="tel"
                                            aria-label="رقم الهاتف"
                                            className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={newDoctor.phone}
                                            onChange={e => setNewDoctor({ ...newDoctor, phone: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">كود الطبيب</label>
                                        <input
                                            required
                                            placeholder="مثال: AHM"
                                            type="text"
                                            aria-label="كود الطبيب"
                                            className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none uppercase font-mono"
                                            value={newDoctor.doctorCode}
                                            onChange={e => {
                                                setNewDoctor({ ...newDoctor, doctorCode: e.target.value.toUpperCase() });
                                                setDoctorError(null);
                                            }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">العنوان</label>
                                    <input
                                        required
                                        type="text"
                                        aria-label="العنوان"
                                        className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={newDoctor.address}
                                        onChange={e => setNewDoctor({ ...newDoctor, address: e.target.value })}
                                    />
                                </div>

                                <div className="pt-4 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowDoctorModal(false)}
                                        className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 bg-white text-gray-700 font-bold"
                                    >
                                        إلغاء
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAddDoctorFull}
                                        className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-200"
                                    >
                                        حفظ الطبيب
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </form >
    );
}
