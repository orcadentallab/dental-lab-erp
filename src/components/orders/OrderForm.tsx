/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState, useEffect } from 'react';
import { db, type Doctor, type Order, type Service, type OrderItem, type User, type Supplier } from '../../services/db';
import { generateCaseId } from '../../utils/caseId';
import { Plus, Trash2, AlertTriangle, Truck, Settings, Link as LinkIcon, Box, DollarSign, X, CheckCircle, Image, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TeethTagsInput } from '../ui/TeethTagsInput';
import clsx from 'clsx';

interface OrderFormProps {
    onCancel: () => void;
    onSubmit: (order: Omit<Order, 'id'>) => any;
    initialData?: Order;
}

interface FormOrderItem extends Omit<OrderItem, 'teethNumbers'> {
    teethNumbers: string[]; // Changed to array for tags input
    customPrice?: number; // Override price for this order only
}

import { DoctorSelect } from './DoctorSelect';

export default function OrderForm({ onCancel, onSubmit, initialData }: OrderFormProps) {
    const { user } = useAuth();
    const { error: toastError } = useToast();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [representatives, setRepresentatives] = useState<User[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    // removed: existingOrders state


    // const [doctorSearchTerm, setDoctorSearchTerm] = useState(''); // REPLACED BY DOCTOR SELECT
    // const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false); // REPLACED BY DOCTOR SELECT
    const [doctorId, setDoctorId] = useState(initialData?.doctorId || '');
    const [patientName, setPatientName] = useState(initialData?.patientName || '');
    const [shade, setShade] = useState(initialData?.shade || '');
    const [stlUrl, setStlUrl] = useState(initialData?.stlUrl || '');
    const [imagesUrl, setImagesUrl] = useState(initialData?.imagesUrl || '');
    const [discount, setDiscount] = useState(initialData?.discount || 0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Full Add Doctor State
    const [showDoctorModal, setShowDoctorModal] = useState(false);
    const [newDoctor, setNewDoctor] = useState({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '' });
    const [doctorError, setDoctorError] = useState<string | null>(null);

    const normalizeText = (text: string) => text ? text.toString().trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') : '';

    const handleAddDoctorFull = async () => {
        setDoctorError(null);
        try {
            const normalizedName = normalizeText(newDoctor.name);
            const normalizedCode = newDoctor.doctorCode.trim().toUpperCase();

            if (!normalizedName || !normalizedCode) {
                setDoctorError('يرجى ملء جميع الحقول المطلوبة');
                return;
            }

            const doc = await db.addDoctor({ ...newDoctor, name: newDoctor.name.trim(), doctorCode: normalizedCode });
            const updatedDoctors = await db.getDoctors();
            setDoctors(updatedDoctors);
            setDoctorId(doc.id);
            // setDoctorSearchTerm(doc.name); removed
            setShowDoctorModal(false);
            setNewDoctor({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '' });
        } catch (err) {
            console.error('Add Doctor Error:', err);
            setDoctorError('حدث خطأ غير متوقع أثناء الحفظ.');
        }
    };

    const getDefaultDate = () => {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        return d.toISOString().split('T')[0];
    };

    const [deliveryDate, setDeliveryDate] = useState(initialData?.deliveryDate || getDefaultDate());
    const [instructions, setInstructions] = useState(initialData?.instructions || '');
    const [selectedSupplier, setSelectedSupplier] = useState(initialData?.supplierId || '');
    const [representativeId, setRepresentativeId] = useState(initialData?.representativeId || '');

    const [workflowType, setWorkflowType] = useState<'full' | 'split'>(initialData?.workflowType || 'full');
    const [designerId, setDesignerId] = useState(initialData?.designerId || '');

    const [deliveryType, setDeliveryType] = useState<'Final' | 'TryIn'>(initialData?.deliveryType || 'Final');
    const [isUrgent, setIsUrgent] = useState(initialData?.isUrgent || false);
    const [receivedDate, setReceivedDate] = useState(initialData?.createdAt ? new Date(initialData.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    const [manualCost, setManualCost] = useState<number | null>(initialData?.cost ?? null);
    const isAdmin = user?.role === 'admin';

    const [items, itemsSet] = useState<FormOrderItem[]>(initialData?.items && initialData.items.length > 0 ? initialData.items.map(i => ({
        serviceType: i.serviceType,
        teethNumbers: Array.isArray(i.teethNumbers) ? i.teethNumbers : (typeof i.teethNumbers === 'string' ? (i.teethNumbers as string).split(',') : []),
        price: i.price,
        customPrice: undefined
    })) : [{ serviceType: '', teethNumbers: [], price: 0 }]);

    const setItems = (newItems: FormOrderItem[]) => itemsSet(newItems);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [doctorsData, servicesData, suppliersData, usersData] = await Promise.all([
                    db.getDoctors(),
                    db.getServices(),
                    db.getSuppliers(),
                    db.getUsers(),
                    // removed: db.getAllOrdersUnpaginated()

                ]);
                setDoctors(doctorsData);
                const sortedServices = servicesData.sort((a, b) => b.name.localeCompare(a.name));
                setServices(sortedServices);

                if (!initialData && servicesData.length > 0) {
                    setItems(items.map(i => i.serviceType === '' ? { ...i, serviceType: sortedServices[0].name } : i));
                }

                if (initialData && initialData.doctorId) {
                    // const doc = doctorsData.find(d => d.id === initialData.doctorId);
                    // if (doc) setDoctorSearchTerm(doc.name);
                }

                setSuppliers(suppliersData);
                setRepresentatives(usersData.filter(u => u.role === 'representative' || (u.role === 'admin' && u.username !== 'admin')));
                setDesigners(usersData.filter(u => u.role === 'designer'));

                // Auto-set representativeId for representatives creating new orders
                if (!initialData && user?.role === 'representative') {
                    const currentRep = usersData.find(u => u.id === user.id);
                    if (currentRep) {
                        setRepresentativeId(currentRep.id);
                    }
                }
                // removed: setExistingOrders(ordersData);

            } catch (error) {
                console.error('Error loading form data:', error);
            }
        };
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- items is intentionally excluded to prevent re-fetching on each item change
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
            setItems([...items, { serviceType: services[0].name, teethNumbers: [], price: 0 }]);
        } else {
            setItems([...items, { serviceType: '', teethNumbers: [], price: 0 }]);
        }
    };

    const updateItem = (index: number, field: keyof FormOrderItem, value: string | number) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    const subTotal = items.reduce((sum, item) => {
        const count = item.teethNumbers ? item.teethNumbers.length : 0;
        const svc = services.find(s => s.name === item.serviceType);
        // Use custom price if set, else service price, else fallback to stored item price
        const unitPrice = item.customPrice !== undefined ? item.customPrice : (svc ? svc.sellingPrice : (item.price || 0));
        return sum + (count * unitPrice);
    }, 0);

    const total = subTotal - discount;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        if (!doctorId) {
            toastError('يرجى اختيار الطبيب');
            return;
        }



        const invalidItems = items.filter(i => i.teethNumbers.length === 0);
        if (invalidItems.length > 0) {
            toastError('يرجى إدخال أرقام الأسنان بشكل صحيح');
            return;
        }

        const doc = doctors.find(d => d.id === doctorId);

        let calculatedCost = 0;
        if (workflowType === 'full') {
            calculatedCost = items.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.length : 0;
                const svc = services.find(s => s.name === item.serviceType);
                let unitCost = svc ? svc.costPrice : 0;
                if (selectedSupplier) {
                    const sup = suppliers.find(s => s.id === selectedSupplier);
                    if (sup?.customPrices?.[item.serviceType] !== undefined) unitCost = sup.customPrices[item.serviceType];
                }
                return sum + (unitCost * count);
            }, 0);
        } else {
            const designer = designers.find(d => d.id === designerId);
            const sup = suppliers.find(s => s.id === selectedSupplier);
            calculatedCost = items.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.length : 0;
                const svc = services.find(s => s.name === item.serviceType);
                const dCost = (designer?.unitRate || 0) * count;
                let mCost = 0;
                if (sup?.millingPrices?.[item.serviceType] !== undefined) mCost = sup.millingPrices[item.serviceType] * count;
                else if (svc) mCost = (svc.costPrice * 0.5) * count;
                return sum + dCost + mCost;
            }, 0);
        }

        let totalDesignPrice = 0;
        if (workflowType === 'split') {
            const designer = designers.find(d => d.id === designerId);
            const designerRate = designer?.unitRate || 0;
            totalDesignPrice = items.reduce((sum, item) => {
                const count = item.teethNumbers ? item.teethNumbers.length : 0;
                return sum + (designerRate * count);
            }, 0);
        }

        setIsSubmitting(true);
        try {
            await onSubmit({
                caseId: initialData?.caseId || (doc ? generateCaseId(doc.doctorCode) : 'UNKNOWN'),
                doctorId,
                patientName,
                items: items.map(i => ({ ...i, teethNumbers: i.teethNumbers })),
                shade,
                instructions: instructions || undefined,
                stlUrl: stlUrl || undefined,
                imagesUrl: imagesUrl || undefined,
                status: initialData?.status || 'New Case',
                technicianStatus: initialData?.technicianStatus || 'Pending',
                deliveryDate,
                createdAt: new Date(receivedDate).toISOString(),
                totalPrice: total,
                cost: (isAdmin && manualCost !== null) ? manualCost : calculatedCost,
                workflowType,
                designerId: workflowType === 'split' ? designerId : undefined,
                designStatus: workflowType === 'split' ? 'pending' : undefined,
                designPrice: workflowType === 'split' ? totalDesignPrice : 0,
                discount,
                priority: isUrgent ? 'Urgent' : 'Normal',
                deliveryType,
                needsDesignReview: initialData?.needsDesignReview || false,
                isUrgent,
                supplierId: selectedSupplier || undefined,
                representativeId: representativeId || undefined,
                comments: initialData?.comments || []
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-right font-sans max-w-7xl mx-auto">
            {/* Header / Top Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <h2 className="text-lg sm:text-xl font-bold text-surface-800 dark:text-surface-100 flex items-center gap-2">
                    <Box className="text-primary-600" />
                    {initialData ? 'تعديل بيانات الأوردر' : 'إنشاء أوردر جديد'}
                </h2>
                <div className="flex gap-2 w-full sm:w-auto">
                    <Button type="button" variant="ghost" disabled={isSubmitting} className="text-surface-500 flex-1 sm:flex-initial" onClick={onCancel}>
                        <span>إلغاء</span>
                    </Button>
                    <Button type="submit" size="md" disabled={isSubmitting} className="px-6 sm:px-8 shadow-lg shadow-primary-500/20 flex-1 sm:flex-initial">
                        <span>{isSubmitting ? 'جاري الحفظ...' : (initialData ? 'حفظ التعديلات' : 'تأكيد الأوردر')}</span>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

                {/* LEFT COLUMN: Main Inputs (8) */}
                <div className="lg:col-span-8 space-y-4">

                    {/* 1. Patient & Doctor Info (Horizontal Dense) */}
                    <Card className="p-4 bg-white dark:bg-surface-800">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                            {/* Doctor (5 cols) */}
                            <div className="md:col-span-5 relative">
                                <label className="block text-xs font-bold text-surface-500 mb-1 ml-1">الطبيب المعالج</label>
                                <div className="flex gap-1">
                                    <div className="flex-1">
                                        <DoctorSelect
                                            value={doctorId}
                                            onChange={(id) => setDoctorId(id)}
                                            error={!doctorId ? 'مطلوب' : undefined}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowDoctorModal(true)}
                                        aria-label="Add New Doctor"
                                        className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-100 transition-colors"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* Patient (5 cols) */}
                            <div className="md:col-span-4">
                                <label className="block text-xs font-bold text-surface-500 mb-1 ml-1">اسم المريض</label>
                                <Input
                                    className="py-2 text-sm font-bold"
                                    placeholder="اسم المريض..."
                                    value={patientName}
                                    onChange={(e) => setPatientName(e.target.value)}
                                />
                            </div>

                            {/* Shade (2 cols) */}
                            <div className="md:col-span-3">
                                <label className="block text-xs font-bold text-surface-500 mb-1 ml-1">اللون (Shade)</label>
                                <Input
                                    className="py-2 text-sm text-center font-bold"
                                    placeholder="A1"
                                    value={shade}
                                    onChange={(e) => setShade(e.target.value)}
                                />
                            </div>
                        </div>
                    </Card>

                    {/* 2. Items List */}
                    <Card className="p-4 min-h-[14rem] relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-1 h-full bg-indigo-500"></div>
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-surface-700 flex items-center gap-2 text-sm">
                                <span className="p-1 bg-indigo-50 text-indigo-600 rounded-lg"><Box size={16} /></span>
                                قائمة الأصناف المطلوبة
                            </h3>
                            <Button size="sm" variant="secondary" onClick={handleAddItem} className="h-8 text-xs gap-1">
                                <Plus size={14} /> إضافة صنف
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {items.map((item, index) => {
                                const svc = services.find(s => s.name === item.serviceType);
                                const displayPrice = item.customPrice !== undefined ? item.customPrice : (svc?.sellingPrice || 0);
                                return (
                                    <div key={index} className="flex gap-2 items-center bg-surface-50/50 p-1.5 rounded-xl border border-surface-100 group hover:border-indigo-200 transition-colors">
                                        <div className="w-6 h-6 rounded bg-white flex items-center justify-center font-bold text-surface-400 text-xs shadow-sm border border-surface-100 shrink-0">
                                            {index + 1}
                                        </div>
                                        <div className="w-1/4">
                                            <select
                                                title="Service Type"
                                                aria-label="Select Service Type"
                                                className="w-full bg-transparent font-bold text-sm outline-none text-surface-800 cursor-pointer"
                                                value={item.serviceType}
                                                onChange={(e) => updateItem(index, 'serviceType', e.target.value)}
                                            >
                                                {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <TeethTagsInput
                                                value={item.teethNumbers}
                                                onChange={(teeth) => {
                                                    const newItems = [...items];
                                                    newItems[index] = { ...newItems[index], teethNumbers: teeth };
                                                    setItems(newItems);
                                                }}
                                                placeholder="أدخل رقم السن..."
                                            />
                                        </div>
                                        {/* Price column - Admin only */}
                                        {user?.role === 'admin' && (
                                            <div className="w-20 border-r border-surface-200 pr-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="w-full bg-white border border-surface-200 rounded px-2 py-1 text-xs font-bold text-center outline-none focus:ring-1 focus:ring-primary-500"
                                                    value={displayPrice}
                                                    onChange={(e) => {
                                                        const newItems = [...items];
                                                        newItems[index] = { ...newItems[index], customPrice: Number(e.target.value) };
                                                        setItems(newItems);
                                                    }}
                                                    title="سعر الوحدة"
                                                />
                                            </div>
                                        )}
                                        {items.length > 1 && (
                                            <button onClick={() => handleRemoveItem(index)} aria-label="Remove Item" className="p-1.5 text-surface-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    {/* 3. Notes & STL */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card className="p-4 bg-surface-50 border-dashed border-surface-200">
                            <label className="block text-xs font-bold text-surface-500 mb-2 flex items-center gap-1"><LinkIcon size={12} /> رابط ملف STL</label>
                            <div className="relative">
                                <Input value={stlUrl} onChange={(e) => setStlUrl(e.target.value)} placeholder="https://..." className="text-xs py-2 font-mono text-blue-600 pl-8" />
                                <LinkIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                            </div>
                            <label className="block text-xs font-bold text-surface-500 my-2 flex items-center gap-1"><Image size={12} /> رابط الصور</label>
                            <div className="relative">
                                <Input value={imagesUrl} onChange={(e) => setImagesUrl(e.target.value)} placeholder="https://..." className="text-xs py-2 font-mono text-blue-600 pl-8" />
                                <LinkIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                            </div>
                        </Card>
                        <Card className="p-0 overflow-hidden">
                            <textarea
                                className="w-full h-full p-3 bg-white text-sm outline-none resize-none min-h-[5rem]"
                                placeholder="ملاحظات فنية إضافية للمعمل..."
                                value={instructions}
                                onChange={(e) => setInstructions(e.target.value)}
                            />
                        </Card>
                    </div>
                </div>

                {/* RIGHT COLUMN: Sidebar (4) */}
                <div className="lg:col-span-4 space-y-4">

                    {/* Urgency & Receive Date */}
                    <Card className={clsx("p-4 border-2 transition-colors", isUrgent ? "border-red-100 bg-red-50/30" : "border-surface-100 bg-white")}>
                        <div className="flex justify-between items-center mb-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <div className={clsx("w-5 h-5 rounded border flex items-center justify-center transition-colors", isUrgent ? "bg-red-500 border-red-500 text-white" : "bg-white border-surface-300")}>
                                    {isUrgent && <CheckCircle size={12} />}
                                </div>
                                <input type="checkbox" className="hidden" checked={isUrgent} onChange={() => setIsUrgent(!isUrgent)} />
                                <span className={clsx("text-sm font-bold", isUrgent ? "text-red-700" : "text-surface-600")}>طلب مستعجل</span>
                            </label>
                            {isUrgent && <AlertTriangle size={18} className="text-red-500 animate-pulse" />}
                        </div>

                        <div className="space-y-2">
                            <div>
                                <label className="text-[10px] font-bold text-surface-400 block mb-1">تاريخ استلام العمل</label>
                                <input
                                    title="Received Date"
                                    aria-label="Received Date"
                                    type="date"
                                    className="w-full p-2 bg-white border border-surface-200 rounded-lg text-sm font-bold outline-none focus:ring-1 focus:ring-primary-500"
                                    value={receivedDate}
                                    onChange={(e) => setReceivedDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-surface-400 block mb-1">المندوب المستلم</label>
                                <select
                                    title="Representative"
                                    aria-label="Select Representative"
                                    className="w-full p-2 bg-white border border-surface-200 rounded-lg text-sm outline-none"
                                    value={representativeId}
                                    onChange={(e) => setRepresentativeId(e.target.value)}
                                >
                                    <option value="">-- اختر المندوب --</option>
                                    {representatives.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                                </select>
                            </div>
                        </div>
                    </Card>

                    {/* Delivery Settings */}
                    <Card className="p-4 bg-green-50/20 border-green-100">
                        <h3 className="font-bold text-surface-700 text-xs mb-3 flex items-center gap-2">
                            <Truck size={14} className="text-green-600" /> موعد التسليم
                        </h3>
                        <input
                            title="Delivery Date"
                            aria-label="Delivery Date"
                            type="date"
                            className="w-full p-2 mb-3 bg-white border border-green-200 rounded-lg text-sm font-bold text-surface-800 outline-none"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                        />
                        <div className="flex bg-white rounded-lg border border-green-200 p-0.5">
                            <button type="button" onClick={() => setDeliveryType('Final')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${deliveryType === 'Final' ? 'bg-green-100 text-green-700 shadow-sm' : 'text-surface-400 hover:text-surface-600'}`}>Final</button>
                            <button type="button" onClick={() => setDeliveryType('TryIn')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${deliveryType === 'TryIn' ? 'bg-orange-100 text-orange-700 shadow-sm' : 'text-surface-400 hover:text-surface-600'}`}>Try-In</button>
                        </div>
                    </Card>

                    {/* Workflow */}
                    <Card className="p-4 bg-purple-50/20 border-purple-100">
                        <h3 className="font-bold text-surface-700 text-xs mb-3 flex items-center gap-2">
                            <Settings size={14} className="text-purple-600" /> تنفيذ العمل
                        </h3>
                        <div className="flex bg-white rounded-lg border border-purple-200 p-0.5 mb-3">
                            <button type="button" onClick={() => setWorkflowType('full')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${workflowType === 'full' ? 'bg-purple-100 text-purple-700 shadow-sm' : 'text-surface-400 hover:text-surface-600'}`}>Full Lab</button>
                            <button type="button" onClick={() => setWorkflowType('split')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${workflowType === 'split' ? 'bg-purple-100 text-purple-700 shadow-sm' : 'text-surface-400 hover:text-surface-600'}`}>Split</button>
                        </div>

                        {workflowType === 'split' ? (
                            <div className="space-y-2 animate-in slide-in-from-top-2 fade-in">
                                <select title="Designer" aria-label="Select Designer" className="w-full p-2 bg-white border border-purple-100 rounded-lg text-xs outline-none" value={designerId} onChange={e => setDesignerId(e.target.value)}>
                                    <option value="">اختر المصمم...</option>
                                    {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                                <select
                                    title="Supplier (Split)"
                                    aria-label="Select Supplier for Split Workflow"
                                    className="w-full p-2 bg-white border border-purple-100 rounded-lg text-xs outline-none"
                                    value={selectedSupplier}
                                    onChange={e => setSelectedSupplier(e.target.value)}
                                >
                                    <option value="">اختر المعمل...</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                        ) : (
                            <select
                                title="Supplier (Full)"
                                aria-label="Select Supplier for Full Lab Workflow"
                                className="w-full p-2 bg-white border border-purple-100 rounded-lg text-xs outline-none"
                                value={selectedSupplier}
                                onChange={e => setSelectedSupplier(e.target.value)}
                            >
                                <option value="">-- معمل داخلي (أفتراضي) --</option>
                                {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                            </select>
                        )}
                    </Card>

                    {/* Summary */}
                    <Card className="p-4 bg-surface-900 text-white border-none shadow-xl shadow-surface-900/10">
                        <div className="flex justify-between items-center mb-3 pb-3 border-b border-surface-700">
                            <span className="text-xs font-bold text-surface-400">الإجمالي النهائي</span>
                            <span className="text-2xl font-black tracking-tight">{total.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-surface-400">خصم خاص</span>
                            <div className="flex items-center gap-1 bg-surface-800 px-2 py-1 rounded-lg border border-surface-700 w-24">
                                <DollarSign size={12} className="text-surface-500" />
                                <input
                                    type="number"
                                    min="0"
                                    className="w-full bg-transparent text-right text-sm font-bold outline-none text-white placeholder-surface-600"
                                    value={discount}
                                    onChange={(e) => setDiscount(Number(e.target.value))}
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        {/* Admin-only: Manual Cost Override */}
                        {isAdmin && (
                            <div className="mt-3 pt-3 border-t border-surface-700">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Lock size={12} className="text-amber-400" />
                                    <span className="text-[10px] font-bold text-amber-400">تعديل التكلفة يدوياً (أدمن فقط)</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-surface-400">التكلفة</span>
                                    <div className="flex items-center gap-1 bg-surface-800 px-2 py-1 rounded-lg border border-amber-500/30 w-28">
                                        <DollarSign size={12} className="text-amber-400" />
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full bg-transparent text-right text-sm font-bold outline-none text-amber-300 placeholder-surface-600"
                                            value={manualCost ?? ''}
                                            onChange={(e) => setManualCost(e.target.value === '' ? null : Number(e.target.value))}
                                            placeholder="تلقائي"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-surface-500 mt-1 text-left">التكلفة التلقائية: {(() => {
                                    let auto = 0;
                                    if (workflowType === 'full') {
                                        auto = items.reduce((sum, item) => {
                                            const count = item.teethNumbers ? item.teethNumbers.length : 0;
                                            const svc = services.find(s => s.name === item.serviceType);
                                            let unitCost = svc ? svc.costPrice : 0;
                                            if (selectedSupplier) {
                                                const sup = suppliers.find(s => s.id === selectedSupplier);
                                                if (sup?.customPrices?.[item.serviceType] !== undefined) unitCost = sup.customPrices[item.serviceType];
                                            }
                                            return sum + (unitCost * count);
                                        }, 0);
                                    } else {
                                        const designer = designers.find(d => d.id === designerId);
                                        const sup = suppliers.find(s => s.id === selectedSupplier);
                                        auto = items.reduce((sum, item) => {
                                            const count = item.teethNumbers ? item.teethNumbers.length : 0;
                                            const svc = services.find(s => s.name === item.serviceType);
                                            const dCost = (designer?.unitRate || 0) * count;
                                            let mCost = 0;
                                            if (sup?.millingPrices?.[item.serviceType] !== undefined) mCost = sup.millingPrices[item.serviceType] * count;
                                            else if (svc) mCost = (svc.costPrice * 0.5) * count;
                                            return sum + dCost + mCost;
                                        }, 0);
                                    }
                                    return auto.toLocaleString();
                                })()}</p>
                            </div>
                        )}
                    </Card>

                </div>
            </div>

            {/* Doctor Modal */}
            {showDoctorModal && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-md animate-in zoom-in-95">
                        <div className="p-4 border-b border-surface-100 bg-surface-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-base text-surface-900">إضافة طبيب جديد</h2>
                            <button onClick={() => setShowDoctorModal(false)} aria-label="Close"><X size={18} className="text-surface-400 hover:text-surface-600" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            {doctorError && (
                                <div className="bg-red-50 text-red-600 text-xs font-bold p-2 rounded flex items-center gap-2">
                                    <AlertTriangle size={14} /> {doctorError}
                                </div>
                            )}
                            <Input label="اسم الطبيب" required placeholder="د. ..." value={newDoctor.name} onChange={e => setNewDoctor({ ...newDoctor, name: e.target.value })} />
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="رقم الهاتف" required type="tel" value={newDoctor.phone} onChange={e => setNewDoctor({ ...newDoctor, phone: e.target.value })} />
                                <Input label="الكود" required placeholder="AHM" value={newDoctor.doctorCode} onChange={e => setNewDoctor({ ...newDoctor, doctorCode: e.target.value })} />
                            </div>
                            <Input label="العنوان" required placeholder="القاهرة، مصر" value={newDoctor.address} onChange={e => setNewDoctor({ ...newDoctor, address: e.target.value })} />
                            <Button onClick={handleAddDoctorFull} className="w-full mt-2">
                                <span>حفظ</span>
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </form>
    );
}
