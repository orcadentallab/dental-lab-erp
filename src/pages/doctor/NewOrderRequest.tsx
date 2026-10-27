import { useState, useEffect } from 'react';
import { db, type Doctor, type Service, type ServiceFamily, type OrderItem } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Box, Plus, Trash2, Link as LinkIcon, Image, Send, Truck, UploadCloud, MapPin, Clock, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CaseAttachments from '../../components/orders/CaseAttachments';
import { uploadCaseFile, validateCaseFile, SCAN_ACCEPTED_TYPES } from '../../lib/storage';
import { doctorPortalService, type PortalContext } from '../../services/doctorPortalService';

interface FormOrderItem extends Omit<OrderItem, 'teethNumbers'> {
    teethNumbers: string;
}

type IntakeType = 'pickup' | 'digital';

export default function NewOrderRequest() {
    const { user } = useAuth();
    const { error: toastError, success: toastSuccess } = useToast();
    const navigate = useNavigate();

    // Intake Mode
    const [intakeType, setIntakeType] = useState<IntakeType>('pickup');

    const [services, setServices] = useState<Pick<Service, 'id' | 'name' | 'familyId'>[]>([]);
    const [families, setFamilies] = useState<ServiceFamily[]>([]);
    const [context, setContext] = useState<PortalContext | null>(null);
    const [targetDoctorId, setTargetDoctorId] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [scanFiles, setScanFiles] = useState<File[]>([]);
    const [createdOrderId, setCreatedOrderId] = useState('');
    const [requestKey] = useState(() => crypto.randomUUID());
    const [uploadError, setUploadError] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [initialError, setInitialError] = useState('');
    const [dataLoading, setDataLoading] = useState(true);
    const [doctorInfo, setDoctorInfo] = useState<Doctor | null>(null);

    // Form Common State
    const [patientName, setPatientName] = useState('');
    const [shade, setShade] = useState('');
    const [instructions, setInstructions] = useState('');
    const [stagedInstructionFiles, setStagedInstructionFiles] = useState<File[]>([]);

    // Physical Pickup Specific State
    const [pickupAddress, setPickupAddress] = useState('');
    const [pickupTiming, setPickupTiming] = useState('');
    const [traysCount, setTraysCount] = useState('1 مقاس + عضة');
    const [hasBiteRecord, setHasBiteRecord] = useState(true);

    // Digital Specific State
    const [stlUrl, setStlUrl] = useState('');
    const [imagesUrl, setImagesUrl] = useState('');

    // Items
    const [items, setItems] = useState<FormOrderItem[]>([{ serviceType: '', teethNumbers: '', price: 0 }]);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [data, familiesData, portalContext, doc] = await Promise.all([
                    doctorPortalService.catalog(), db.getServiceFamilies().catch(() => []), doctorPortalService.context(),
                    user?.entityId ? db.getDoctor(user.entityId) : Promise.resolve(null),
                ]);
                setServices(data.sort((a, b) => a.name.localeCompare(b.name)));
                setFamilies(familiesData);
                setContext(portalContext);
                setTargetDoctorId(portalContext.doctor_id);
                setContactPhone(portalContext.contact_phone || doc?.phone || '');
                setDoctorInfo(doc ? { ...doc, address: portalContext.address, branches: portalContext.branches } : null);
                setPickupAddress(portalContext.address || '');
            } catch {
                setInitialError('تعذر تحميل بيانات العيادة أو الخدمات. أعد تحميل الصفحة للمحاولة مرة أخرى.');
            } finally { setDataLoading(false); }
        };
        loadInitialData();
    }, [user?.entityId]);

    const handleAddItem = () => {
        if (services.length > 0) {
            setItems([...items, { serviceType: services[0].name, teethNumbers: '', price: 0 }]);
        }
    };

    const handleRemoveItem = (index: number) => {
        if (items.length > 1) {
            const newItems = [...items];
            newItems.splice(index, 1);
            setItems(newItems);
        }
    };

    const updateItem = (index: number, field: keyof FormOrderItem, value: string | number) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;

        if (!user?.entityId) {
            toastError('خطأ: حسابك غير مرتبط ببيانات طبيب. يرجى مراجعة الإدارة.');
            return;
        }

        if (!patientName.trim()) {
            toastError('يرجى إدخال اسم المريض / الحالة');
            return;
        }

        if (pickupAddress.trim().length < 5) {
            toastError('يرجى إدخال عنوان العيادة التفصيلي لاستلام الحالة والشحن');
            return;
        }

        const invalidItems = items.filter(i => !services.some(s => s.name === i.serviceType) || i.teethNumbers.split(/[\s,،]+/).filter(Boolean).length === 0);
        if (invalidItems.length > 0) {
            toastError('يرجى اختيار خدمة وتحديد أرقام الأسنان لكل بند');
            return;
        }

        if (intakeType === 'digital' && !stlUrl.trim() && !scanFiles.length && !createdOrderId) { toastError('أضف رابط السكان أو ارفع ملف STL / PLY'); return; }
        if (!contactPhone.trim()) { toastError('أضف رقم التواصل للاستلام والشحن'); return; }
        setLoading(true);
        setUploadError('');
        try {

            // Construct structured instructions
            let combinedInstructions = '';
            if (intakeType === 'pickup') {
                combinedInstructions = [
                    '📦 [طلب استلام مقاس فيزيائي من العيادة عبر المندوب]',
                    `• عنوان الاستلام: ${pickupAddress.trim()}`,
                    pickupTiming.trim() ? `• مواعيد الاستلام: ${pickupTiming.trim()}` : null,
                    traysCount.trim() ? `• تفاصيل المقاسات: ${traysCount.trim()}` : null,
                    `• عضة شمعية / ريكورد: ${hasBiteRecord ? 'مرفقة مع الكاست' : 'غير متوفرة'}`,
                    instructions.trim() ? `• ملاحظات الحالة: ${instructions.trim()}` : null
                ].filter(Boolean).join('\n');
            } else {
                combinedInstructions = [
                    '💻 [حالة ديجيتال - ملفات مسح STL / صور]',
                    `• عنوان شحن الحالة: ${pickupAddress.trim()}`,
                    instructions.trim() ? `• ملاحظات الحالة: ${instructions.trim()}` : null
                ].filter(Boolean).join('\n');
            }

            const orderId = createdOrderId || await doctorPortalService.submit(requestKey, {
                doctor_id: targetDoctorId, patient_name: patientName.trim(), intake_type: intakeType,
                items: items.map(item => ({ ...item, teethNumbers: item.teethNumbers.split(/[\s,،]+/).filter(Boolean), price: 0 })),
                branch_id: selectedBranchId, delivery_address: pickupAddress.trim(), contact_phone: contactPhone,
                shade: shade.trim(), instructions: combinedInstructions, stl_url: intakeType === 'digital' ? stlUrl.trim() : '',
                images_url: imagesUrl.trim(), pickup_timing: pickupTiming, trays_details: traysCount, has_bite_record: hasBiteRecord,
            });
            setCreatedOrderId(orderId);
            // Keep the created case and only retry files that did not finish.
            for (const file of scanFiles) {
                await uploadCaseFile(file, { orderId, kind: 'instruction', caption: `سكان: ${file.name}` });
                setScanFiles(remaining => remaining.filter(item => item !== file));
            }
            for (const file of stagedInstructionFiles) {
                await uploadCaseFile(file, { orderId, kind: 'instruction', caption: file.name });
                setStagedInstructionFiles(remaining => remaining.filter(item => item !== file));
            }

            toastSuccess(
                intakeType === 'pickup'
                    ? 'تم تسجيل طلب استلام المقاس للمراجعة. يرجى التواصل مع المعمل لتأكيد موعد الاستلام.'
                    : 'تم إرسال الحالة بنجاح وسيتم البدء في مراجعتها وتصميمها.'
            );
            navigate('/doctor/my-orders');
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : 'تعذر إرسال الطلب أو بعض الملفات. حاول مرة أخرى.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">طلب أوردر جديد</h1>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                    اختر طريقة تسليم الحالة للمعمل: طلب مندوب لاستلام مقاس فيزيائي أو رفع ملفات المسح الرقمي (STL).
                </p>
            </div>

            {uploadError && <p role="alert" className="text-red-600">{uploadError} {createdOrderId && 'الحالة محفوظة. اضغط إعادة رفع الملفات لإكمال نفس الطلب.'}</p>}
            {dataLoading && <p role="status">جاري تحميل بيانات العيادة والخدمات...</p>}
            {initialError && <p role="alert" className="text-red-600">{initialError}</p>}
            {!dataLoading && !initialError && services.length === 0 && <p role="alert" className="text-amber-700">لا توجد خدمات متاحة حاليًا. تواصل مع المعمل لتفعيل قائمة الخدمات.</p>}
            {/* Dual Intake Mode Selector Tabs */}
            <div className="grid grid-cols-2 gap-3 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                <button
                    type="button"
                    onClick={() => setIntakeType('pickup')}
                    className={`py-3 px-3 rounded-xl flex items-center justify-center gap-2.5 font-bold text-xs sm:text-sm transition-all ${
                        intakeType === 'pickup'
                            ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-md shadow-slate-200/50 dark:shadow-none'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <Truck size={18} className="shrink-0" />
                    <span>طلب استلام مقاس فيزيائي</span>
                </button>

                <button
                    type="button"
                    onClick={() => setIntakeType('digital')}
                    className={`py-3 px-3 rounded-xl flex items-center justify-center gap-2.5 font-bold text-xs sm:text-sm transition-all ${
                        intakeType === 'digital'
                            ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-md shadow-slate-200/50 dark:shadow-none'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                    <UploadCloud size={18} className="shrink-0" />
                    <span>حالة ديجيتال (STL)</span>
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <Card className="p-5 space-y-4">
                    {context?.is_center && <label className="block">طبيب الحالة<select aria-label="طبيب الحالة" disabled={!!createdOrderId} className="w-full p-3 border rounded-xl dark:bg-slate-800" value={targetDoctorId} onChange={event => setTargetDoctorId(event.target.value)}>{context.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
                    <h2 className="font-bold flex items-center gap-2"><MapPin size={18} />العيادة وعنوان الشحن</h2>
                    <label className="block text-sm">اختر العيادة أو الفرع
                        <select aria-label="اختر العيادة أو الفرع" className="w-full p-3 border rounded-xl bg-white dark:bg-slate-800" value={selectedBranchId}
                            onChange={event => {
                                const id = event.target.value;
                                setSelectedBranchId(id);
                                setContactPhone(id ? doctorInfo?.branches?.find(branch => branch.id === id)?.phone || context?.contact_phone || '' : context?.contact_phone || '');
                                setPickupAddress(id ? doctorInfo?.branches?.find(branch => branch.id === id)?.address || '' : doctorInfo?.address || '');
                            }}>
                            <option value="">{doctorInfo?.name || 'العيادة الرئيسية'} — العنوان الرئيسي</option>
                            {(doctorInfo?.branches || []).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                        </select>
                    </label>
                    <label className="block text-sm">رقم التواصل للاستلام والشحن<input aria-label="رقم التواصل للاستلام والشحن" type="tel" required dir="ltr" className="w-full p-3 border rounded-xl dark:bg-slate-800" value={contactPhone} onChange={event => setContactPhone(event.target.value)} /></label>
                    <label className="block text-sm">عنوان العيادة / الشحن التفصيلي
                        <input aria-label="عنوان العيادة / الشحن التفصيلي" required minLength={5} maxLength={500} className="w-full p-3 border rounded-xl bg-white dark:bg-slate-800"
                            value={pickupAddress} onChange={event => setPickupAddress(event.target.value)} />
                    </label>
                    <p className="text-xs text-slate-500">العنوان يأتي من ملف الطبيب أو الفرع المختار. تعديله هنا يخص هذا الطلب، وسيستخدم لشحن الحالة سواء كانت ديجيتال أو مقاسًا فيزيائيًا.</p>
                </Card>
                {/* Physical Pickup Info Card */}
                {intakeType === 'pickup' && (
                    <Card className="p-5 border-blue-100 dark:border-blue-900/40 bg-gradient-to-br from-blue-50/40 via-white to-indigo-50/20 dark:from-slate-900 dark:to-slate-850">
                        <div className="flex items-center gap-2 mb-4 text-blue-900 dark:text-blue-300 font-bold text-sm">
                            <Truck size={18} className="text-blue-600" />
                            <span>بيانات استلام المقاس من العيادة</span>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                                        <Clock size={14} className="text-blue-500" />
                                        <span>مواعيد تواجد العيادة / الاستلام</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={pickupTiming}
                                        onChange={e => setPickupTiming(e.target.value)}
                                        placeholder="مثال: يومياً من 3 عصراً إلى 10 مساءً"
                                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                                        <Box size={14} className="text-blue-500" />
                                        <span>عدد المقاسات / الكاستات</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={traysCount}
                                        onChange={e => setTraysCount(e.target.value)}
                                        placeholder="مثال: 1 مقاس علوي + 1 عضة"
                                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <input
                                    type="checkbox"
                                    id="hasBiteRecord"
                                    checked={hasBiteRecord}
                                    onChange={e => setHasBiteRecord(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                />
                                <label htmlFor="hasBiteRecord" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                                    توجد عضة شمعية / سجل إطباقي (Bite Registration) مع المقاس
                                </label>
                            </div>
                        </div>
                    </Card>
                )}

                {/* Patient & Case Info Card */}
                <Card className="p-5 space-y-4">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b border-slate-100 dark:border-slate-800 pb-3">
                        <FileText size={18} className="text-blue-600" />
                        <span>بيانات المريض والحالة</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                            label="اسم المريض / الحالة *" aria-label="اسم المريض / الحالة"
                            required
                            value={patientName}
                            onChange={e => setPatientName(e.target.value)}
                            placeholder="اسم الحالة..."
                        />
                        <Input
                            label="اللون المطلوب (Shade)"
                            value={shade}
                            onChange={e => setShade(e.target.value)}
                            placeholder="مثال: A1, A2, BL2..."
                        />
                    </div>

                    {/* Services and Teeth Table */}
                    <div className="space-y-3 pt-2">
                        <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                            <h3 className="font-bold text-slate-700 dark:text-slate-300 text-xs sm:text-sm flex items-center gap-2">
                                <Box size={16} className="text-blue-600" />
                                الخدمات المطلوبة
                            </h3>
                            <button
                                type="button"
                                onClick={handleAddItem}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                            >
                                <Plus size={14} />
                                <span>إضافة خدمة</span>
                            </button>
                        </div>

                        {items.map((item, index) => (
                            <div key={index} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end bg-slate-50 dark:bg-slate-850 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700">
                                <div className="flex-1">
                                    <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                                        نوع الخدمة
                                    </label>
                                    <select
                                        title="نوع الخدمة"
                                        aria-label="نوع الخدمة"
                                        className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-blue-500 transition-colors dark:text-white"
                                        value={item.serviceType}
                                        onChange={(e) => updateItem(index, 'serviceType', e.target.value)}
                                    >
                                        <option value="" disabled>-- اختر نوع الخدمة --</option>
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
                                        {services.filter(s => !families.some(family => family.id === s.familyId)).length > 0 && (
                                            <optgroup label="🔹 خدمات فردية">
                                                {services.filter(s => !s.familyId).map(s => (
                                                    <option key={s.id} value={s.name}>{s.name}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </select>
                                </div>

                                <div className="flex-[1.5]">
                                    <Input
                                        label="أرقام الأسنان (مفصولة بفاصلة)" aria-label="أرقام الأسنان"
                                        value={item.teethNumbers}
                                        onChange={e => updateItem(index, 'teethNumbers', e.target.value)}
                                        placeholder="مثال: 11, 21, 22"
                                        className="font-mono text-left ltr text-xs sm:text-sm"
                                    />
                                </div>

                                {items.length > 1 && (
                                    <button
                                        type="button"
                                        aria-label="حذف الخدمة"
                                        onClick={() => handleRemoveItem(index)}
                                        className="self-end p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors cursor-pointer"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Digital Links Section */}
                    {intakeType === 'digital' && <section className="space-y-2"><label className="block font-bold">رفع ملفات السكان (STL / PLY)<input aria-label="رفع ملفات السكان" type="file" multiple accept={SCAN_ACCEPTED_TYPES} className="block w-full p-3" onChange={event => { const files = Array.from(event.target.files || []); try { files.forEach(validateCaseFile); setScanFiles(previous => [...previous, ...files]); setUploadError(''); } catch (cause) { setUploadError(cause instanceof Error ? cause.message : 'راجع الملفات'); } event.target.value = ''; }} /></label><p className="text-xs text-slate-500">حتى 50 ميجا لكل ملف. للملفات الأكبر، أضف رابطًا.</p>{scanFiles.map((file, index) => <p key={index}>{file.name}<button type="button" className="text-red-600 p-3" onClick={() => setScanFiles(scanFiles.filter((_, i) => i !== index))}>حذف</button></p>)}</section>}
                    {(
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                                    <LinkIcon size={14} className="text-blue-600" />
                                    <span>رابط ملفات المسح (STL / PLY Link)</span>
                                </label>
                                <Input
                                    className="font-mono text-left ltr text-blue-600 dark:text-blue-400"
                                    placeholder="https://drive.google.com/..."
                                    aria-label="رابط ملفات المسح" type="url"
                                    value={stlUrl}
                                    onChange={e => setStlUrl(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                                    <Image size={14} className="text-teal-600" />
                                    <span>رابط الصور الإضافية (Images Link)</span>
                                </label>
                                <Input
                                    className="font-mono text-left ltr text-blue-600 dark:text-blue-400"
                                    placeholder="https://..."
                                    aria-label="رابط الصور الإضافية" type="url"
                                    value={imagesUrl}
                                    onChange={e => setImagesUrl(e.target.value)}
                                />
                            </div>
                        </div>
                    )}

                    {/* Instructions and Attachments */}
                    <div className="pt-2 space-y-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                ملاحظات وتوجيهات خاصة بالمعمل
                            </label>
                            <textarea
                                className="w-full h-24 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500 text-xs sm:text-sm dark:text-white"
                                placeholder="أي تفاصيل خاصة بتصميم الحالة أو متطلبات الطبيب..."
                                value={instructions}
                                onChange={e => setInstructions(e.target.value)}
                            />
                        </div>

                        <CaseAttachments
                            kind="instruction"
                            canUpload
                            stagedFiles={stagedInstructionFiles}
                            onStagedFilesChange={setStagedInstructionFiles}
                            label="إرفاق صور أو كروكي مع الحالة (اختياري)"
                        />
                    </div>
                </Card>

                {/* Bottom Action & Cost Summary Bar */}
                <Card className="p-4 sm:p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 sticky bottom-18 md:bottom-4 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-800 shadow-xl rounded-2xl">
                    <Button
                        type="submit"
                        size="lg"
                        disabled={loading || dataLoading || services.length === 0 || !!initialError}
                        className="py-3.5 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {loading ? 'جاري الإرسال ورفع الملفات…' : createdOrderId ? 'إعادة رفع الملفات وإكمال الطلب' : (
                            <>
                                <Send size={18} />
                                <span>{intakeType === 'pickup' ? 'تأكيد طلب استلام المقاس' : 'إرسال الحالة للمعمل'}</span>
                            </>
                        )}
                    </Button>
                </Card>
            </form>
        </div>
    );
}
