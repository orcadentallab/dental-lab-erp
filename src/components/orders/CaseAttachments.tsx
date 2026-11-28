import { PortalError, PortalSkeleton } from '../doctors/PortalStates';
import { doctorMessage, type DoctorPortalText } from '../../translations/doctorPortal';
/**
 * Case photos: thumbnails a technician can see at a glance, and a one-tap
 * upload.
 *
 * The point of the read side is that nobody should have to open anything to
 * know what a case needs -- the instruction photos sit on the task card next
 * to the text, before the "start" button.
 *
 * The write side is one button. On a tablet it opens the camera directly,
 * because `capture` is honoured by mobile browsers; on a desktop it is an
 * ordinary file picker.
 */
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import type { ChangeEvent } from 'react';
import {
    uploadCaseFile, getAttachments, getSignedUrls,
    ACCEPTED_TYPES, validateCaseFile, type AttachmentKind, type CaseAttachment,
} from '../../lib/storage';
import { Camera, Loader2, FileText, X, Box } from 'lucide-react';
import { doctorPortalQaEnabled } from '../../lib/doctorPortalQa';

const DoctorModelPreview = lazy(() => import('../doctor/DoctorModelPreview'));

function isCaseScan(file: CaseAttachment, orderId: string) {
    return file.storagePath.startsWith(`${orderId}/instruction/`) && /\.(stl|ply)$/i.test(file.storagePath);
}

interface Props {
    orderId?: string;
    portalText?: DoctorPortalText;
    kind: AttachmentKind;
    /** Ties the file to one step (QC evidence) rather than to the case. */
    stageRunId?: string;
    /** Read-only on the technician's card; the rep and QC can add. */
    canUpload?: boolean;
    label?: string;
    /** Opens the camera straight away on a phone or tablet. */
    useCamera?: boolean;
    compact?: boolean;
    accept?: string;
    stagedFiles?: File[];
    onStagedFilesChange?: (files: File[]) => void;
}

