/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState, useEffect, useMemo, useRef } from 'react';
import { db, type Doctor, type Order, type Service, type ServiceFamily, type OrderItem, type User, type Supplier } from '../../services/db';
import { generateNextCaseIdForDoctor } from '../../services/caseIdService';
import { Plus, Trash2, AlertTriangle, Truck, Settings, Link as LinkIcon, Box, DollarSign, X, CheckCircle, Image, Lock, Sparkles, Loader2, Printer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../ui/Input';
import DateField from '../ui/DateField';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TeethTagsInput } from '../ui/TeethTagsInput';
import clsx from 'clsx';
import { isDesignerUser, isRepresentativeUser, canBeOrderRepresentative, hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION } from '../../lib/userRoles';
import { getDoctorServicePrice, reconcileLegacyItemPrices } from '../../lib/pricingUtils';
import { canEditOrderField, type WorkflowRole } from '../../lib/workflowPermissions';
import { getEffectiveProductionStatus, getEffectiveIssueState } from '../../constants/orderLifecycle';
import type { ProductionStatus, IssueState } from '../../constants/workflow';
import { getEffectiveRouteStages, type EffectiveRouteStage } from '../../services/supabase/production';

interface OrderFormProps {
    onCancel: () => void;
    onSubmit: (order: Omit<Order, 'id'>) => any;
    initialData?: Order;
    readOnly?: boolean;
}

interface FormOrderItem extends Omit<OrderItem, 'teethNumbers'> {
    teethNumbers: string[]; // Changed to array for tags input
    customPrice?: number; // Override price for this order only
    // Item of an existing order whose unit price could not be reconstructed
    // (the order itself is priced at 0). Never re-price it from the current
    // catalog — that would inflate a saved order just by opening it.
    legacyUnpriced?: boolean;
}

import { DoctorSelect } from './DoctorSelect';
import CaseAttachments from './CaseAttachments';
import CaseSlipPrint from './CaseSlipPrint';
import { uploadCaseFilesBatch } from '../../lib/storage';
import { capacityService } from '../../services/supabase/capacityService';

const calculateOrderCost = (
    workflowType: 'full' | 'split',
    items: FormOrderItem[],
    services: Service[],
    suppliers: Supplier[],
    selectedSupplier: string,
    designers: User[],
    designerId: string
) => {
    if (workflowType === 'full') {
        if (!selectedSupplier) return 0;
        return items.reduce((sum, item) => {
            const count = item.teethNumbers ? item.teethNumbers.length : 0;
            const svc = services.find(s => s.name === item.serviceType);
            let unitCost = svc ? svc.costPrice : 0;
            const sup = suppliers.find(s => s.id === selectedSupplier);
            if (sup?.customPrices?.[item.serviceType] !== undefined) unitCost = sup.customPrices[item.serviceType];
            return sum + (unitCost * count);
        }, 0);
    }

    const designer = designers.find(d => d.id === designerId);
    const sup = selectedSupplier ? suppliers.find(s => s.id === selectedSupplier) : null;
    return items.reduce((sum, item) => {
        const count = item.teethNumbers && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const svc = services.find(s => s.name === item.serviceType);
        // Priority: per-designer override -> service default designer price -> 0
        const designUnitCost = designer?.designerServicePrices?.[item.serviceType] !== undefined
            ? designer.designerServicePrices![item.serviceType]
            : (svc?.designerPrice ?? 0);
        const isSalaried = hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION);
        const dCost = isSalaried ? 0 : designUnitCost * count;
        let mCost = 0;
        if (selectedSupplier) {
            if (sup?.millingPrices?.[item.serviceType] !== undefined) mCost = sup.millingPrices[item.serviceType] * count;
            else if (svc?.millingPrice) mCost = svc.millingPrice * count;
            else if (svc) mCost = (svc.costPrice * 0.5) * count;
        }
        return sum + dCost + mCost;
    }, 0);
};

const calculateAutomaticMillingPrice = (
    items: FormOrderItem[],
    services: Service[],
    suppliers: Supplier[],
    selectedSupplier: string
) => {
    if (!selectedSupplier) return 0;
    const sup = suppliers.find(s => s.id === selectedSupplier);
    return items.reduce((sum, item) => {
        const count = item.teethNumbers && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const svc = services.find(s => s.name === item.serviceType);
        let mCost = 0;
        if (sup?.millingPrices?.[item.serviceType] !== undefined) mCost = sup.millingPrices[item.serviceType] * count;
        else if (svc?.millingPrice) mCost = svc.millingPrice * count;
        else if (svc) mCost = (svc.costPrice * 0.5) * count;
        return sum + mCost;
    }, 0);
};


const calculateAutomaticDesignPrice = (
    items: FormOrderItem[],
    services: Service[],
    designers: User[],
    designerId: string
) => {
    const designer = designers.find(d => d.id === designerId);
    return items.reduce((sum, item) => {
        const count = item.teethNumbers && item.teethNumbers.length > 0 ? item.teethNumbers.length : 1;
        const svc = services.find(s => s.name === item.serviceType);
        const designUnitCost = designer?.designerServicePrices?.[item.serviceType] !== undefined
            ? designer.designerServicePrices![item.serviceType]
            : (svc?.designerPrice ?? 0);
        return sum + (designUnitCost * count);
    }, 0);
};

const normalizeArabic = (text: string): string => {
    return text
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
};

