import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Plus, ScanLine, Send, Trash2, Truck } from 'lucide-react';
import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { useAuth } from '../../context/AuthContext';
import { doctorMessage, formatDoctorText } from '../../translations/doctorPortal';
import { db, type OrderItem, type Service, type ServiceFamily } from '../../services/db';
import { doctorPortalService, type PortalContext } from '../../services/doctorPortalService';
import { ACCEPTED_TYPES, SCAN_ACCEPTED_TYPES, uploadCaseFile, validateCaseFile } from '../../lib/storage';
import { draftLifetime, portalTeeth, readPortalDraft, writePortalDraft, type PendingPortalFile, type PortalCaseDraft } from '../../lib/portalCaseDraft';
import FdiToothChart from '../../components/doctors/FdiToothChart';
import { PortalError, PortalSkeleton } from '../../components/doctors/PortalStates';
import { useCopyCaseReference } from '../../hooks/useCopyCaseReference';
import { Card } from '../../components/ui/Card';

type FormData = Omit<PortalCaseDraft, 'savedAt' | 'step' | 'requestKey' | 'createdOrderId' | 'pendingFiles'>;
type Upload = { id: string; file: File; kind: 'scan' | 'photo'; status: 'queued' | 'uploading' | 'uploaded' | 'failed' };
type Catalog = { context: PortalContext; services: Pick<Service, 'id' | 'name' | 'familyId'>[]; families: ServiceFamily[] };

const blankItem: OrderItem = { serviceType: '', teethNumbers: [], price: 0 };

function emptyForm(context: PortalContext, phone: string): FormData {
    return {
        patientName: '', shade: '', targetDoctorId: context.doctor_id, selectedBranchId: '',
        contactPhone: context.contact_phone || phone, pickupAddress: context.address || '', pickupTiming: '',
        hasBiteRecord: true, intakeType: 'pickup', stlUrl: '', imagesUrl: '', instructions: '', items: [blankItem],
    };
}

function validLink(value: string) {
    if (!value.trim()) return true;
    try { return ['https:', 'http:'].includes(new URL(value.trim()).protocol); } catch { return false; }
}

