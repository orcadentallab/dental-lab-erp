import { z } from 'zod';

export const upperTeeth = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
export const lowerTeeth = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];

export function portalTeeth(values: string[]): string[] {
    const selected = new Set(values);
    return [...upperTeeth, ...lowerTeeth].filter(tooth => selected.has(tooth));
}

const prefix = 'orca-doctor-case-draft:';
export const draftLifetime = 24 * 60 * 60 * 1000;
const draftSchema = z.object({
    pendingFiles: z.array(z.object({ name: z.string(), size: z.number(), kind: z.enum(['scan', 'photo']) })).default([]),
    savedAt: z.number(),
    step: z.number().int().min(0).max(3),
    requestKey: z.string().uuid(),
    createdOrderId: z.string(),
    patientName: z.string(),
    shade: z.string(),
    targetDoctorId: z.string(),
    selectedBranchId: z.string(),
    contactPhone: z.string(),
    pickupAddress: z.string(),
    pickupTiming: z.string(),
    traysCount: z.string().optional(),
    hasBiteRecord: z.boolean(),
    intakeType: z.enum(['digital', 'pickup']),
    stlUrl: z.string(),
    imagesUrl: z.string(),
    instructions: z.string(),
    items: z.array(z.object({ serviceType: z.string(), teethNumbers: z.array(z.string()), price: z.number() })).min(1),
});

export type PortalCaseDraft = z.infer<typeof draftSchema>;
export type PendingPortalFile = PortalCaseDraft['pendingFiles'][number];

export function readPortalDraft(doctorId: string) {
    try {
        let result: PortalCaseDraft | null = null;
        for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix))) {
            let value: unknown;
            try { value = JSON.parse(localStorage.getItem(key) || 'null'); } catch { localStorage.removeItem(key); continue; }
            const draft = draftSchema.safeParse(value);
            if (!draft.success || draft.data.savedAt > Date.now() || Date.now() - draft.data.savedAt >= draftLifetime) {
                localStorage.removeItem(key);
            } else if (key === prefix + doctorId) {
                result = draft.data;
            }
        }
        return result;
    } catch {
        return null;
    }
}

export function writePortalDraft(doctorId: string, draft: PortalCaseDraft | null) {
    try {
        if (draft) localStorage.setItem(prefix + doctorId, JSON.stringify(draft));
        else localStorage.removeItem(prefix + doctorId);
        return true;
    } catch {
        return false;
    }
}