export default function CaseAttachments({
    orderId, portalText, kind, stageRunId, canUpload = false, label, useCamera = false, compact = false,
    stagedFiles = [], onStagedFilesChange, accept = ACCEPTED_TYPES,
}: Props) {
    const [items, setItems] = useState<CaseAttachment[]>([]);
    const [preview, setPreview] = useState<CaseAttachment | null>(null);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [stagedPreviews, setStagedPreviews] = useState<{ file: File; url: string; isPdf: boolean }[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(Boolean(orderId));
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const previewEnabled = doctorPortalQaEnabled && Boolean(portalText) && kind === 'instruction';

    // Sync staged previews
    useEffect(() => {
        if (!orderId) {
            const previews = stagedFiles.map(file => ({
                file,
                url: URL.createObjectURL(file),
                isPdf: file.type === 'application/pdf',
            }));
            setStagedPreviews(previews);

            return () => {
                previews.forEach(p => URL.revokeObjectURL(p.url));
            };
        }
    }, [stagedFiles, orderId]);

    const load = useCallback(async () => {
        if (!orderId) return;
        setLoadingFiles(true);
        setLoadFailed(false);
        try {
            const rows = await getAttachments(orderId, kind);
            setItems(rows);
            const linkFiles = previewEnabled ? rows.filter(row => !isCaseScan(row, orderId)) : rows;
            const signed = await Promise.all([...new Set(linkFiles.map(row => row.storageBucket))].map(bucket => getSignedUrls(linkFiles.filter(row => row.storageBucket === bucket).map(row => row.storagePath), 3600, bucket)));
            setUrls(Object.assign({}, ...signed));
        } catch (e) {
            console.error('[CaseAttachments] load failed', e);
            setLoadFailed(true);
        } finally {
            setLoadingFiles(false);
        }
    }, [orderId, kind, previewEnabled]);

    useEffect(() => { void load(); }, [load]);

    const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;
        try { files.forEach(validateCaseFile); } catch (cause) { setError(portalText ? doctorMessage(portalText, cause, portalText.invalidFiles) : cause instanceof Error ? cause.message : 'راجع الملفات'); return; }

        // If no orderId, stage files locally for later upload on save
        if (!orderId) {
            if (onStagedFilesChange) {
                onStagedFilesChange([...stagedFiles, ...files]);
            }
            if (inputRef.current) inputRef.current.value = '';
            return;
        }

        setBusy(true);
        setError(null);
        try {
            for (const f of files) {
                await uploadCaseFile(f, { orderId, kind, stageRunId });
            }
            await load();
        } catch (err) {
            console.error('[CaseAttachments] upload failed', err);
            setError(portalText ? doctorMessage(portalText, err, portalText.attachmentUploadError) : err instanceof Error ? err.message : 'تعذّر رفع الملف');
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const removeStagedFile = (index: number) => {
        if (onStagedFilesChange) {
            const next = [...stagedFiles];
            next.splice(index, 1);
            onStagedFilesChange(next);
        }
    };

    if (portalText && orderId && loadingFiles) return <PortalSkeleton label={portalText.loadCaseFiles} />;
    if (portalText && orderId && loadFailed) return <PortalError message={portalText.loadCaseFilesError} retry={() => void load()} />;

    if (items.length === 0 && stagedFiles.length === 0 && !canUpload) return null;

    const size = compact ? 'w-14 h-14' : 'w-20 h-20';

    return (
        <div className="space-y-2" dir={portalText ? undefined : 'rtl'}>
            {portalText && orderId && items.length === 0 && <p className="portal-muted">{portalText.emptyCaseFiles}</p>}
            {label && <div className="text-xs text-slate-600 dark:text-slate-300">{label}</div>}

            <div className="flex flex-wrap gap-2 items-center">
                {items.map((a) => {
                    if (previewEnabled && portalText && orderId && isCaseScan(a, orderId)) {
                        const name = a.storagePath.split('/').at(-1);
                        return (
                            <button key={a.id} type="button" className="portal-chip max-w-full"
                                    onClick={() => setPreview(a)}>
                                <Box size={16} aria-hidden="true" />
                                {portalText.previewScan} <bdi className="break-all" dir="ltr">{name}</bdi>
                            </button>
                        );
                    }
                    const url = urls[a.storagePath];
                    const isPdf = !a.mimeType?.startsWith('image/');

                    // A signed URL can expire while the screen is open. Saying
                    // so beats a broken-image icon with no explanation.
                    if (!url) {
                        return (
                            <div key={a.id}
                                 className={`${size} rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs text-slate-600 dark:text-slate-300`}>
                                {portalText?.attachmentUnavailable ?? 'غير متاح'}
                            </div>
                        );
                    }

                    return (
                        <a key={a.id} href={url} target="_blank" rel="noreferrer"
                           className={`${size} rounded-lg overflow-hidden border border-slate-200 block bg-slate-50`}
                           title={portalText ? undefined : a.caption ?? ''} aria-label={portalText?.attachment}>
                            {isPdf ? (
                                <span className="w-full h-full flex items-center justify-center text-slate-500">
                                    <FileText className="w-6 h-6" />
                                </span>
                            ) : (
                                <img src={url} alt={portalText?.attachment ?? a.caption ?? 'مرفق'}
                                     className="w-full h-full object-cover" loading="lazy" />
                            )}
                        </a>
                    );
                })}

                {preview && portalText && (
                    <Suspense fallback={<p role="status" className="portal-muted">{portalText.loadingScan}</p>}>
                        <DoctorModelPreview file={preview} text={portalText} close={() => setPreview(null)} />
                    </Suspense>
                )}

                {/* Staged local previews (before order is saved) */}
                {stagedPreviews.map((p, idx) => (
                    <div key={idx} className={`${size} rounded-lg overflow-hidden border border-indigo-300 relative bg-slate-50 group`}>
                        {p.isPdf ? (
                            <span className="w-full h-full flex items-center justify-center text-slate-500">
                                <FileText className="w-6 h-6" />
                            </span>
                        ) : (
                            <img src={p.url} alt={p.file.name} className="w-full h-full object-cover" />
                        )}
                        <button
                            type="button"
                            onClick={() => removeStagedFile(idx)}
                            className={`absolute top-0.5 ${portalText ? 'start-0.5' : 'right-0.5'} bg-red-600/80 hover:bg-red-600 text-white rounded-full p-0.5 shadow-sm`}
                            title={portalText?.remove ?? 'حذف'}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ))}

                {canUpload && (
                    <>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => inputRef.current?.click()}
                            className={`${size} rounded-lg border-2 border-dashed border-slate-300 text-slate-400 flex items-center justify-center disabled:opacity-50`}
                            aria-label={portalText?.addPhoto ?? 'إضافة صورة'}
                        >
                            {busy
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <Camera className="w-5 h-5" />}
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            accept={accept}
                            capture={useCamera ? 'environment' : undefined}
                            onChange={(e) => void onPick(e)}
                            className="hidden"
                        />
                    </>
                )}
            </div>

            {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{portalText ? doctorMessage(portalText, error, error) : error}</p>}
        </div>
    );
}