export default function NewOrderRequest() {
    const { t, locale } = useDoctorLanguage();
    const { user } = useAuth();
    const entityId = user?.entityId || '';
    const copy = useCopyCaseReference();
    const [catalog, setCatalog] = useState<Catalog>();
    const [form, setForm] = useState<FormData>();
    const [initialForm, setInitialForm] = useState<FormData>();
    const [draft, setDraft] = useState(() => readPortalDraft(entityId));
    const [draftSaved, setDraftSaved] = useState(false);
    const [touched, setTouched] = useState(false);
    const [step, setStep] = useState(0);
    const [loadVersion, setLoadVersion] = useState(0);
    const [initialError, setInitialError] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [missingFiles, setMissingFiles] = useState<PendingPortalFile[]>([]);
    const [createdOrderId, setCreatedOrderId] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [caseReference, setCaseReference] = useState<{ orderId: string; value: string }>();
    const displayedReference = caseReference?.orderId === confirmation && caseReference.value ? caseReference.value : confirmation;
    const [requestKey, setRequestKey] = useState<string>(() => crypto.randomUUID());
    const submitting = useRef(false);
    const heading = useRef<HTMLHeadingElement>(null);
    const steps = [t.patientClinicStep, t.serviceTeethStep, t.intakeStep, t.reviewStep];

    useEffect(() => {
        let active = true;
        Promise.all([
            doctorPortalService.catalog(), db.getServiceFamilies().catch(() => []), doctorPortalService.context(),
            entityId ? db.getDoctor(entityId) : Promise.resolve(null),
        ]).then(([services, families, context, doctor]) => {
            if (!active) return;
            setCatalog({ context, families, services: [...services].sort((a, b) => a.name.localeCompare(b.name)) });
            const defaults = emptyForm(context, doctor?.phone || '');
            setInitialForm(defaults);
            setForm(defaults);
        }).catch(() => { if (active) setInitialError(true); });
        return () => { active = false; };
    }, [entityId, loadVersion]);

    useEffect(() => {
        if (!entityId || !form || !touched || draft || confirmation) return;
        const pendingFiles = [...missingFiles, ...uploads.filter(upload => upload.status !== 'uploaded')
            .map(({ file, kind }) => ({ name: file.name, size: file.size, kind }))]
            .filter(file => file.kind !== 'scan' || form.intakeType === 'digital');
        const saved = writePortalDraft(entityId, { ...form, pendingFiles, requestKey, createdOrderId, step, savedAt: Date.now() });
        setDraftSaved(saved);
        if (!saved) return;
        const expiration = window.setTimeout(() => { readPortalDraft(entityId); setDraftSaved(false); }, draftLifetime);
        return () => window.clearTimeout(expiration);
    }, [entityId, form, touched, draft, confirmation, requestKey, createdOrderId, step, uploads, missingFiles]);

    const go = (next: number) => {
        setStep(next);
        setError('');
        requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); });
    };

    const edit = (change: Partial<FormData>) => {
        setForm(previous => previous ? { ...previous, ...change } : previous);
        setTouched(true);
        setError('');
    };

    const restore = () => {
        const current = readPortalDraft(entityId);
        setDraft(null);
        if (!current) return;
        const { savedAt, step: previousStep, requestKey: key, createdOrderId: storedOrder, pendingFiles, ...data } = current;
        if (Date.now() - savedAt >= draftLifetime) return;
        setForm({ ...data, items: data.items.map(item => ({ ...item, teethNumbers: portalTeeth(item.teethNumbers) })) });
        setTouched(true);
        setCreatedOrderId(storedOrder);
        setRequestKey(key);
        setMissingFiles(pendingFiles);
        go(storedOrder || pendingFiles.length ? Math.min(2, previousStep) : previousStep);
    };

    const pickFiles = (event: ChangeEvent<HTMLInputElement>, kind: Upload['kind']) => {
        try {
            const files = Array.from(event.target.files || []);
            files.forEach(validateCaseFile);
            setUploads(previous => [...previous, ...files.map((file): Upload => ({ id: crypto.randomUUID(), file, kind, status: 'queued' }))]);
            setMissingFiles(previous => {
                const matched = [...files];
                return previous.filter(pending => {
                    const index = matched.findIndex(file => pending.kind === kind && pending.name === file.name && pending.size === file.size);
                    if (index < 0) return true;
                    matched.splice(index, 1);
                    return false;
                });
            });
            setTouched(true);
            setError('');
        } catch (cause) {
            setError(doctorMessage(t, cause, t.invalidFiles));
        }
        event.target.value = '';
    };

    if (initialError) return <div className="portal-page max-w-3xl"><h1 className="portal-title">{t.requestTitle}</h1><PortalError message={t.loadRequestError} retry={() => { setInitialError(false); setLoadVersion(value => value + 1); }} /></div>;
    if (!catalog || !form) return <div className="portal-page max-w-3xl"><h1 className="portal-title">{t.requestTitle}</h1><PortalSkeleton label={t.loadingRequest} /></div>;
    const { context, services, families } = catalog;
    const activeUploads = uploads.filter(upload => upload.kind !== 'scan' || form.intakeType === 'digital');
    const activeMissing = missingFiles.filter(file => file.kind !== 'scan' || form.intakeType === 'digital');
    const uploadLabels = { queued: t.uploadQueued, uploading: t.uploadInProgress, uploaded: t.uploadComplete, failed: t.uploadFailed };

    const validate = (index: number) => {
        if (index === 0) {
            if (!form.patientName.trim()) return t.missingPatient;
            if (form.pickupAddress.trim().length < 5) return t.missingAddress;
            if (!form.contactPhone.trim()) return t.missingPhone;
        }
        if (index === 1 && form.items.some(item => !services.some(service => service.name === item.serviceType) || !item.teethNumbers.length)) return t.missingService;
        if (index === 2) {
            if (activeMissing.length) return t.reattachFiles;
            if (form.intakeType === 'digital' && !form.stlUrl.trim() && !activeUploads.some(upload => upload.kind === 'scan') && !createdOrderId) return t.missingScan;
            if (!validLink(form.imagesUrl) || (form.intakeType === 'digital' && !validLink(form.stlUrl))) return t.invalidCaseUrl;
        }
        return '';
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (submitting.current) return;
        const invalid = createdOrderId ? (step === 2 ? validate(2) : '') : validate(step);
        if (invalid) { setError(invalid); return; }
        if (step < 3) { go(step + 1); return; }
        if (!entityId) { setError(t.missingDoctor); return; }
        if (!createdOrderId) {
            const firstInvalid = [0, 1, 2].find(index => validate(index));
            if (firstInvalid !== undefined) { go(firstInvalid); setError(validate(firstInvalid)); return; }
        }
        setBusy(true);
        setError('');
        submitting.current = true;
        let activeFile = '';
        try {
            const trays = form.traysCount ?? t.defaultTrays;
            const notes = form.intakeType === 'pickup'
                ? [t.pickupNote, formatDoctorText(t.pickupAddressNote, form.pickupAddress.trim()),
                    form.pickupTiming.trim() && formatDoctorText(t.pickupTimingNote, form.pickupTiming.trim()),
                    trays.trim() && formatDoctorText(t.traysNote, trays.trim()), formatDoctorText(t.biteNote, form.hasBiteRecord ? t.biteIncluded : t.biteUnavailable)]
                : [t.digitalNote, formatDoctorText(t.shippingAddressNote, form.pickupAddress.trim())];

            const orderId = createdOrderId || await doctorPortalService.submit(requestKey, {
                doctor_id: form.targetDoctorId, patient_name: form.patientName.trim(), intake_type: form.intakeType,
                items: form.items.map(item => ({ ...item, teethNumbers: portalTeeth(item.teethNumbers), price: 0 })),
                branch_id: form.selectedBranchId, delivery_address: form.pickupAddress.trim(), contact_phone: form.contactPhone,
                shade: form.shade.trim(), instructions: [...notes, form.instructions.trim() && formatDoctorText(t.instructionsNote, form.instructions.trim())].filter(Boolean).join('\n'),
                stl_url: form.intakeType === 'digital' ? form.stlUrl.trim() : '', images_url: form.imagesUrl.trim(),
                pickup_timing: form.pickupTiming, trays_details: trays, has_bite_record: form.hasBiteRecord,
            });
            setCreatedOrderId(orderId);
            for (const upload of activeUploads.filter(file => file.status !== 'uploaded')) {
                activeFile = upload.id;
                setUploads(previous => previous.map(item => item.id === upload.id ? { ...item, status: 'uploading' } : item));
                await uploadCaseFile(upload.file, { orderId, kind: 'instruction', caption: upload.kind === 'scan' ? formatDoctorText(t.scanNote, upload.file.name) : upload.file.name });
                setUploads(previous => previous.map(item => item.id === upload.id ? { ...item, status: 'uploaded' } : item));
                activeFile = '';
            }
            writePortalDraft(entityId, null);
            setConfirmation(orderId);
            // The submit RPC returns the internal ID. Reuse the existing case list
            // read for the clinic-facing reference without delaying confirmation.
            void db.getMyDoctorOrders().then(orders => {
                setCaseReference({ orderId, value: orders.find(order => order.id === orderId)?.caseId || '' });
            }).catch(() => {});
            setDraftSaved(false);
            requestAnimationFrame(() => { heading.current?.focus(); });
        } catch (cause) {
            if (activeFile) setUploads(previous => previous.map(item => item.id === activeFile ? { ...item, status: 'failed' } : item));
            setError(doctorMessage(t, cause, activeFile ? t.attachmentUploadError : t.submitRequestError));
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    };

    if (confirmation) return <div className="portal-page max-w-3xl">
        <Card initial={false} className="portal-card space-y-5">
            <CheckCircle2 size={42} aria-hidden="true" className="text-emerald-700 dark:text-emerald-300" />
            <h1 ref={heading} tabIndex={-1} className="portal-title">{t.caseReceivedTitle}</h1>
            <div>
                <p className="portal-muted">{t.submissionReference}</p>
                <button className="portal-chip max-w-full gap-2" type="button" onClick={() => void copy(displayedReference)} aria-label={t.copyCaseReference}>
                    <bdi dir="ltr" className="break-all tabular-nums">{displayedReference}</bdi><Copy size={16} aria-hidden="true" className="shrink-0" />
                </button>
            </div>
            <div>
                <h2 className="font-bold">{t.whatNext}</h2>
                <ol className="mt-2 list-decimal space-y-1 ps-6 text-sm"><li>{t.stageReceived}</li><li>{t.stageDesignShort}</li><li>{t.nextProduction}</li></ol>
            </div>
            <div className="flex flex-wrap gap-2">
                <Link className="portal-primary" to="/doctor/my-orders">{t.viewMyCases}</Link>
                <button className="portal-chip" type="button" onClick={() => { setTouched(false); setForm(initialForm); setUploads([]); setMissingFiles([]); setCreatedOrderId(''); setConfirmation(''); setCaseReference(undefined); setRequestKey(crypto.randomUUID()); go(0); }}>{t.sendAnotherCase}</button>
            </div>
        </Card>
    </div>;

    const updateItem = (index: number, change: Partial<OrderItem>) => edit({ items: form.items.map((item, position) => position === index ? { ...item, ...change } : item) });
    const availableBranches = context.branches || [];
    const branch = availableBranches.find(item => item.id === form.selectedBranchId);
    const field = (label: string, name: 'patientName' | 'shade' | 'contactPhone' | 'pickupAddress' | 'pickupTiming' | 'traysCount' | 'stlUrl' | 'imagesUrl', options: { type?: string; required?: boolean; placeholder?: string; maxLength?: number } = {}) =>
        <label className="portal-field">{label}
            <input className="portal-input" dir={options.type === 'tel' || options.type === 'url' ? 'ltr' : 'auto'} {...options}
                value={form[name] ?? (name === 'traysCount' ? t.defaultTrays : '')} onChange={event => edit({ [name]: event.target.value })} />
        </label>;

    return <div className="portal-page max-w-3xl">
        <header><h1 className="portal-title">{t.requestTitle}</h1><p className="portal-muted">{t.requestIntro}</p></header>
        {draft && <Card initial={false} className="portal-card space-y-2">
            <p className="portal-muted">{t.draftPrompt}</p>
            <div className="flex flex-wrap gap-2">
                <button type="button" className="portal-primary" onClick={restore}>{t.restoreDraft}</button>
                <button type="button" className="portal-chip" onClick={() => { writePortalDraft(entityId, null); setDraft(null); }}>{t.discardDraft}</button>
            </div>
        </Card>}
        {!draft && <form onSubmit={submit} className="space-y-4" noValidate>
            <Card initial={false} className="portal-card space-y-3">
                <p className="portal-muted text-xs font-semibold">{formatDoctorText(t.wizardProgress, (step + 1).toLocaleString(locale), steps.length.toLocaleString(locale))}</p>
                <ol aria-label={t.requestTitle} className="grid grid-cols-4 gap-2">
                    {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}
                        className={'rounded-md border-t-4 pt-2 text-xs leading-snug ' + (index <= step ? 'border-blue-700 font-bold dark:border-blue-400' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}>{label}</li>)}
                </ol>
            </Card>
            <Card initial={false} className="portal-card min-h-64 space-y-4">
                <h2 ref={heading} tabIndex={-1} className="portal-section-title text-lg font-bold">{steps[step]}</h2>
                {step === 0 && <div className="grid gap-4 sm:grid-cols-2">
                    {field(t.patientName, 'patientName', { required: true, placeholder: t.patientPlaceholder })}
                    {field(t.shade, 'shade', { placeholder: t.shadeExample })}
                    {context.is_center && <label className="portal-field">{t.caseDentist}<select aria-label={t.caseDentist} className="portal-input" value={form.targetDoctorId} onChange={event => edit({ targetDoctorId: event.target.value })}>{context.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
                    <label className="portal-field">{t.chooseBranch}
                        <select aria-label={t.chooseBranch} className="portal-input" value={form.selectedBranchId} onChange={event => {
                            const id = event.target.value;
                            const selected = availableBranches.find(item => item.id === id);
                            edit({ selectedBranchId: id, pickupAddress: selected?.address || (id ? '' : context.address), contactPhone: selected?.phone || initialForm?.contactPhone || '' });
                        }}><option value="">{context.clinic_name || context.name || t.mainClinic}</option>{availableBranches.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
                    </label>
                    {field(t.shippingPhone, 'contactPhone', { type: 'tel', required: true })}
                    {field(t.shippingAddress, 'pickupAddress', { required: true, maxLength: 500 })}
                    <p className="portal-muted text-xs sm:col-span-2">{t.addressHelp}</p>
                </div>}
                {step === 1 && <>
                    {!services.length && <p role="alert" className="portal-muted">{t.noServices}</p>}
                    {form.items.map((item, index) => <section key={index} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold">{formatDoctorText(t.serviceItem, (index + 1).toLocaleString(locale))}</h3>
                            {form.items.length > 1 && <button type="button" className="portal-action text-rose-700 dark:text-rose-300" aria-label={t.removeService} onClick={() => edit({ items: form.items.filter((_, i) => i !== index) })}><Trash2 size={18} /></button>}
                        </div>
                        <label className="portal-field">{t.serviceType}
                            <select aria-label={t.serviceType} className="portal-input" value={item.serviceType} onChange={event => updateItem(index, { serviceType: event.target.value })} required>
                                <option value="" disabled>{t.chooseService}</option>
                                {families.map(family => {
                                    const entries = services.filter(service => service.familyId === family.id);
                                    return entries.length > 0 && <optgroup key={family.id} label={family.nameAr}>{entries.map(service => <option value={service.name} key={service.id}>{service.name}{family.defaultServiceId === service.id ? ' ' + t.defaultService : ''}</option>)}</optgroup>;
                                })}
                                {services.filter(service => !families.some(family => family.id === service.familyId)).map(service => <option value={service.name} key={service.id}>{service.name}</option>)}
                            </select>
                        </label>
                        <FdiToothChart selected={item.teethNumbers} onChange={teethNumbers => updateItem(index, { teethNumbers })} disabled={busy} />
                    </section>)}
                    <button className="portal-chip" type="button" disabled={!services.length} onClick={() => edit({ items: [...form.items, blankItem] })}><Plus size={16} aria-hidden="true" />{t.addService}</button>
                </>}
                {step === 2 && <>
                    {!createdOrderId && <div role="group" aria-label={t.intakeStep} className="grid grid-cols-2 gap-2">
                        <button type="button" className="portal-chip" aria-pressed={form.intakeType === 'pickup'} onClick={() => edit({ intakeType: 'pickup' })}><Truck size={18} aria-hidden="true" />{t.physicalPickup}</button>
                        <button type="button" className="portal-chip" aria-pressed={form.intakeType === 'digital'} onClick={() => edit({ intakeType: 'digital' })}><ScanLine size={18} aria-hidden="true" />{t.digitalCase}</button>
                    </div>}
                    {form.intakeType === 'pickup' && !createdOrderId && <>
                        <div className="grid gap-3 sm:grid-cols-2">{field(t.pickupAvailability, 'pickupTiming')}{field(t.trayCount, 'traysCount')}</div>
                        <label className="portal-action justify-start gap-2"><input type="checkbox" className="h-5 w-5 accent-blue-700" checked={form.hasBiteRecord} onChange={event => edit({ hasBiteRecord: event.target.checked })} />{t.hasBiteRecord}</label>
                    </>}
                    {form.intakeType === 'digital' && <>
                        {!createdOrderId && field(t.scanFilesLink, 'stlUrl', { type: 'url', placeholder: t.scanUrlExample })}
                        <label className="portal-field">{t.uploadScans}<input className="portal-input" type="file" aria-label={t.uploadScans} multiple accept={SCAN_ACCEPTED_TYPES} onChange={event => pickFiles(event, 'scan')} /><span className="portal-muted text-xs">{t.uploadScansWithTypes}. {t.scanFileLimit}</span></label>
                    </>}
                    {!createdOrderId && field(t.additionalPhotosLabel, 'imagesUrl', { type: 'url', placeholder: t.photoUrlExample })}
                    <label className="portal-field">{t.optionalPhotos}<input className="portal-input" type="file" aria-label={t.optionalPhotos} multiple accept={ACCEPTED_TYPES} onChange={event => pickFiles(event, 'photo')} /><span className="portal-muted text-xs">{t.photoFileLimit}</span></label>
                    {!createdOrderId && <label className="portal-field">{t.labInstructions}<textarea className="portal-input" rows={3} value={form.instructions} onChange={event => edit({ instructions: event.target.value })} /></label>}
                </>}
                {step === 3 && <div className="space-y-4">
                    <dl className="grid gap-3 sm:grid-cols-2">
                        <div><dt className="portal-muted">{t.patientName}</dt><dd className="font-semibold break-words">{form.patientName}</dd></div>
                        <div><dt className="portal-muted">{t.shippingClinic}</dt><dd className="font-semibold break-words">{branch?.name || context.clinic_name || context.name || t.mainClinic}</dd><dd className="break-words">{form.pickupAddress}</dd><dd><bdi dir="ltr">{form.contactPhone}</bdi></dd></div>
                        <div><dt className="portal-muted">{t.intakeStep}</dt><dd>{form.intakeType === 'pickup' ? t.physicalPickup : t.digitalCase}</dd></div>
                        {form.shade && <div><dt className="portal-muted">{t.shade}</dt><dd dir="auto">{form.shade}</dd></div>}
                        {context.is_center && <div><dt className="portal-muted">{t.caseDentist}</dt><dd>{context.members.find(member => member.id === form.targetDoctorId)?.name}</dd></div>}
                        {form.intakeType === 'pickup' && <><div><dt className="portal-muted">{t.trayCount}</dt><dd>{form.traysCount ?? t.defaultTrays}</dd><dd>{form.hasBiteRecord ? t.biteIncluded : t.biteUnavailable}</dd></div>
                            {form.pickupTiming && <div><dt className="portal-muted">{t.pickupAvailability}</dt><dd dir="auto">{form.pickupTiming}</dd></div>}</>}
                    </dl>
                    <div><h3 className="font-bold">{t.requestedServices}</h3><ul className="mt-2 space-y-1">{form.items.map((item, index) => <li key={index} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><span>{item.serviceType}</span><bdi dir="ltr" className="tabular-nums">{item.teethNumbers.join(', ')}</bdi></li>)}</ul></div>
                    {(Boolean(form.imagesUrl) || (form.intakeType === 'digital' && Boolean(form.stlUrl))) && <div><h3 className="font-bold">{t.filesToSend}</h3><ul className="space-y-1">
                        {form.intakeType === 'digital' && form.stlUrl && <li>{t.scanFilesLink} <bdi className="break-all">{form.stlUrl}</bdi></li>}{form.imagesUrl && <li>{t.additionalPhotosLabel} <bdi className="break-all">{form.imagesUrl}</bdi></li>}
                    </ul></div>}
                    {form.instructions && <div><h3 className="font-bold">{t.labInstructions}</h3><p dir="auto" className="whitespace-pre-wrap break-words">{form.instructions}</p></div>}
                </div>}
                {step === 2 && activeMissing.length > 0 && <div className="space-y-2">
                    <p className="portal-muted">{t.reattachFiles}</p>
                    <ul>{activeMissing.map((file, index) => <li key={file.name + index} className="flex items-center justify-between gap-2">
                        <bdi className="break-all">{file.name}</bdi>
                        <button type="button" className="portal-action" aria-label={t.remove + ' ' + file.name} onClick={() => setMissingFiles(previous => previous.filter(item => item !== file))}><Trash2 size={16} /></button>
                    </li>)}</ul>
                </div>}
                {step >= 2 && activeUploads.length > 0 && <div className="space-y-2" aria-live="polite">
                    <p className="portal-muted">{formatDoctorText(t.uploadCount, activeUploads.filter(file => file.status === 'uploaded').length.toLocaleString(locale), activeUploads.length.toLocaleString(locale))}</p>
                    <ul className="space-y-2">{activeUploads.map(upload => <li className="flex items-center gap-2 rounded-xl bg-slate-100 p-2 dark:bg-slate-800" key={upload.id}>
                        <div className="min-w-0 flex-1"><p dir="auto" className="break-all text-sm font-semibold">{upload.file.name}</p><p className="portal-muted text-xs">{uploadLabels[upload.status]}</p>{upload.status === 'uploading' && <progress aria-label={t.uploadInProgress} className="h-1.5 w-full accent-blue-700" />}</div>
                        {step === 2 && upload.status !== 'uploaded' && <button type="button" className="portal-action" aria-label={t.remove + ' ' + upload.file.name} onClick={() => setUploads(previous => previous.filter(item => item.id !== upload.id))}><Trash2 size={16} /></button>}
                    </li>)}</ul>
                </div>}
                {error && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">{error} {createdOrderId && t.retryFilesNotice}</p>}
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
                {step > (createdOrderId ? 2 : 0) && <button type="button" className="portal-chip" disabled={busy} onClick={() => go(step - 1)}>{t.wizardBack}</button>}
                <button type="submit" disabled={busy || (step === 1 && services.length === 0)} className="portal-primary ms-auto">
                    {step === 3 && <Send size={16} aria-hidden="true" />}
                    {busy ? t.sendingRequest : step < 3 ? t.wizardNext : createdOrderId ? t.retryFiles : t.submitCase}
                </button>
            </div>
            {draftSaved && <p className="portal-muted text-xs">{t.draftSaved}</p>}
        </form>}
    </div>;
}
