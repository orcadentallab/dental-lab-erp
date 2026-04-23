/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState, useEffect } from 'react';
import { db, type Doctor, type Order, type Service, type OrderItem, type User, type Supplier } from '../../services/db';
import { generateNextCaseIdForDoctor } from '../../services/caseIdService';
import { Plus, Trash2, AlertTriangle, Truck, Settings, Link as LinkIcon, Box, DollarSign, X, CheckCircle, Image, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TeethTagsInput } from '../ui/TeethTagsInput';
import clsx from 'clsx';
import { isDesignerUser, isRepresentativeUser } from '../../lib/userRoles';

interface OrderFormProps {
    onCancel: () => void;
    onSubmit: (order: Omit<Order, 'id'>) => any;
    initialData?: Order;
    readOnly?: boolean;
}

interface FormOrderItem extends Omit<OrderItem, 'teethNumbers'> {
    teethNumbers: string[]; // Changed to array for tags input
    customPrice?: number; // Override price for this order only
}

import { DoctorSelect } from './DoctorSelect';

export default function OrderForm({ onCancel, onSubmit, initialData, readOnly }: OrderFormProps) {
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
    const [selectedMainDoctorId, setSelectedMainDoctorId] = useState('');
    const [selectedChildDoctorId, setSelectedChildDoctorId] = useState('');
    const [patientName, setPatientName] = useState(initialData?.patientName || '');
    const [shade, setShade] = useState(initialData?.shade || '');
    const [stlUrl, setStlUrl] = useState(initialData?.stlUrl || '');
    const [imagesUrl, setImagesUrl] = useState(initialData?.imagesUrl || '');
    const [discount, setDiscount] = useState(initialData?.discount || 0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

    // Full Add Doctor State
    const [showDoctorModal, setShowDoctorModal] = useState(false);
    const [newDoctor, setNewDoctor] = useState({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '', isCenter: false, parentId: undefined as string | undefined });
    const [doctorError, setDoctorError] = useState<string | null>(null);

    const normalizeText = (text: string) => text ? text.toString().trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') : '';

    const handleAddDoctorFull = async () => {
        setDoctorError(null);
        try {
            let finalNewDoctor = { ...newDoctor };

            // If it's a child doctor, inherit from parent and simplify
            if (newDoctor.parentId) {
                const parent = doctors.find(d => d.id === newDoctor.parentId);
                if (parent) {
                    finalNewDoctor.address = parent.address;
                    finalNewDoctor.representativeId = parent.representativeId || '';
                    finalNewDoctor.representativeName = parent.representativeName;
                    
                    // Match the generation logic in Doctors.tsx: ParentCode-Rand3
                    const randomSuffix = Math.floor(100 + Math.random() * 899); // 3 digits
                    const parentCodeClean = parent.doctorCode.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
                    finalNewDoctor.doctorCode = `${parentCodeClean}-${randomSuffix}`;
                }
            }

            const normalizedName = normalizeText(finalNewDoctor.name);
            const normalizedCode = finalNewDoctor.doctorCode.trim().toUpperCase();

            if (!normalizedName || !normalizedCode) {
                setDoctorError('يرجى ملء جميع الحقول المطلوبة');
                return;
            }

            const doc = await db.addDoctor({ ...finalNewDoctor, name: finalNewDoctor.name.trim(), doctorCode: normalizedCode });
            const updatedDoctors = await db.getDoctors();
            setDoctors(updatedDoctors);
            
            // If the modal was opened from the child doctor select, it means they are adding a child to the selected center
            if (newDoctor.parentId) {
                setSelectedChildDoctorId(doc.id);
            } else {
                setSelectedMainDoctorId(doc.id);
                setSelectedChildDoctorId('');
            }
            setShowDoctorModal(false);
            setNewDoctor({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '', isCenter: false, parentId: undefined });
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
                setServices(servicesData);

                if (!initialData && servicesData.length > 0) {
                    setItems(items.map(i => i.serviceType === '' ? { ...i, serviceType: servicesData[0].name } : i));
                }

                if (initialData && initialData.doctorId) {
                    // const doc = doctorsData.find(d => d.id === initialData.doctorId);
                    // if (doc) setDoctorSearchTerm(doc.name);
                }

                setSuppliers(suppliersData);
                setRepresentatives(usersData.filter(u => isRepresentativeUser(u)));
                setDesigners(usersData.filter(u => isDesignerUser(u)));

                // Auto-set representativeId for representatives creating new orders
                if (!initialData && user && isRepresentativeUser(user)) {
                    const currentRep = usersData.find(u => u.id === user!.id);
                    if (currentRep) {
                        setRepresentativeId(currentRep.id);
                    }
                }
                
                if (initialData?.doctorId) {
                    const initDoc = doctorsData.find(d => d.id === initialData.doctorId);
                    if (initDoc?.parentId) {
                        setSelectedMainDoctorId(initDoc.parentId);
                        setSelectedChildDoctorId(initDoc.id);
                    } else if (initDoc) {
                        setSelectedMainDoctorId(initDoc.id);
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

    const updateItem = (index: number, field: keyof FormOrderItem, value: string | number | string[]) => {
        const newItems = [...items];
        if (field === 'serviceType') {
            // Reset prices when the service type changes so it picks up the new service's default/custom price
            newItems[index] = { ...newItems[index], serviceType: value as string, price: 0, customPrice: undefined };
        } else {
            newItems[index] = { ...newItems[index], [field]: value as any };
        }
        setItems(newItems);
    };

    const currentDoctor = doctors.find(d => d.id === selectedMainDoctorId);
    const resolvedDoctorId = currentDoctor?.isCenter ? selectedChildDoctorId : selectedMainDoctorId;
    const finalDoctor = doctors.find(d => d.id === resolvedDoctorId);

    const subTotal = items.reduce((sum, item) => {
        const count = item.teethNumbers ? item.teethNumbers.length : 0;
        const svc = services.find(s => s.name === item.serviceType);

        let unitPrice: number;

        if (item.customPrice !== undefined) {
            // Explicit override the admin entered in this form session
            unitPrice = item.customPrice;
        } else if (item.price > 0) {
            // Previously saved price from DB — respect it (may differ from svc.sellingPrice)
            unitPrice = item.price;
        } else if (finalDoctor?.customPrices?.[item.serviceType] !== undefined) {
            unitPrice = finalDoctor.customPrices[item.serviceType];
        } else if (currentDoctor?.customPrices?.[item.serviceType] !== undefined) {
            unitPrice = currentDoctor.customPrices[item.serviceType];
        } else if (svc) {
            unitPrice = svc.sellingPrice;
        } else {
            unitPrice = 0;
        }

        return sum + (count * unitPrice);
    }, 0);

    const total = subTotal - discount;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setHasTriedSubmit(true);

        if (!selectedMainDoctorId) {
            toastError('يرجى اختيار الطبيب / المركز الطبي');
            return;
        }

        if (currentDoctor?.isCenter && !selectedChildDoctorId) {
            toastError('يرجى اختيار الطبيب التابع للمركز المختار');
            return;
        }

        const activeDoctorId = currentDoctor?.isCenter ? selectedChildDoctorId : selectedMainDoctorId;



        const invalidItems = items.filter(i => i.teethNumbers.length === 0);
        if (invalidItems.length > 0) {
            toastError('يرجى إدخال أرقام الأسنان بشكل صحيح');
            return;
        }

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
            const caseId = initialData?.caseId || (finalDoctor
                ? await generateNextCaseIdForDoctor(finalDoctor, doctors)
                : 'UNKNOWN');

            await onSubmit({
                caseId,
                doctorId: activeDoctorId,
                patientName,
                items: items.map(i => {
                    const svc = services.find(s => s.name === i.serviceType);
                    let resolvedUnitPrice: number;
                    if (i.customPrice !== undefined) {
                        // Explicit override entered in this session
                        resolvedUnitPrice = i.customPrice;
                    } else if (i.price > 0) {
                        // Previously saved price — preserve it as-is
                        resolvedUnitPrice = i.price;
                    } else if (finalDoctor?.customPrices?.[i.serviceType] !== undefined) {
                        resolvedUnitPrice = finalDoctor.customPrices[i.serviceType];
                    } else if (currentDoctor?.customPrices?.[i.serviceType] !== undefined) {
                        resolvedUnitPrice = currentDoctor.customPrices[i.serviceType];
                    } else if (svc) {
                        resolvedUnitPrice = svc.sellingPrice;
                    } else {
                        resolvedUnitPrice = 0;
                    }
                    return { serviceType: i.serviceType, teethNumbers: i.teethNumbers, price: resolvedUnitPrice, shade: i.shade };
                }),
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

    const sidebarCardClass = "p-3.5 bg-white border border-surface-100 shadow-sm";
    const fieldClass = "h-9 w-full rounded-lg border border-surface-200 bg-white px-3 text-sm font-bold text-surface-800 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20";
    const selectClass = "h-9 w-full rounded-lg border border-surface-200 bg-white px-3 text-sm text-surface-800 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20";
    const segmentWrapClass = "grid grid-cols-2 rounded-lg border border-surface-200 bg-surface-50 p-0.5";
    const segmentButtonClass = "h-7 rounded-md text-xs font-bold transition-all";

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-right font-sans max-w-7xl mx-auto">
            {/* Header / Top Actions */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                <h2 className="text-lg sm:text-xl font-bold text-surface-800 dark:text-surface-100 flex items-center gap-2">
                    <Box className="text-primary-600" />
                    {initialData ? 'تعديل بيانات الأوردر' : 'إنشاء أوردر جديد'}
                </h2>
                <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto sm:items-center">
                    <div className="min-w-0 sm:w-56">
                        <label className="sr-only">المندوب المستلم</label>
                        <select
                            title="Representative"
                            aria-label="Select Representative"
                            className="h-10 w-full rounded-xl border border-surface-200 bg-white px-3 text-sm text-surface-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                            value={representativeId}
                            onChange={(e) => setRepresentativeId(e.target.value)}
                        >
                            <option value="">المندوب المستلم</option>
                            {representatives.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                        </select>
                    </div>
                    <Button type="button" variant="ghost" disabled={isSubmitting} className="text-surface-500 flex-1 sm:flex-initial" onClick={onCancel}>
                        <span>{readOnly ? 'إغلاق' : 'إلغاء'}</span>
                    </Button>
                    {!readOnly && (
                        <Button type="submit" size="md" disabled={isSubmitting} className="px-6 sm:px-8 shadow-lg shadow-primary-500/20 flex-1 sm:flex-initial">
                            <span>{isSubmitting ? 'جاري الحفظ...' : (initialData ? 'حفظ التعديلات' : 'تأكيد الأوردر')}</span>
                        </Button>
                    )}
                </div>
            </div>

            <fieldset disabled={readOnly} className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                {/* LEFT COLUMN: Main Inputs (8) */}
                <div className="lg:col-span-8 space-y-5">

                    {/* 1. Patient & Doctor Info (Horizontal Dense) */}
                    <Card className="p-4 bg-white dark:bg-surface-800 border border-surface-100 shadow-sm">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                            {/* 1. Doctor / Center */}
                            <div className={clsx(currentDoctor?.isCenter ? "md:col-span-5" : "md:col-span-6", "min-w-0")}>
                                <div className="mb-1.5 flex h-5 items-center justify-between gap-2">
                                    <label className="block text-xs font-bold text-surface-600 truncate">الطبيب / المركز المعالج</label>
                                    <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">مطلوب</span>
                                </div>
                                <div className="flex gap-1.5">
                                    <div className="flex-1 min-w-0">
                                        <DoctorSelect
                                            value={selectedMainDoctorId}
                                            onlyPrimary
                                            onChange={(id) => {
                                                setSelectedMainDoctorId(id);
                                                setSelectedChildDoctorId('');
                                            }}
                                            error={!selectedMainDoctorId && hasTriedSubmit ? 'اختر الطبيب أو المركز قبل تأكيد الأوردر' : undefined}
                                        />
                                    </div>
                                    {!readOnly && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setNewDoctor(prev => ({ ...prev, isCenter: false, parentId: undefined }));
                                                setShowDoctorModal(true);
                                            }}
                                            className="flex h-10 w-9 items-center justify-center text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-100 transition-colors shrink-0"
                                            aria-label="إضافة طبيب أو مركز"
                                        >
                                            <Plus size={18} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* 2. Executing Doctor (If Center) */}
                            {currentDoctor?.isCenter && (
                                <div className="md:col-span-4 min-w-0">
                                    <label className="mb-1.5 flex h-5 items-center gap-1.5 text-xs font-bold text-surface-600 truncate">
                                        <div className="w-1 h-3 bg-primary-300 rounded-full shrink-0"></div>
                                        طبيب المركز المنفذ
                                    </label>
                                    <div className="flex gap-1.5 items-center">
                                        <select
                                            className="h-10 min-w-0 flex-1 rounded-lg border border-surface-200 bg-white px-3 text-sm font-bold text-surface-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                                            value={selectedChildDoctorId}
                                            onChange={(e) => setSelectedChildDoctorId(e.target.value)}
                                        >
                                            <option value="">-- اختر طبيب --</option>
                                            {doctors.filter(d => d.parentId === selectedMainDoctorId).map(doc => (
                                                <option key={doc.id} value={doc.id}>{doc.name}</option>
                                            ))}
                                        </select>
                                        {!readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setNewDoctor(prev => ({ ...prev, isCenter: false, parentId: selectedMainDoctorId }));
                                                    setShowDoctorModal(true);
                                                }}
                                                className="flex h-10 w-9 items-center justify-center text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-100 transition-colors shrink-0"
                                                aria-label="إضافة طبيب للمركز"
                                            >
                                                <Plus size={17} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 3. Patient Name */}
                            <div className={clsx(currentDoctor?.isCenter ? "md:col-span-3" : "md:col-span-6", "min-w-0")}>
                                <label className="mb-1.5 flex h-5 items-center text-xs font-bold text-surface-600 truncate">اسم المريض</label>
                                <Input
                                    className="h-10 py-0 text-sm font-bold bg-white border-surface-200"
                                    placeholder="اسم المريض..."
                                    value={patientName}
                                    onChange={(e) => setPatientName(e.target.value)}
                                />
                            </div>
                        </div>
                    </Card>

                    {/* 2. Items List */}
                    <Card className="p-5 min-h-[14rem] bg-white border border-surface-100 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="font-bold text-surface-700 flex items-center gap-2 text-sm">
                                    <span className="p-1 bg-indigo-50 text-indigo-600 rounded-lg"><Box size={16} /></span>
                                    قائمة الأصناف المطلوبة
                                </h3>
                                {/* Integrated Shade Field */}
                                <div className="flex h-8 items-center overflow-hidden rounded-lg border border-surface-200 bg-white shadow-sm">
                                    <label className="flex h-full items-center border-l border-surface-200 bg-surface-50 px-2.5 text-[10px] font-bold text-surface-500 whitespace-nowrap">اللون (Shade)</label>
                                    <input
                                        type="text"
                                        className="h-full w-20 bg-white px-2 text-center text-xs font-black text-primary-700 outline-none placeholder:text-surface-300"
                                        placeholder="A1"
                                        value={shade}
                                        onChange={(e) => setShade(e.target.value)}
                                    />
                                </div>
                            </div>
                            {!readOnly && (
                                <Button size="sm" variant="secondary" onClick={handleAddItem} className="h-8 text-xs gap-1">
                                    <Plus size={14} /> إضافة صنف
                                </Button>
                            )}
                        </div>

                        <div className="space-y-2">
                            {items.map((item, index) => {
                                const svc = services.find(s => s.name === item.serviceType);
                                const doctorSpecialPrice = currentDoctor?.customPrices?.[item.serviceType];
                                const childDoctorSpecialPrice = finalDoctor?.customPrices?.[item.serviceType];
                                
                                // Priority: explicit customPrice → saved DB price → child doctor price → main doctor price → service default
                                const displayPrice = item.customPrice !== undefined
                                    ? item.customPrice
                                    : item.price > 0
                                        ? item.price
                                        : childDoctorSpecialPrice !== undefined
                                            ? childDoctorSpecialPrice
                                            : doctorSpecialPrice !== undefined
                                                ? doctorSpecialPrice
                                                : (svc?.sellingPrice || 0);
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
                                        {items.length > 1 && !readOnly && (
                                            <button onClick={() => handleRemoveItem(index)} aria-label="Remove Item" className="p-1.5 text-surface-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    {/* 3. Notes & STL */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Card className="p-5 bg-white border border-surface-100 shadow-sm">
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
                        <Card className="p-0 overflow-hidden bg-white border border-surface-100 shadow-sm">
                            <textarea
                                className="w-full h-full p-4 bg-white text-sm outline-none resize-none min-h-[5rem] focus:ring-2 focus:ring-primary-500/20"
                                placeholder="ملاحظات فنية إضافية للمعمل..."
                                value={instructions}
                                onChange={(e) => setInstructions(e.target.value)}
                            />
                        </Card>
                    </div>
                </div>

                {/* RIGHT COLUMN: Sidebar (4) */}
                <div className="lg:col-span-4 space-y-3">

                    {/* Dates & Delivery */}
                    <Card className={clsx(sidebarCardClass, "transition-colors", isUrgent && "border-red-200 bg-red-50/40")}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="font-bold text-surface-700 text-sm flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                                    <Truck size={15} />
                                </span>
                                مواعيد الأوردر
                            </h3>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <div className={clsx("w-5 h-5 rounded-md border flex items-center justify-center transition-colors", isUrgent ? "bg-red-500 border-red-500 text-white" : "bg-white border-surface-300")}>
                                    {isUrgent && <CheckCircle size={12} />}
                                </div>
                                <input type="checkbox" className="hidden" checked={isUrgent} onChange={() => setIsUrgent(!isUrgent)} />
                                <span className={clsx("text-xs font-bold whitespace-nowrap", isUrgent ? "text-red-700" : "text-surface-600")}>مستعجل</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div>
                                <label className="text-[10px] font-bold text-surface-500 block mb-1">تاريخ الاستلام</label>
                                <input
                                    title="Received Date"
                                    aria-label="Received Date"
                                    type="date"
                                    className={fieldClass}
                                    value={receivedDate}
                                    onChange={(e) => setReceivedDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-surface-500 block mb-1">موعد التسليم</label>
                                <input
                                    title="Delivery Date"
                                    aria-label="Delivery Date"
                                    type="date"
                                    className={fieldClass}
                                    value={deliveryDate}
                                    onChange={(e) => setDeliveryDate(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className={clsx(segmentWrapClass, "mt-3")}>
                            <button type="button" onClick={() => setDeliveryType('Final')} className={clsx(segmentButtonClass, deliveryType === 'Final' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'text-surface-500 hover:text-surface-700')}>Final</button>
                            <button type="button" onClick={() => setDeliveryType('TryIn')} className={clsx(segmentButtonClass, deliveryType === 'TryIn' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-surface-500 hover:text-surface-700')}>Try-In</button>
                        </div>
                    </Card>

                    {/* Workflow */}
                    <Card className={sidebarCardClass}>
                        <h3 className="font-bold text-surface-700 text-sm mb-2.5 flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                                <Settings size={15} />
                            </span>
                            تنفيذ العمل
                        </h3>
                        <div className={clsx(segmentWrapClass, "mb-3")}>
                            <button type="button" onClick={() => setWorkflowType('full')} className={clsx(segmentButtonClass, workflowType === 'full' ? 'bg-primary-100 text-primary-700 shadow-sm' : 'text-surface-500 hover:text-surface-700')}>Full Lab</button>
                            <button type="button" onClick={() => setWorkflowType('split')} className={clsx(segmentButtonClass, workflowType === 'split' ? 'bg-primary-100 text-primary-700 shadow-sm' : 'text-surface-500 hover:text-surface-700')}>Split</button>
                        </div>

                        {workflowType === 'split' ? (
                            <div className="space-y-3 animate-in slide-in-from-top-2 fade-in">
                                <select title="Designer" aria-label="Select Designer" className={selectClass} value={designerId} onChange={e => setDesignerId(e.target.value)}>
                                    <option value="">اختر المصمم...</option>
                                    {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                                <select
                                    title="Supplier (Split)"
                                    aria-label="Select Supplier for Split Workflow"
                                    className={selectClass}
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
                                className={selectClass}
                                value={selectedSupplier}
                                onChange={e => setSelectedSupplier(e.target.value)}
                            >
                                <option value="">-- معمل داخلي (أفتراضي) --</option>
                                {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                            </select>
                        )}
                    </Card>

                    {/* Summary */}
                    <Card className="p-3.5 bg-surface-900 text-white border border-surface-800 shadow-xl shadow-surface-900/10">
                        <div className="mb-3 border-b border-white/10 pb-3">
                            <span className="text-xs font-bold text-surface-400">الإجمالي النهائي</span>
                            <div className="mt-1 flex items-end justify-between gap-3">
                                <span className="text-2xl font-black leading-none tracking-tight">{total.toLocaleString()}</span>
                                <span className="text-xs font-bold text-surface-500">جنيه</span>
                            </div>
                        </div>
                        <div className="flex justify-between items-center gap-3">
                            <span className="text-xs font-bold text-surface-300">خصم خاص</span>
                            <div className="flex h-9 w-28 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2">
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
                            <div className="mt-3 border-t border-white/10 pt-3">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Lock size={12} className="text-amber-400" />
                                    <span className="text-[10px] font-bold text-amber-400">تعديل التكلفة يدوياً (أدمن فقط)</span>
                                </div>
                                <div className="flex justify-between items-center gap-3">
                                    <span className="text-xs font-bold text-surface-300">التكلفة</span>
                                    <div className="flex h-9 w-32 items-center gap-1 rounded-lg border border-amber-500/30 bg-white/5 px-2">
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
                                <p className="mt-2 text-left text-[10px] text-surface-500">التكلفة التلقائية: {(() => {
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
            </fieldset>

            {showDoctorModal && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-md animate-in zoom-in-95">
                        <div className="p-4 border-b border-surface-100 bg-surface-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-base text-surface-900">
                                {newDoctor.parentId ? 'إضافة طبيب للمركز' : 'إضافة طبيب جديد'}
                            </h2>
                            <button onClick={() => setShowDoctorModal(false)} aria-label="Close"><X size={18} className="text-surface-400 hover:text-surface-600" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            {doctorError && (
                                <div className="bg-red-50 text-red-600 text-xs font-bold p-2 rounded flex items-center gap-2">
                                    <AlertTriangle size={14} /> {doctorError}
                                </div>
                            )}
                            
                            <Input label="اسم الطبيب" required placeholder="د. ..." value={newDoctor.name} onChange={e => setNewDoctor({ ...newDoctor, name: e.target.value })} />
                            
                            <div className={newDoctor.parentId ? "w-full" : "grid grid-cols-2 gap-4"}>
                                <Input label="رقم الهاتف" required type="tel" value={newDoctor.phone} onChange={e => setNewDoctor({ ...newDoctor, phone: e.target.value })} />
                                {!newDoctor.parentId && (
                                    <Input label="الكود" required placeholder="AHM" value={newDoctor.doctorCode} onChange={e => setNewDoctor({ ...newDoctor, doctorCode: e.target.value })} />
                                )}
                            </div>

                            {!newDoctor.parentId && (
                                <Input label="العنوان" required placeholder="القاهرة، مصر" value={newDoctor.address} onChange={e => setNewDoctor({ ...newDoctor, address: e.target.value })} />
                            )}

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
