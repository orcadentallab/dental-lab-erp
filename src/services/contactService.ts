/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { supabase } from '../lib/supabase';

export interface ContactInquiry {
    id: string;
    doctor_name: string;
    clinic_name: string;
    phone: string;
    message: string;
    status: 'new' | 'contacted' | 'closed';
    created_at: string;
    responded_by?: string;
    responded_at?: string;
    notes?: string;
}

export const contactService = {
    /** Submit a new inquiry from the marketing page (public/anon) */
    async submitInquiry(data: { doctorName: string; clinicName: string; phone: string; message: string }) {
        const { error } = await supabase
            .from('contact_inquiries')
            .insert({
                doctor_name: data.doctorName,
                clinic_name: data.clinicName,
                phone: data.phone,
                message: data.message,
                status: 'new',
            });

        if (error) throw error;
    },

    /** Get all inquiries (for dashboard) */
    async getInquiries(statusFilter?: string) {
        let query = supabase
            .from('contact_inquiries')
            .select('*')
            .order('created_at', { ascending: false });

        if (statusFilter && statusFilter !== 'all') {
            query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || []) as ContactInquiry[];
    },

    /** Get only new (unread) inquiries count */
    async getNewCount(): Promise<number> {
        const { count, error } = await supabase
            .from('contact_inquiries')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'new');

        if (error) throw error;
        return count || 0;
    },

    /** Mark inquiry as contacted */
    async markAsContacted(id: string, respondedBy: string) {
        const { error } = await supabase
            .from('contact_inquiries')
            .update({
                status: 'contacted',
                responded_by: respondedBy,
                responded_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) throw error;
    },

    /** Close an inquiry */
    async closeInquiry(id: string, notes?: string) {
        const { error } = await supabase
            .from('contact_inquiries')
            .update({
                status: 'closed',
                notes: notes || null,
            })
            .eq('id', id);

        if (error) throw error;
    },
};
