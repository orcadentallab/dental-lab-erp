/**
 * Case files on Supabase Storage.
 *
 * The bucket is PRIVATE. Reads go through short-lived signed URLs rather than
 * public links, because these are photographs of patients' work: a public URL,
 * once seen, can never be taken back.
 *
 * The old pasted-link fields (orders.images_url / stl_url / design_url) are
 * untouched and keep working. This is additive.
 */
import { supabase } from './supabase';
import { ErrorHandler } from './errorHandler';

const BUCKET = 'case-files';

/** Kept in step with the CHECK on order_attachments.kind. */
export type AttachmentKind = 'instruction' | 'design' | 'qc' | 'packaging' | 'issue';

export interface CaseAttachment {
    id: string;
    orderId: string;
    stageRunId: string | null;
    storagePath: string;
    kind: AttachmentKind;
    caption: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    createdAt: string;
}

/** Mirrors the bucket's own limit, so the UI can refuse before uploading. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

function safeName(name: string): string {
    // Storage keys are path segments: strip anything that would nest a folder
    // or confuse a signed URL.
    return name.replace(/[^\w.-]+/g, '_').slice(-80);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toAttachment(r: any): CaseAttachment {
    return {
        id: r.id,
        orderId: r.order_id,
        stageRunId: r.stage_run_id ?? null,
        storagePath: r.storage_path,
        kind: r.kind,
        caption: r.caption ?? null,
        mimeType: r.mime_type ?? null,
        sizeBytes: r.size_bytes ?? null,
        createdAt: r.created_at,
    };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Uploads one file and records it against the case.
 *
 * The object and the row are written separately, so if the row fails the
 * object is removed again -- otherwise the bucket slowly fills with files
 * nothing points at and nobody can find.
 */
export async function uploadCaseFile(
    file: File,
    opts: { orderId: string; kind: AttachmentKind; stageRunId?: string; caption?: string },
): Promise<CaseAttachment> {
    if (file.size > MAX_FILE_BYTES) {
        throw new Error('الملف أكبر من 10 ميجا');
    }

    const path = `${opts.orderId}/${opts.kind}/${Date.now()}_${safeName(file.name)}`;

    const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

    if (upErr) throw ErrorHandler.handle(upErr, 'uploadCaseFile.upload');

    const { data, error } = await supabase
        .from('order_attachments')
        .insert({
            order_id: opts.orderId,
            stage_run_id: opts.stageRunId ?? null,
            storage_path: path,
            kind: opts.kind,
            caption: opts.caption ?? null,
            mime_type: file.type || null,
            size_bytes: file.size,
        })
        .select('*')
        .single();

    if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw ErrorHandler.handle(error, 'uploadCaseFile.record');
    }

    return toAttachment(data);
}

export async function getAttachments(
    orderId: string,
    kind?: AttachmentKind,
): Promise<CaseAttachment[]> {
    let query = supabase
        .from('order_attachments')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

    if (kind) query = query.eq('kind', kind);

    const { data, error } = await query;
    if (error) throw ErrorHandler.handle(error, 'getAttachments');

    return (data || []).map(toAttachment);
}

/**
 * A viewable link, valid for an hour. Deliberately short: a link that lives
 * forever is a public file with extra steps.
 */
export async function getSignedUrl(storagePath: string, seconds = 3600): Promise<string | null> {
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, seconds);

    if (error) {
        console.error('[storage] signed url failed', error);
        return null;
    }
    return data?.signedUrl ?? null;
}

/** Signs a batch in one round trip, for a card showing several thumbnails. */
export async function getSignedUrls(
    paths: string[],
    seconds = 3600,
): Promise<Record<string, string>> {
    if (paths.length === 0) return {};

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, seconds);

    if (error) {
        console.error('[storage] batch signed urls failed', error);
        return {};
    }

    const out: Record<string, string> = {};
    (data || []).forEach((d) => {
        if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
    });
    return out;
}

/** Admin only, enforced by RLS on both the row and the object. */
export async function deleteAttachment(attachment: CaseAttachment): Promise<void> {
    const { error } = await supabase
        .from('order_attachments')
        .delete()
        .eq('id', attachment.id);

    if (error) throw ErrorHandler.handle(error, 'deleteAttachment');

    await supabase.storage.from(BUCKET).remove([attachment.storagePath]);
}
