import { useState } from 'react';
import { Phone, Mail, MapPin, Instagram, Facebook } from 'lucide-react';
import { contactService } from '../../services/contactService';
import { useMarketingLanguage } from '../MarketingLanguageContext';
import { getWhatsAppUrl } from '../content';

export default function ContactSection() {
    const { t } = useMarketingLanguage();
    const [formState, setFormState] = useState({ doctorName: '', clinicName: '', phone: '', message: '' });
    const [submitting, setSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const whatsappUrl = getWhatsAppUrl(t.contact.whatsappPrefill);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formState.doctorName.trim() || !formState.phone.trim()) return;

        setSubmitting(true);
        setSubmitStatus('idle');
        try {
            await contactService.submitInquiry(formState);
            setSubmitStatus('success');
            setFormState({ doctorName: '', clinicName: '', phone: '', message: '' });
            setTimeout(() => setSubmitStatus('idle'), 5000);
        } catch {
            setSubmitStatus('error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section className="py-24 bg-brand-offwhite text-brand-black relative overflow-hidden" id="contact">
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-gray-300/40 to-transparent" />
            <div className="absolute -top-64 -right-64 w-96 h-96 bg-brand-blue rounded-full mix-blend-multiply filter blur-[128px] opacity-[0.06]" />
            <div className="absolute -bottom-64 -left-64 w-96 h-96 bg-brand-sky rounded-full mix-blend-multiply filter blur-[128px] opacity-[0.04]" />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                    {/* Left Column: Contact Info */}
                    <div className="flex flex-col items-center text-center lg:items-start lg:text-start">
                        <h2 className="text-brand-blue font-bold tracking-widest uppercase text-sm mb-2">
                            {t.contact.eyebrow}
                        </h2>
                        <h3 className="text-3xl md:text-5xl font-bold text-brand-black mb-6 tracking-tight">
                            {t.contact.heading}
                        </h3>
                        <p className="text-lg text-slate-600 mb-10 max-w-md">{t.contact.subtitle}</p>

                        <div className="space-y-6 mb-12 w-full max-w-sm mx-auto lg:mx-0">
                            <div className="flex items-center gap-4 justify-center lg:justify-start">
                                <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue shrink-0">
                                    <Phone size={20} />
                                </div>
                                <div className="text-start">
                                    <p className="text-sm text-slate-500">{t.contact.callLabel}</p>
                                    <p className="text-lg font-bold text-brand-black" dir="ltr">
                                        +20 103 414 1917
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 justify-center lg:justify-start">
                                <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue shrink-0">
                                    <Mail size={20} />
                                </div>
                                <div className="text-start">
                                    <p className="text-sm text-slate-500">{t.contact.emailLabel}</p>
                                    <p className="text-lg font-bold text-brand-black">orcadentallab@gmail.com</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 justify-center lg:justify-start">
                                <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue shrink-0">
                                    <MapPin size={20} />
                                </div>
                                <div className="text-start">
                                    <p className="text-sm text-slate-500">{t.contact.labLabel}</p>
                                    <p className="text-lg font-bold text-brand-black">{t.contact.locationValue}</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 justify-center lg:justify-start">
                            <a
                                href="https://www.facebook.com/orca.labeg"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Facebook"
                                className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center text-slate-500 hover:bg-brand-blue hover:border-brand-blue hover:text-white cursor-pointer transition-[color,background-color,border-color] duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/50"
                            >
                                <Facebook size={20} />
                            </a>
                            <a
                                href="https://www.instagram.com/orca.labeg/"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Instagram"
                                className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center text-slate-500 hover:bg-brand-blue hover:border-brand-blue hover:text-white cursor-pointer transition-[color,background-color,border-color] duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/50"
                            >
                                <Instagram size={20} />
                            </a>
                        </div>
                    </div>

                    {/* Right Column: Form */}
                    <div className="bg-white rounded-3xl p-8 md:p-10 shadow-xl border border-gray-200 text-start">
                        <h4 className="text-2xl font-bold text-brand-black mb-6">{t.contact.formTitle}</h4>

                        {submitStatus === 'success' && (
                            <div className="mb-6 bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 text-sm font-medium animate-fadeInUp">
                                {t.contact.successMsg}
                            </div>
                        )}
                        {submitStatus === 'error' && (
                            <div className="mb-6 bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm font-medium">
                                {t.contact.errorMsg}
                            </div>
                        )}

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label
                                        htmlFor="doctorName"
                                        className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer"
                                    >
                                        {t.contact.doctorNameLabel}
                                    </label>
                                    <input
                                        type="text"
                                        id="doctorName"
                                        name="doctorName"
                                        required
                                        value={formState.doctorName}
                                        onChange={(e) =>
                                            setFormState((s) => ({ ...s, doctorName: e.target.value }))
                                        }
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300"
                                        placeholder={t.contact.doctorNamePlaceholder}
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor="clinicName"
                                        className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer"
                                    >
                                        {t.contact.clinicNameLabel}
                                    </label>
                                    <input
                                        type="text"
                                        id="clinicName"
                                        name="clinicName"
                                        value={formState.clinicName}
                                        onChange={(e) =>
                                            setFormState((s) => ({ ...s, clinicName: e.target.value }))
                                        }
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300"
                                        placeholder={t.contact.clinicNamePlaceholder}
                                    />
                                </div>
                            </div>
                            <div>
                                <label
                                    htmlFor="phone"
                                    className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer"
                                >
                                    {t.contact.phoneLabel}
                                </label>
                                <input
                                    type="tel"
                                    inputMode="tel"
                                    dir="ltr"
                                    id="phone"
                                    name="phone"
                                    required
                                    value={formState.phone}
                                    onChange={(e) => setFormState((s) => ({ ...s, phone: e.target.value }))}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300"
                                    placeholder={t.contact.phonePlaceholder}
                                />
                            </div>
                            <div>
                                <label
                                    htmlFor="message"
                                    className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer"
                                >
                                    {t.contact.messageLabel}
                                </label>
                                <textarea
                                    id="message"
                                    name="message"
                                    rows={4}
                                    value={formState.message}
                                    onChange={(e) => setFormState((s) => ({ ...s, message: e.target.value }))}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300 resize-none"
                                    placeholder={t.contact.messagePlaceholder}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-brand-blue hover:bg-brand-sky text-white font-bold py-4 rounded-xl cursor-pointer transition-colors duration-300 mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {submitting ? t.contact.sendingBtn : t.contact.submitBtn}
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Small Floating WhatsApp Button (no auto-pop bubble, safe-area padding) */}
            {whatsappUrl && (
                <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] end-4 sm:bottom-6 sm:end-6 z-50">
                    <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                            if (typeof window !== 'undefined') {
                                sessionStorage.setItem('last_wa_click_time', Date.now().toString());
                                const device_type = window.innerWidth < 768 ? 'mobile' : 'desktop';
                                // @ts-expect-error - Google Tag Manager event
                                const dataLayer = window.dataLayer || [];
                                dataLayer.push({
                                    event: 'whatsapp_click',
                                    source: 'floating_button',
                                    page_type: 'marketing_landing',
                                    device_type,
                                });
                            }
                        }}
                        className="bg-[#25D366] text-white p-3 sm:p-3.5 rounded-full shadow-lg hover:scale-105 transition-transform duration-300 cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/50"
                        aria-label={t.contact.whatsappLabel}
                        title={t.contact.whatsappLabel}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 sm:w-7 sm:h-7">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                    </a>
                </div>
            )}
        </section>
    );
}
