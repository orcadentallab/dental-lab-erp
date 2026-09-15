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
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import {
    uploadCaseFile, getAttachments, getSignedUrls,
    ACCEPTED_TYPES, type AttachmentKind, type CaseAttachment,
} from '../../lib/storage';
import { Camera, Loader2, FileText, X } from 'lucide-react';

interface Props {
    orderId?: string;
    kind: AttachmentKind;
    /** Ties the file to one step (QC evidence) rather than to the case. */
    stageRunId?: string;
    /** Read-only on the technician's card; the rep and QC can add. */
    canUpload?: boolean;
    label?: string;
    /** Opens the camera straight away on a phone or tablet. */
    useCamera?: boolean;
    compact?: boolean;
    stagedFiles?: File[];
    onStagedFilesChange?: (files: File[]) => void;
}

export default function CaseAttachments({
    orderId, kind, stageRunId, canUpload = false, label, useCamera = false, compact = false,
    stagedFiles = [], onStagedFilesChange,
}: Props) {
    const [items, setItems] = useState<CaseAttachment[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [stagedPreviews, setStagedPreviews] = useState<{ file: File; url: string; isPdf: boolean }[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

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
        try {
            const rows = await getAttachments(orderId, kind);
            setItems(rows);
            setUrls(await getSignedUrls(rows.map((r) => r.storagePath)));
        } catch (e) {
            console.error('[CaseAttachments] load failed', e);
        }
    }, [orderId, kind]);

    useEffect(() => { void load(); }, [load]);

    const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;

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
            setError(err instanceof Error ? err.message : 'تعذّر رفع الملف');
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

    if (items.length === 0 && stagedFiles.length === 0 && !canUpload) return null;

    const size = compact ? 'w-14 h-14' : 'w-20 h-20';

    return (
        <div className="space-y-2" dir="rtl">
            {label && <div className="text-xs text-slate-500">{label}</div>}

            <div className="flex flex-wrap gap-2 items-center">
                {items.map((a) => {
                    const url = urls[a.storagePath];
                    const isPdf = a.mimeType === 'application/pdf';

                    // A signed URL can expire while the screen is open. Saying
                    // so beats a broken-image icon with no explanation.
                    if (!url) {
                        return (
                            <div key={a.id}
                                 className={`${size} rounded-lg bg-slate-100 flex items-center justify-center text-[10px] text-slate-400`}>
                                غير متاح
                            </div>
                        );
                    }

                    return (
                        <a key={a.id} href={url} target="_blank" rel="noreferrer"
                           className={`${size} rounded-lg overflow-hidden border border-slate-200 block bg-slate-50`}
                           title={a.caption ?? ''}>
                            {isPdf ? (
                                <span className="w-full h-full flex items-center justify-center text-slate-500">
                                    <FileText className="w-6 h-6" />
                                </span>
                            ) : (
                                <img src={url} alt={a.caption ?? 'مرفق'}
                                     className="w-full h-full object-cover" loading="lazy" />
                            )}
                        </a>
                    );
                })}

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
                            className="absolute top-0.5 right-0.5 bg-red-600/80 hover:bg-red-600 text-white rounded-full p-0.5 shadow-sm"
                            title="حذف"
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
                            aria-label="إضافة صورة"
                        >
                            {busy
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <Camera className="w-5 h-5" />}
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            accept={ACCEPTED_TYPES}
                            {...(useCamera ? { capture: 'environment' as const } : {})}
                            onChange={(e) => void onPick(e)}
                            className="hidden"
                        />
                    </>
                )}
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
}