export default function OrderForm({ onCancel, onSubmit, initialData, readOnly }: OrderFormProps) {
    const { user } = useAuth();
    const { error: toastError } = useToast();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [families, setFamilies] = useState<ServiceFamily[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [representatives, setRepresentatives] = useState<User[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    // removed: existingOrders state


    // const [doctorSearchTerm, setDoctorSearchTerm] = useState(''); // REPLACED BY DOCTOR SELECT
    // const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false); // REPLACED BY DOCTOR SELECT
    const [selectedMainDoctorId, setSelectedMainDoctorId] = useState('');
    const [selectedChildDoctorId, setSelectedChildDoctorId] = useState('');
    const [branchName, setBranchName] = useState(initialData?.branchName || '');
    const [patientName, setPatientName] = useState(initialData?.patientName || '');
    const [shade, setShade] = useState(initialData?.shade || '');
    const [stlUrl, setStlUrl] = useState(initialData?.stlUrl || '');
    const [imagesUrl, setImagesUrl] = useState(initialData?.imagesUrl || '');
    const [discount, setDiscount] = useState(initialData?.discount || 0);
    const [stagedInstructionFiles, setStagedInstructionFiles] = useState<File[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
    const [showSlipPrint, setShowSlipPrint] = useState(false);

    // Full Add Doctor State
    const [showDoctorModal, setShowDoctorModal] = useState(false);
    const [newDoctor, setNewDoctor] = useState({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '', isCenter: false, parentId: undefined as string | undefined, labInstructions: '' });
    const [doctorError, setDoctorError] = useState<string | null>(null);

    // Quick Add Branch State
    const [showAddBranchModal, setShowAddBranchModal] = useState(false);
    const [newBranch, setNewBranch] = useState({ name: '', address: '', phone: '' });
    const [branchError, setBranchError] = useState<string | null>(null);

    const normalizeText = (text: string) => text ? text.toString().trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') : '';

    const handleAddDoctorFull = async () => {
        setDoctorError(null);
        try {
            const finalNewDoctor = { ...newDoctor };

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
            setNewDoctor({ name: '', phone: '', phone2: '', address: '', doctorCode: '', representativeName: '', representativeId: '', isCenter: false, parentId: undefined, labInstructions: '' });
        } catch (err) {
            console.error('Add Doctor Error:', err);
            setDoctorError('حدث خطأ غير متوقع أثناء الحفظ.');
        }
    };

    const handleQuickAddBranch = async () => {
        setBranchError(null);
        if (!newBranch.name.trim()) {
            setBranchError('اسم الفرع مطلوب');
            return;
        }
        if (!selectedMainDoctorId) {
            setBranchError('يجب اختيار الطبيب أولاً');
            return;
        }

        try {
            const doc = doctors.find(d => d.id === selectedMainDoctorId);
            if (!doc) throw new Error('الطبيب غير موجود');

            const existingBranches = doc.branches || [];
            if (existingBranches.some(b => b.name.trim().toLowerCase() === newBranch.name.trim().toLowerCase())) {
                setBranchError('هذا الفرع موجود بالفعل');
                return;
            }

            const updatedBranches = [
                ...existingBranches,
                {
                    id: crypto.randomUUID(),
                    name: newBranch.name.trim(),
                    address: newBranch.address.trim(),
                    phone: newBranch.phone.trim()
                }
            ];

            const updatedDoc = await db.updateDoctor(selectedMainDoctorId, {
                branches: updatedBranches
            });

            if (updatedDoc) {
                // Update local doctors list
                setDoctors(prev => prev.map(d => d.id === selectedMainDoctorId ? updatedDoc : d));
                // Select the newly created branch
                setBranchName(newBranch.name.trim());
                // Reset quick add form and close modal
                setNewBranch({ name: '', address: '', phone: '' });
                setShowAddBranchModal(false);
            }
        } catch (err: any) {
            console.error('Error quick adding branch:', err);
            setBranchError(err.message || 'حدث خطأ أثناء إضافة الفرع');
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
    const [executionMode, setExecutionMode] = useState<'internal' | 'external'>(
        initialData?.supplierId ? 'external' : 'internal'
    );
    const [isEstimatingDate, setIsEstimatingDate] = useState(false);
    const [dateEstimateInfo, setDateEstimateInfo] = useState<{
        date: string;
        confidence: 'high' | 'moderate' | 'default_estimate';
        days: number | null;
    } | null>(null);
    const [representativeId, setRepresentativeId] = useState(initialData?.representativeId || '');
    const [routeStagesPreview, setRouteStagesPreview] = useState<EffectiveRouteStage[]>([]);
    const [isLoadingRouteStages, setIsLoadingRouteStages] = useState(false);

    const [workflowType, setWorkflowType] = useState<'full' | 'split'>(
        initialData?.workflowType || (initialData?.supplierId ? 'full' : 'split')
    );
    const [designerId, setDesignerId] = useState(initialData?.designerId || '');

    const [deliveryType, setDeliveryType] = useState<'Final' | 'TryIn'>(initialData?.deliveryType || 'Final');
    const [isUrgent, setIsUrgent] = useState(initialData?.isUrgent || false);
    const [receivedDate, setReceivedDate] = useState(initialData?.createdAt ? new Date(initialData.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    const [manualCost, setManualCost] = useState<number | null>(initialData?.manualCost ?? null);
    const [manualDesignPrice, setManualDesignPrice] = useState<number | null>(
        initialData?.manualDesignPrice ?? null
    );
    const isAdmin = user?.role === 'admin';
    const userRole = (user?.role || 'doctor') as WorkflowRole;
    const effectivePS: ProductionStatus = initialData
        ? getEffectiveProductionStatus(initialData)
        : 'not_started';
    const effectiveIS: IssueState = initialData
        ? getEffectiveIssueState(initialData)
        : 'none';

    const isFieldDisabled = (dbField: string): boolean => {
        if (readOnly) return true;
        if (!initialData) return false;
        return !canEditOrderField(userRole, dbField, effectivePS, effectiveIS, initialData.workflowType);
    };

    // Guards the one-time price reconciliation of a legacy order's items so a
    // re-render of the parent can never wipe out edits made in this session.
    const reconciledOrderIdRef = useRef<string | null>(null);

    const [items, itemsSet] = useState<FormOrderItem[]>(initialData?.items && initialData.items.length > 0 ? initialData.items.map(i => ({
        serviceType: i.serviceType,
        teethNumbers: Array.isArray(i.teethNumbers) ? i.teethNumbers : (typeof i.teethNumbers === 'string' ? (i.teethNumbers as string).split(',') : []),
        price: i.price,
        customPrice: undefined
    })) : [{ serviceType: '', teethNumbers: [], price: 0 }]);

    const setItems = (newItems: FormOrderItem[]) => itemsSet(newItems);

    const visibleRepresentatives = useMemo(
        () => representatives.filter(rep => rep.isActive !== false || rep.id === representativeId),
        [representatives, representativeId]
    );

    const visibleSuppliers = useMemo(
        () => suppliers.filter(supplier => supplier.isActive !== false || supplier.id === selectedSupplier),
        [suppliers, selectedSupplier]
    );

    const unroutedItems = useMemo(() => {
        if (executionMode !== 'internal') return [];
        return items.filter(item => {
            if (!item.serviceType) return false;
            const svc = services.find(s => s.name === item.serviceType);
            if (!svc) return false;
            const hasRoute = Boolean(
                svc.routeId || (svc.familyId && families.find(f => f.id === svc.familyId)?.defaultRouteId)
            );
            return !hasRoute;
        });
    }, [executionMode, items, services, families]);

    const handleEstimateDeliveryDate = async () => {
        if (items.length === 0 || !items[0].serviceType) {
            toastError('يرجى اختيار خدمة أولاً لحساب موعد التسليم المقترح');
            return;
        }
        const primaryItem = items[0];
        const svc = services.find(s => s.name === primaryItem.serviceType);
        if (!svc) {
            toastError('الخدمة المختارة غير معرفة في قائمة الخدمات');
            return;
        }
        const totalUnits = items.reduce((sum, item) => sum + (item.teethNumbers?.length || 1), 0);
        setIsEstimatingDate(true);
        try {
            const estimate = await capacityService.estimateDeliveryTime(svc.id, totalUnits);
            if (estimate?.estimated_delivery_date) {
                setDeliveryDate(estimate.estimated_delivery_date);
                setDateEstimateInfo({
                    date: estimate.estimated_delivery_date,
                    confidence: estimate.confidence_level,
                    days: estimate.estimated_calendar_days,
                });
            } else {
                toastError('تعذر احتساب الموعد، لم يتم ضبط تقويم العمل');
            }
        } catch (err: any) {
            console.error('Failed to estimate delivery date:', err);
            toastError('حدث خطأ أثناء احتساب موعد التسليم المقترح');
        } finally {
            setIsEstimatingDate(false);
        }
    };

    useEffect(() => {
        setInstructions(initialData?.instructions || '');
    }, [initialData?.id, initialData?.instructions]);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [doctorsData, servicesData, familiesData, suppliersData, usersData] = await Promise.all([
                    db.getDoctors(),
                    db.getServices(),
                    db.getServiceFamilies(),
                    db.getSuppliers(),
                    db.getUsers(),
                ]);
                setDoctors(doctorsData);
                setServices(servicesData);
                setFamilies(familiesData);

                if (!initialData && servicesData.length > 0) {
                    setItems(items.map(i => i.serviceType === '' ? { ...i, serviceType: servicesData[0].name } : i));
                }

                if (initialData && initialData.doctorId) {
                    // const doc = doctorsData.find(d => d.id === initialData.doctorId);
                    // if (doc) setDoctorSearchTerm(doc.name);
                }

                const designersData = usersData.filter(u => isDesignerUser(u));
                setSuppliers(suppliersData);
                setRepresentatives(usersData.filter(u => canBeOrderRepresentative(u)));
                setDesigners(designersData);



                if (initialData) {
                    const initialItems: FormOrderItem[] = initialData.items && initialData.items.length > 0 ? initialData.items.map(i => ({
                        serviceType: i.serviceType,
                        teethNumbers: Array.isArray(i.teethNumbers) ? i.teethNumbers : (typeof i.teethNumbers === 'string' ? (i.teethNumbers as string).split(',') : []),
                        price: i.price,
                        customPrice: undefined
                    })) : [{ serviceType: '', teethNumbers: [], price: 0 }];

                    // Legacy orders (created 2026-01-31 → 2026-04-06) were saved
                    // with price = 0 on every item. Rebuild those unit prices from
                    // the order's own stored total; otherwise they fall through to
                    // today's catalog price and the order silently re-prices itself
                    // just by being opened.
                    if (initialItems.some(i => !(i.price > 0)) && reconciledOrderIdRef.current !== initialData.id) {
                        reconciledOrderIdRef.current = initialData.id;
                        const orderDoctor = doctorsData.find(d => d.id === initialData.doctorId);
                        const reconciled = reconcileLegacyItemPrices(
                            initialItems,
                            initialData.totalPrice || 0,
                            initialData.discount || 0,
                            (serviceName) => getDoctorServicePrice(
                                serviceName,
                                servicesData.find(s => s.name === serviceName),
                                orderDoctor,
                                doctorsData
                            )
                        );
                        setItems(reconciled.map(i => ({ ...i, legacyUnpriced: !(i.price > 0) })));
                    }

                    if (initialData.manualCost !== undefined && initialData.manualCost !== null) {
                        // manualCost is the explicit milling/lab override. Never infer or
                        // transform an explicitly stored value when reopening the form.
                        setManualCost(initialData.manualCost);
                    } else {
                        if (initialData.workflowType === 'split') {
                            const autoMilling = calculateAutomaticMillingPrice(initialItems, servicesData, suppliersData, initialData.supplierId || '');
                            const initialDesigner = designersData.find(d => d.id === initialData.designerId);
                            const isInitialSalaried = hasCustomPermission(initialDesigner, FIXED_SALARY_DESIGNER_PERMISSION);
                            
                            // Detect if initialData.cost includes designPrice:
                            const designPrice = initialData.designPrice || 0;
                            let isDesignPriceIncluded = true;
                            if (isInitialSalaried) {
                                if (Math.abs((initialData.cost || 0) - autoMilling) < Math.abs((initialData.cost || 0) - autoMilling - designPrice)) {
                                    isDesignPriceIncluded = false;
                                }
                            }
                            
                            const initialMilling = (initialData.cost || 0) - (isDesignPriceIncluded ? designPrice : 0);
                            setManualCost(Math.abs(initialMilling - autoMilling) > 0.0001 ? initialMilling : null);
                        } else {
                            const automaticCost = calculateOrderCost(
                                initialData.workflowType || 'full',
                                initialItems,
                                servicesData,
                                suppliersData,
                                initialData.supplierId || '',
                                designersData,
                                initialData.designerId || ''
                            );
                            setManualCost(Math.abs((initialData.cost || 0) - automaticCost) > 0.0001 ? initialData.cost : null);
                        }
                    }
                    
                    if (initialData.manualDesignPrice !== undefined) {
                        setManualDesignPrice(initialData.manualDesignPrice);
                    }
                } else {
                    setManualCost(null);
                    setManualDesignPrice(null);
                }

                // Auto-set representativeId for representatives creating new orders.
                // isRepresentativeUser, NOT canBeOrderRepresentative: a
                // coordinator appears in the picker above but is never stamped
                // here. They register cases on behalf of whoever owns the
                // doctor, so the name is chosen, not assumed.
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
            newItems[index] = { ...newItems[index], serviceType: value as string, price: 0, customPrice: undefined, legacyUnpriced: false };
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
        } else if (item.legacyUnpriced) {
            // Saved order that is genuinely priced at 0 — pulling in today's
            // catalog price here would invent revenue that was never charged
            unitPrice = 0;
        } else {
            unitPrice = getDoctorServicePrice(item.serviceType, svc, finalDoctor, doctors);
        }

        return sum + (count * unitPrice);
    }, 0);

    const total = subTotal - discount;

    const currentDesigner = designers.find(d => d.id === designerId);
    const isSalaried = hasCustomPermission(currentDesigner, FIXED_SALARY_DESIGNER_PERMISSION);

    const effectiveWorkflowType: 'full' | 'split' = executionMode === 'internal' ? 'split' : workflowType;

    const calculateAutomaticCost = () => {
        return calculateOrderCost(effectiveWorkflowType, items, services, suppliers, selectedSupplier, designers, designerId);
    };

    const getServiceRouteId = (serviceName: string): string | null => {
        const svc = services.find(s => s.name === serviceName);
        if (!svc) return null;
        if (svc.routeId) return svc.routeId;
        if (svc.familyId) {
            const fam = families.find(f => f.id === svc.familyId);
            if (fam?.defaultRouteId) return fam.defaultRouteId;
        }
        return null;
    };

    const primaryServiceName = items[0]?.serviceType;
    const primaryRouteId = useMemo(() => {
        if (executionMode !== 'internal' || !primaryServiceName) return null;
        return getServiceRouteId(primaryServiceName);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [executionMode, primaryServiceName, services, families]);

    useEffect(() => {
        if (!primaryRouteId) {
            setRouteStagesPreview([]);
            return;
        }
        let active = true;
        setIsLoadingRouteStages(true);
        getEffectiveRouteStages(primaryRouteId)
            .then(stgs => {
                if (active) setRouteStagesPreview(stgs);
            })
            .catch(err => {
                console.error('Failed to load effective route stages:', err);
                if (active) setRouteStagesPreview([]);
            })
            .finally(() => {
                if (active) setIsLoadingRouteStages(false);
            });
        return () => { active = false; };
    }, [primaryRouteId]);

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

        if (currentDoctor?.hasBranches && !branchName) {
            toastError('يرجى اختيار الفرع');
            return;
        }

        const activeDoctorId = currentDoctor?.isCenter ? selectedChildDoctorId : selectedMainDoctorId;



        const invalidItems = items.filter(i => i.teethNumbers.length === 0);
        if (invalidItems.length > 0) {
            toastError('يرجى إدخال أرقام الأسنان بشكل صحيح');
            return;
        }

        if (executionMode === 'external' && !selectedSupplier) {
            toastError('يرجى اختيار المعمل الخارجي المنفذ');
            return;
        }

        if (executionMode === 'internal') {
            const unroutedServices = items
                .map(i => i.serviceType)
                .filter(st => Boolean(st) && !getServiceRouteId(st));

            if (unroutedServices.length > 0) {
                const unique = Array.from(new Set(unroutedServices));
                toastError(`الخدمة (${unique.join('، ')}) لسه مالهاش مسار داخلي. يرجى ربط الخدمة بمسار إنتاج أولاً أو اختيار معمل خارجي.`);
                return;
            }
        }

        const calculatedCost = calculateAutomaticCost();

        let totalDesignPrice = 0;
        let finalCost = calculatedCost;
        if (effectiveWorkflowType === 'split') {
            if (isAdmin && manualDesignPrice !== null) {
                totalDesignPrice = manualDesignPrice;
            } else {
                totalDesignPrice = calculateAutomaticDesignPrice(items, services, designers, designerId);
            }
            const finalMillingCost = (isAdmin && manualCost !== null) ? manualCost : calculateAutomaticMillingPrice(items, services, suppliers, selectedSupplier);
            finalCost = finalMillingCost + (isSalaried ? 0 : totalDesignPrice);
        } else if (isAdmin && manualCost !== null) {
            finalCost = manualCost;
        }

        setIsSubmitting(true);
        try {
            const caseId = initialData?.caseId || (finalDoctor
                ? await generateNextCaseIdForDoctor(finalDoctor, doctors)
                : 'UNKNOWN');

            const payload = {
                caseId,
                doctorId: activeDoctorId,
                branchName: branchName || undefined,
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
                    } else if (i.legacyUnpriced) {
                        resolvedUnitPrice = 0;
                    } else {
                        resolvedUnitPrice = getDoctorServicePrice(i.serviceType, svc, finalDoctor, doctors);
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
                // The form knows both components directly, so it records them
                // and lets the database add them up. cost is sent too and must
                // agree; it is the same sum by construction.
                cost: finalCost,
                labCost: effectiveWorkflowType === 'split'
                    ? ((isAdmin && manualCost !== null) ? manualCost : calculateAutomaticMillingPrice(items, services, suppliers, selectedSupplier))
                    : finalCost,
                designerCost: effectiveWorkflowType === 'split' && !isSalaried ? totalDesignPrice : 0,
                manualCost: (isAdmin && manualCost !== null) ? manualCost : null,
                workflowType: effectiveWorkflowType,
                designerId: effectiveWorkflowType === 'split' ? designerId : undefined,
                designStatus: initialData ? initialData.designStatus : (effectiveWorkflowType === 'split' ? 'pending' : undefined),
                designPrice: effectiveWorkflowType === 'split' ? totalDesignPrice : 0,
                manualDesignPrice: effectiveWorkflowType === 'split' ? manualDesignPrice : null,
                discount,
                priority: (isUrgent ? 'Urgent' : 'Normal') as 'Urgent' | 'Normal',
                deliveryType,
                needsDesignReview: initialData?.needsDesignReview || false,
                isUrgent,
                supplierId: executionMode === 'external' ? (selectedSupplier || undefined) : undefined,
                representativeId: representativeId || undefined,
                comments: initialData?.comments || []
            };
            const result = await onSubmit(payload);
            const createdOrderId = result?.id || initialData?.id;
            if (createdOrderId && stagedInstructionFiles.length > 0) {
                try {
                    await uploadCaseFilesBatch(stagedInstructionFiles, {
                        orderId: createdOrderId,
                        kind: 'instruction',
                    });
                } catch (attachErr) {
                    console.error('Failed to upload staged instruction attachments:', attachErr);
                }
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const sidebarCardClass = "p-3.5 bg-white border border-surface-100 shadow-sm";
    const selectClass = "h-10 w-full rounded-lg border border-surface-200 bg-white px-3 text-base text-surface-800 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:h-9 sm:text-sm";
    const segmentWrapClass = "grid grid-cols-2 rounded-lg border border-surface-200 bg-surface-50 p-0.5";
    const segmentButtonClass = "h-7 rounded-md text-xs font-bold transition-all";

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-right font-sans max-w-7xl mx-auto">
            {/* Header / Top Actions */}
            <div className="sticky top-0 z-20 -mx-3 flex flex-col items-stretch gap-3 border-b border-surface-100 bg-white/95 px-3 pb-3 pt-1 backdrop-blur lg:static lg:mx-0 lg:flex-row lg:items-center lg:justify-between lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
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
                            className="h-10 w-full rounded-xl border border-surface-200 bg-white px-3 text-base text-surface-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
                            value={representativeId}
                            onChange={(e) => setRepresentativeId(e.target.value)}
                            disabled={isFieldDisabled('representative_id')}
                        >
                            <option value="">المندوب المستلم</option>
                            {visibleRepresentatives.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                        </select>
                    </div>
                    {initialData && (
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setShowSlipPrint(true)}
                            className="flex items-center gap-1.5 text-xs text-slate-700 border-slate-300 flex-1 sm:flex-initial"
                        >
                            <Printer size={15} />
                            <span>ورقة الحالة</span>
                        </Button>
                    )}
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
                            <div className="md:col-span-6 min-w-0">
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
                                                setBranchName('');

                                                // Auto-detect branch for the new doctor from existing instructions
                                                const doc = doctors.find(d => d.id === id);
                                                if (doc?.hasBranches && doc.branches && doc.branches.length > 0 && instructions) {
                                                    const normalizedInstructions = normalizeArabic(instructions);
                                                    for (const branch of doc.branches) {
                                                        const normalizedBranchName = normalizeArabic(branch.name);
                                                        if (normalizedBranchName && normalizedInstructions.includes(normalizedBranchName)) {
                                                            setBranchName(branch.name);
                                                            break;
                                                        }
                                                    }
                                                }
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
                                <div className="md:col-span-6 min-w-0">
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

                            {/* Branch Select */}
                            {currentDoctor?.hasBranches && currentDoctor.branches && currentDoctor.branches.length > 0 && (
                                <div className="md:col-span-6 min-w-0">
                                    <label className="mb-1.5 flex h-5 items-center gap-1.5 text-xs font-bold text-surface-600 truncate">
                                        <div className="w-1 h-3 bg-blue-300 rounded-full shrink-0"></div>
                                        الفرع
                                        <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600 ml-auto">مطلوب</span>
                                    </label>
                                    <div className="flex gap-1.5 items-center">
                                        <select
                                            className="h-10 min-w-0 flex-1 rounded-lg border border-surface-200 bg-white px-3 text-sm font-bold text-surface-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                                            value={branchName}
                                            onChange={(e) => setBranchName(e.target.value)}
                                        >
                                            <option value="">-- اختر الفرع --</option>
                                            {currentDoctor.branches.map(b => (
                                                <option key={b.id} value={b.name}>{b.name}</option>
                                            ))}
                                        </select>
                                        {!readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setBranchError(null);
                                                    setNewBranch({ name: '', address: '', phone: '' });
                                                    setShowAddBranchModal(true);
                                                }}
                                                className="flex h-10 w-9 items-center justify-center text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-100 transition-colors shrink-0"
                                                aria-label="إضافة فرع جديد"
                                                title="إضافة فرع جديد"
                                            >
                                                <Plus size={17} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 3. Patient Name */}
                            <div className="md:col-span-6 min-w-0">
                                <label className="mb-1.5 flex h-5 items-center text-xs font-bold text-surface-600 truncate">اسم المريض</label>
                                <Input
                                    className="h-10 py-0 text-sm font-bold bg-white border-surface-200"
                                    placeholder="اسم المريض..."
                                    value={patientName}
                                    onChange={(e) => setPatientName(e.target.value)}
                                    disabled={isFieldDisabled('patient_name')}
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
                                        disabled={isFieldDisabled('shade')}
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
                                
                                // Priority: explicit customPrice → saved DB price → saved-but-zero legacy price → child doctor price → main doctor price → service default
                                const displayPrice = item.customPrice !== undefined
                                    ? item.customPrice
                                    : item.price > 0
                                        ? item.price
                                        : item.legacyUnpriced
                                            ? 0
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
                                                {families.map(family => {
                                                    const familyServices = services.filter(s => s.familyId === family.id);
                                                    if (familyServices.length === 0) return null;
                                                    return (
                                                        <optgroup key={family.id} label={`🔷 ${family.nameAr}`}>
                                                            {familyServices.map(s => {
                                                                const isDefault = family.defaultServiceId === s.id;
                                                                return (
                                                                    <option key={s.id} value={s.name}>
                                                                        {s.name} {isDefault ? '⭐ (افتراضي)' : ''}
                                                                    </option>
                                                                );
                                                            })}
                                                        </optgroup>
                                                    );
                                                })}
                                                {services.filter(s => !s.familyId).length > 0 && (
                                                    <optgroup label="🔹 خدمات فردية">
                                                        {services.filter(s => !s.familyId).map(s => (
                                                            <option key={s.id} value={s.name}>{s.name}</option>
                                                        ))}
                                                    </optgroup>
                                                )}
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
                                <Input value={stlUrl} onChange={(e) => setStlUrl(e.target.value)} placeholder="https://..." className="text-xs py-2 font-mono text-blue-600 pl-8" disabled={isFieldDisabled('stl_url')} />
                                <LinkIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                            </div>
                            <label className="block text-xs font-bold text-surface-500 my-2 flex items-center gap-1"><Image size={12} /> رابط الصور</label>
                            <div className="relative">
                                <Input value={imagesUrl} onChange={(e) => setImagesUrl(e.target.value)} placeholder="https://..." className="text-xs py-2 font-mono text-blue-600 pl-8" disabled={isFieldDisabled('images_url')} />
                                <LinkIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                            </div>
                        </Card>
                        <Card className="p-0 overflow-hidden bg-white border border-surface-100 shadow-sm flex flex-col">
                            {finalDoctor?.labInstructions && (
                                <div className="p-3 bg-indigo-50/80 border-b border-indigo-100 text-xs text-indigo-900">
                                    <span className="font-bold block mb-1">تعليمات الطبيب الدائمة للمعمل:</span>
                                    <p className="whitespace-pre-wrap">{finalDoctor.labInstructions}</p>
                                </div>
                            )}
                            <textarea
                                className="w-full h-full p-4 bg-white text-sm outline-none resize-none min-h-[5rem] focus:ring-2 focus:ring-primary-500/20"
                                placeholder="ملاحظات فنية إضافية للحالة للمعمل..."
                                value={instructions}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setInstructions(val);

                                    // Auto-detect branch from instructions if branch is not yet selected
                                    if (currentDoctor?.hasBranches && currentDoctor.branches && currentDoctor.branches.length > 0 && !branchName) {
                                        const normalizedInstructions = normalizeArabic(val);
                                        for (const branch of currentDoctor.branches) {
                                            const normalizedBranchName = normalizeArabic(branch.name);
                                            if (normalizedBranchName && normalizedInstructions.includes(normalizedBranchName)) {
                                                setBranchName(branch.name);
                                                break;
                                            }
                                        }
                                    }
                                }}
                                disabled={isFieldDisabled('instructions')}
                            />

                            {/* Photos that go with the instructions.
                                For existing orders: uploads directly to orderId.
                                For new orders: stages files locally with thumbnail preview, and uploads on submit.
                                These are what the technician sees on the task card before starting. */}
                            <div className="p-3 border-t border-surface-100">
                                <CaseAttachments
                                    orderId={initialData?.id}
                                    kind="instruction"
                                    canUpload={!isFieldDisabled('instructions')}
                                    stagedFiles={stagedInstructionFiles}
                                    onStagedFilesChange={setStagedInstructionFiles}
                                    label="صور مع التعليمات — الفني هيشوفها قبل ما يبدأ"
                                />
                            </div>
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
                                <input type="checkbox" className="hidden" checked={isUrgent} onChange={() => setIsUrgent(!isUrgent)} disabled={isFieldDisabled('is_urgent')} />
                                <span className={clsx("text-xs font-bold whitespace-nowrap", isUrgent ? "text-red-700" : "text-surface-600")}>مستعجل</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div>
                                <label className="text-[10px] font-bold text-surface-500 block mb-1">تاريخ الاستلام</label>
                                <DateField
                                    ariaLabel="تاريخ الاستلام"
                                    size="sm"
                                    value={receivedDate}
                                    onChange={setReceivedDate}
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-[10px] font-bold text-surface-500 block">موعد التسليم</label>
                                    {!readOnly && (
                                        <button
                                            type="button"
                                            onClick={handleEstimateDeliveryDate}
                                            disabled={isEstimatingDate || isFieldDisabled('delivery_date')}
                                            className="text-[10px] text-primary-600 hover:text-primary-700 font-bold flex items-center gap-1 hover:underline disabled:opacity-50"
                                            title="حساب موعد التسليم المقترح آلياً بناءً على طاقة المعمل والتاريخ"
                                        >
                                            {isEstimatingDate ? (
                                                <Loader2 size={10} className="animate-spin" />
                                            ) : (
                                                <Sparkles size={10} />
                                            )}
                                            <span>حساب المقترح</span>
                                        </button>
                                    )}
                                </div>
                                <DateField
                                    ariaLabel="موعد التسليم"
                                    size="sm"
                                    value={deliveryDate}
                                    onChange={(val) => {
                                        setDeliveryDate(val);
                                        setDateEstimateInfo(null);
                                    }}
                                    disabled={isFieldDisabled('delivery_date')}
                                />
                                {dateEstimateInfo && (
                                    <div className="mt-1 text-[10px] text-primary-700 bg-primary-50 border border-primary-100 rounded px-1.5 py-0.5 flex items-center justify-between">
                                        <span>
                                            {dateEstimateInfo.confidence === 'high'
                                                ? 'ثقة عالية'
                                                : dateEstimateInfo.confidence === 'moderate'
                                                ? 'ثقة متوسطة'
                                                : 'تقدير افتراضي'}
                                        </span>
                                        {dateEstimateInfo.days !== null && (
                                            <span>({dateEstimateInfo.days} يوم)</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className={clsx(segmentWrapClass, "mt-3")}>
                            <button type="button" onClick={() => setDeliveryType('Final')} disabled={isFieldDisabled('delivery_type')} className={clsx(segmentButtonClass, deliveryType === 'Final' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'text-surface-500 hover:text-surface-700')}>Final</button>
                            <button type="button" onClick={() => setDeliveryType('TryIn')} disabled={isFieldDisabled('delivery_type')} className={clsx(segmentButtonClass, deliveryType === 'TryIn' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-surface-500 hover:text-surface-700')}>Try-In</button>
                        </div>
                    </Card>

                    {/* Workflow & Execution */}
                    <Card className={sidebarCardClass}>
                        <h3 className="font-bold text-surface-700 text-sm mb-2.5 flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                                <Settings size={15} />
                            </span>
                            تنفيذ العمل
                        </h3>

                        {/* Execution Mode: Internal Lab vs External Lab */}
                        <div className="mb-3">
                            <label className="text-[10px] font-bold text-surface-500 block mb-1">جهة التنفيذ</label>
                            <div className={segmentWrapClass}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setExecutionMode('internal');
                                        setSelectedSupplier('');
                                    }}
                                    disabled={isFieldDisabled('supplier_id')}
                                    className={clsx(
                                        segmentButtonClass,
                                        executionMode === 'internal'
                                            ? 'bg-primary-600 text-white shadow-sm'
                                            : 'text-surface-600 hover:text-surface-900'
                                    )}
                                >
                                    معمل داخلي
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExecutionMode('external')}
                                    disabled={isFieldDisabled('supplier_id')}
                                    className={clsx(
                                        segmentButtonClass,
                                        executionMode === 'external'
                                            ? 'bg-primary-600 text-white shadow-sm'
                                            : 'text-surface-600 hover:text-surface-900'
                                    )}
                                >
                                    معمل خارجي
                                </button>
                            </div>
                        </div>

                        {/* Execution Mode Specific Controls */}
                        {executionMode === 'internal' ? (
                            <>
                                {/* Internal Lab: Design is always assigned internally */}
                                <div className="mb-3 space-y-1">
                                    <label className="text-[10px] font-bold text-surface-500 block">المصمم المخصص للحالة</label>
                                    <select
                                        title="Designer"
                                        aria-label="Select Designer"
                                        className={selectClass}
                                        value={designerId}
                                        onChange={e => setDesignerId(e.target.value)}
                                        disabled={isFieldDisabled('designer_id')}
                                    >
                                        <option value="">اختر المصمم...</option>
                                        {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>

                                <div className="rounded-lg bg-emerald-50/60 border border-emerald-200/60 p-2 text-center text-xs text-emerald-800 font-medium">
                                    يتم التصميم والتصنيع بالكامل داخل المعمل
                                </div>

                                {/* Route Steps Preview (Phase B2) */}
                                {isLoadingRouteStages && (
                                    <div className="mt-2 text-center text-[11px] text-surface-400">
                                        جاري تحميل خطوات المسار…
                                    </div>
                                )}
                                {!isLoadingRouteStages && routeStagesPreview.length > 0 && (
                                    <div className="mt-2.5 p-2 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700">
                                        <span className="text-[10px] font-bold text-surface-500 block mb-1.5">
                                            خطوات مسار الإنتاج:
                                        </span>
                                        <div className="flex items-center gap-1 flex-wrap text-xs">
                                            {routeStagesPreview.map((stg, idx) => (
                                                <span key={stg.stageId + '-' + idx} className="inline-flex items-center gap-1">
                                                    <span className={clsx(
                                                        "px-2 py-0.5 rounded text-[10px] font-medium border",
                                                        stg.execution === 'external'
                                                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                                                            : "bg-white text-surface-700 border-surface-200 dark:bg-surface-700 dark:text-surface-200 dark:border-surface-600"
                                                    )}>
                                                        {stg.nameAr}
                                                        {stg.execution === 'external' && <span className="text-[9px] text-amber-600 font-bold mr-1">(خارجي)</span>}
                                                    </span>
                                                    {idx < routeStagesPreview.length - 1 && (
                                                        <span className="text-surface-400 text-[10px]">←</span>
                                                    )}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                {/* External Lab: Workflow Type (Full Lab vs Split) */}
                                <div className="mb-3">
                                    <label className="text-[10px] font-bold text-surface-500 block mb-1">نوع سير العمل الخارجي</label>
                                    <div className={segmentWrapClass}>
                                        <button
                                            type="button"
                                            onClick={() => setWorkflowType('full')}
                                            disabled={isFieldDisabled('workflow_type')}
                                            className={clsx(
                                                segmentButtonClass,
                                                workflowType === 'full'
                                                    ? 'bg-primary-100 text-primary-700 shadow-sm'
                                                    : 'text-surface-500 hover:text-surface-700'
                                            )}
                                        >
                                            حالة كاملة (Full Lab)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setWorkflowType('split')}
                                            disabled={isFieldDisabled('workflow_type')}
                                            className={clsx(
                                                segmentButtonClass,
                                                workflowType === 'split'
                                                    ? 'bg-primary-100 text-primary-700 shadow-sm'
                                                    : 'text-surface-500 hover:text-surface-700'
                                            )}
                                        >
                                            تصميم عندنا (Split)
                                        </button>
                                    </div>
                                </div>

                                {/* Designer select when external split workflow */}
                                {workflowType === 'split' && (
                                    <div className="mb-3 space-y-1">
                                        <label className="text-[10px] font-bold text-surface-500 block">المصمم (المسؤول عن التصميم)</label>
                                        <select
                                            title="Designer"
                                            aria-label="Select Designer"
                                            className={selectClass}
                                            value={designerId}
                                            onChange={e => setDesignerId(e.target.value)}
                                            disabled={isFieldDisabled('designer_id')}
                                        >
                                            <option value="">اختر المصمم...</option>
                                            {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                {/* Supplier select for External execution mode */}
                                <div className="space-y-1 animate-in fade-in">
                                    <label className="text-[10px] font-bold text-surface-500 block">
                                        المعمل الخارجي المنفذ <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        title="المعمل الخارجي"
                                        aria-label="Select External Lab"
                                        className={clsx(
                                            selectClass,
                                            !selectedSupplier && hasTriedSubmit && "border-red-500 bg-red-50/20"
                                        )}
                                        value={selectedSupplier}
                                        onChange={e => setSelectedSupplier(e.target.value)}
                                        disabled={isFieldDisabled('supplier_id')}
                                    >
                                        <option value="">اختر المعمل الخارجي...</option>
                                        {visibleSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    {!selectedSupplier && hasTriedSubmit && (
                                        <p className="text-[10px] text-red-600 font-bold">يرجى اختيار المعمل الخارجي</p>
                                    )}
                                </div>
                            </>
                        )}

                        {/* Unrouted items alert for Internal mode */}
                        {unroutedItems.length > 0 && (
                            <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-800">
                                <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-900">
                                    <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                                    <span>تنبيه: خدمات بدون مسار إنتاج مخصص</span>
                                </div>
                                <p className="leading-relaxed text-[11px] text-amber-700">
                                    الخدمة <span className="font-bold">({unroutedItems.map(i => i.serviceType).join('، ')})</span> غير مربوطة بمسار إنتاج مخصص وستعتمد على المسار الافتراضي.
                                </p>
                            </div>
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
                                    disabled={isFieldDisabled('discount')}
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        {/* Admin-only: Lab and Designer Cost Split */}
                        {isAdmin && effectiveWorkflowType === 'split' && (
                            <div className="mt-4 border-t border-white/10 pt-4">
                                <div className="mb-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold text-surface-200">إجمالي التكلفة للحالة</span>
                                        <span className="text-lg font-black text-white">
                                            {((manualCost !== null ? manualCost : calculateAutomaticMillingPrice(items, services, suppliers, selectedSupplier)) + 
                                              (isSalaried ? 0 : (manualDesignPrice !== null ? manualDesignPrice : calculateAutomaticDesignPrice(items, services, designers, designerId)))).toLocaleString()}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-surface-500 mt-1 text-left">مجموع تكلفة المعمل والمصمم (يحفظ كالتكلفة الإجمالية)</p>
                                </div>

                                {/* Milling Cost Section */}
                                <div className="mb-4 rounded-xl bg-surface-800/50 p-3 border border-surface-700/50">
                                    <div className="flex items-center gap-1.5 mb-3 border-b border-surface-700/50 pb-2">
                                        <Lock size={12} className="text-amber-400" />
                                        <span className="text-xs font-bold text-amber-400">تكلفة المعمل (التصنيع)</span>
                                    </div>
                                    <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                                        <span className="font-bold text-surface-300">الرقم الافتراضي</span>
                                        <span className="font-mono font-bold text-surface-100">
                                            {calculateAutomaticMillingPrice(items, services, suppliers, selectedSupplier).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center gap-3">
                                        <span className="text-xs font-bold text-surface-300">خانة اليدوي</span>
                                        <div className="flex h-9 w-32 items-center gap-1 rounded-lg border border-amber-500/30 bg-black/20 px-2 focus-within:border-amber-500/60 transition-colors">
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
                                </div>

                                {/* Designer Cost Section */}
                                <div className="rounded-xl bg-surface-800/50 p-3 border border-surface-700/50">
                                    <div className="flex items-center gap-1.5 mb-3 border-b border-surface-700/50 pb-2">
                                        <Lock size={12} className="text-indigo-400" />
                                        <span className="text-xs font-bold text-indigo-400">تكلفة المصمم</span>
                                        {isSalaried && (
                                            <span className="ml-auto text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">
                                                مرتب ثابت (وهمي للمراجعة)
                                            </span>
                                        )}
                                    </div>
                                    <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                                        <span className="font-bold text-surface-300">
                                            {isSalaried ? 'الرقم الافتراضي (للمراجعة)' : 'الرقم الافتراضي'}
                                        </span>
                                        <div className="flex gap-2 items-center">
                                            {isSalaried && (
                                                <span className="font-mono font-bold text-surface-400 line-through">0</span>
                                            )}
                                            <span className={clsx("font-mono font-bold", isSalaried ? "text-indigo-300" : "text-surface-100")}>
                                                {calculateAutomaticDesignPrice(items, services, designers, designerId).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center gap-3">
                                        <span className="text-xs font-bold text-surface-300">خانة اليدوي</span>
                                        <div className="flex h-9 w-32 items-center gap-1 rounded-lg border border-indigo-500/30 bg-black/20 px-2 focus-within:border-indigo-500/60 transition-colors">
                                            <DollarSign size={12} className="text-indigo-400" />
                                            <input
                                                type="number"
                                                min="0"
                                                className="w-full bg-transparent text-right text-sm font-bold outline-none text-indigo-300 placeholder-surface-600"
                                                value={manualDesignPrice ?? ''}
                                                onChange={(e) => setManualDesignPrice(e.target.value === '' ? null : Number(e.target.value))}
                                                placeholder="تلقائي"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Admin-only: Manual Cost Override (Full Workflow) */}
                        {isAdmin && effectiveWorkflowType === 'full' && (
                            <div className="mt-4 border-t border-white/10 pt-4">
                                <div className="mb-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold text-surface-200">إجمالي التكلفة للحالة</span>
                                        <span className="text-lg font-black text-white">
                                            {(manualCost !== null ? manualCost : calculateAutomaticCost()).toLocaleString()}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-surface-500 mt-1 text-left">التكلفة الإجمالية للمعمل (شاملة)</p>
                                </div>

                                {/* Lab Cost Section */}
                                <div className="rounded-xl bg-surface-800/50 p-3 border border-surface-700/50">
                                    <div className="flex items-center gap-1.5 mb-3 border-b border-surface-700/50 pb-2">
                                        <Lock size={12} className="text-amber-400" />
                                        <span className="text-xs font-bold text-amber-400">تكلفة المعمل (شاملة)</span>
                                    </div>
                                    <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                                        <span className="font-bold text-surface-300">الرقم الافتراضي</span>
                                        <span className="font-mono font-bold text-surface-100">
                                            {calculateAutomaticCost().toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center gap-3">
                                        <span className="text-xs font-bold text-surface-300">خانة اليدوي</span>
                                        <div className="flex h-9 w-32 items-center gap-1 rounded-lg border border-amber-500/30 bg-black/20 px-2 focus-within:border-amber-500/60 transition-colors">
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
                                </div>
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
                                <>
                                    <Input label="العنوان" required placeholder="القاهرة، مصر" value={newDoctor.address} onChange={e => setNewDoctor({ ...newDoctor, address: e.target.value })} />
                                    <div>
                                        <label className="block text-xs font-bold text-surface-600 mb-1">تعليمات دائمة للمعمل (اختياري)</label>
                                        <textarea
                                            rows={2}
                                            placeholder="تعليمات خاصة بالفنيين..."
                                            className="w-full p-2 border border-surface-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary-500/20"
                                            value={newDoctor.labInstructions}
                                            onChange={e => setNewDoctor({ ...newDoctor, labInstructions: e.target.value })}
                                        />
                                    </div>
                                </>
                            )}

                            <Button onClick={handleAddDoctorFull} className="w-full mt-2">
                                <span>حفظ</span>
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {showAddBranchModal && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-md animate-in zoom-in-95 text-right">
                        <div className="p-4 border-b border-surface-100 bg-surface-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-base text-surface-900">إضافة فرع جديد</h2>
                            <button onClick={() => setShowAddBranchModal(false)} aria-label="Close"><X size={18} className="text-surface-400 hover:text-surface-600" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            {branchError && (
                                <div className="bg-red-50 text-red-600 text-xs font-bold p-2 rounded flex items-center gap-2">
                                    <AlertTriangle size={14} /> {branchError}
                                </div>
                            )}
                            
                            <Input label="اسم الفرع" required placeholder="مثال: فرع المعادي" value={newBranch.name} onChange={e => setNewBranch({ ...newBranch, name: e.target.value })} />
                            <Input label="العنوان (اختياري)" placeholder="مثال: 12 شارع النصر" value={newBranch.address} onChange={e => setNewBranch({ ...newBranch, address: e.target.value })} />
                            <Input label="رقم الهاتف (اختياري)" placeholder="مثال: 01xxxxxxxxx" value={newBranch.phone} onChange={e => setNewBranch({ ...newBranch, phone: e.target.value })} />

                            <Button onClick={handleQuickAddBranch} className="w-full mt-2">
                                <span>حفظ الفرع</span>
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {showSlipPrint && initialData && (
                <CaseSlipPrint
                    order={initialData}
                    doctor={doctors.find(d => d.id === initialData.doctorId)}
                    onClose={() => setShowSlipPrint(false)}
                />
            )}
        </form>
    );
}
