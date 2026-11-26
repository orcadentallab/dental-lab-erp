import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { doctorPortal } from '../../src/translations/doctorPortal';

describe('Admin Announcements & Promotional Push', () => {
    it('keeps case_update independent of promotional_enabled in send-push', () => {
        const src = readFileSync('supabase/functions/send-push/index.ts', 'utf8');
        expect(src).toContain("category: 'case_update'");
        expect(src).toContain("category: 'promotional'");
        expect(src).toContain(".eq('promotional_enabled', true)");
        expect(src).toContain("url = '/doctor/my-orders'");
        expect(src).toContain("from('announcement_sends').insert");
    });

    it('provides clear EN and AR copy for the doctor portal promotional toggle', () => {
        expect(doctorPortal.en.promoMessagesLabel).toBe('Promotional messages');
        expect(doctorPortal.en.promoMessagesHelp).toContain('Case status updates always stay active');
        expect(doctorPortal.ar.promoMessagesLabel).toBe('العروض والرسائل الترويجية');
        expect(doctorPortal.ar.promoMessagesHelp).toContain('إشعارات مراحل الحالات تظل مفعّلة دائمًا');
    });

    it('enforces ~180 char body cap and house-rules reminder in Announcements.tsx', () => {
        const src = readFileSync('src/pages/Announcements.tsx', 'utf8');
        expect(src).toContain('const BODY_MAX = 180;');
        expect(src).toContain('تذكير:');
        expect(src).toContain('get_promotional_push_preview');
        expect(src).toContain("audience_kind: audienceKind");
    });
});
