import { useState, useEffect } from 'react';
import { Phone, Mail, MapPin, Instagram, Facebook } from 'lucide-react';
import { contactService } from '../../services/contactService';

export default function ContactSection() {
    const [showWaBubble, setShowWaBubble] = useState(false);
    const [formState, setFormState] = useState({ doctorName: '', clinicName: '', phone: '', message: '' });
    const [submitting, setSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        const timer = setTimeout(() => setShowWaBubble(true), 3000);
        return () => clearTimeout(timer);
    }, []);

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
            {/* Background design elements */}
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-gray-300/40 to-transparent"></div>
            <div className="absolute -top-64 -right-64 w-96 h-96 bg-brand-blue rounded-full mix-blend-multiply filter blur-[128px] opacity-[0.06]"></div>
            <div className="absolute -bottom-64 -left-64 w-96 h-96 bg-brand-sky rounded-full mix-blend-multiply filter blur-[128px] opacity-[0.04]"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                    {/* Left Column: Contact Info */}
                    <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
                        <h2 className="text-brand-blue font-bold tracking-widest uppercase text-sm mb-2">Connect With Us</h2>
                        <h3 className="text-3xl md:text-5xl font-bold text-brand-black mb-6 tracking-tight">Ready to elevate your practice?</h3>
                        <p className="text-lg text-slate-600 mb-10 max-w-md">
                            Get in touch to discuss your next complex case, request our full price list, or schedule a lab tour. We're here to support your clinical success.
                        </p>

                        <div className="space-y-6 mb-12 w-full max-w-sm mx-auto lg:mx-0">
                            <div className="flex items-center gap-4 justify-center lg:justify-start">
                                <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue shrink-0">
                                    <Phone size={20} />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm text-slate-500">Call Us / WhatsApp</p>
                                    <p className="text-lg font-bold text-brand-black">+20 103 414 1917</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 justify-center lg:justify-start">
                                <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue shrink-0">
                                    <Mail size={20} />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm text-slate-500">Email</p>
                                    <p className="text-lg font-bold text-brand-black">orcadentallab@gmail.com</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 justify-center lg:justify-start">
                                <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue shrink-0">
                                    <MapPin size={20} />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm text-slate-500">Laboratory</p>
                                    <p className="text-lg font-bold text-brand-black">Cairo, Egypt</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 justify-center lg:justify-start">
                            <a href="https://www.facebook.com/orca.labeg" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center text-slate-500 hover:bg-brand-blue hover:border-brand-blue hover:text-white cursor-pointer transition-[color,background-color,border-color] duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/50">
                                <Facebook size={20} />
                            </a>
                            <a href="https://www.instagram.com/orca.labeg/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="w-12 h-12 rounded-full border border-gray-300 flex items-center justify-center text-slate-500 hover:bg-brand-blue hover:border-brand-blue hover:text-white cursor-pointer transition-[color,background-color,border-color] duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/50">
                                <Instagram size={20} />
                            </a>
                        </div>
                    </div>

                    {/* Right Column: Form */}
                    <div className="bg-white rounded-3xl p-8 md:p-10 shadow-xl border border-gray-200">
                        <h4 className="text-2xl font-bold text-brand-black mb-6">Send us a message</h4>

                        {submitStatus === 'success' && (
                            <div className="mb-6 bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 text-sm font-medium animate-fadeInUp">
                                ✅ Message sent successfully! We'll reach out to you soon.
                            </div>
                        )}
                        {submitStatus === 'error' && (
                            <div className="mb-6 bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm font-medium">
                                ❌ Something went wrong. Please try again or contact us via WhatsApp.
                            </div>
                        )}

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="doctorName" className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer">Doctor Name</label>
                                    <input type="text" id="doctorName" name="doctorName" required value={formState.doctorName} onChange={e => setFormState(s => ({ ...s, doctorName: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300" placeholder="Dr. Mohamed Ali" />
                                </div>
                                <div>
                                    <label htmlFor="clinicName" className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer">Clinic Name</label>
                                    <input type="text" id="clinicName" name="clinicName" value={formState.clinicName} onChange={e => setFormState(s => ({ ...s, clinicName: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300" placeholder="Dental Clinic" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="phone" className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer">Phone Number</label>
                                <input type="tel" inputMode="tel" id="phone" name="phone" required value={formState.phone} onChange={e => setFormState(s => ({ ...s, phone: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300" placeholder="+20..." />
                            </div>
                            <div>
                                <label htmlFor="message" className="block text-sm font-medium text-slate-600 mb-1 cursor-pointer">Message</label>
                                <textarea id="message" name="message" rows={4} value={formState.message} onChange={e => setFormState(s => ({ ...s, message: e.target.value }))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-[box-shadow,border-color] duration-300 resize-none" placeholder="We would like to send a digital case…"></textarea>
                            </div>
                            <button type="submit" disabled={submitting} className="w-full bg-brand-blue hover:bg-brand-sky text-white font-bold py-4 rounded-xl cursor-pointer transition-colors duration-300 mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/50 disabled:opacity-60 disabled:cursor-not-allowed">
                                {submitting ? 'Sending…' : "Send Message — We\u2019ll get back to you."}
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Floating WhatsApp Button with Chat Bubble */}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
                {/* Chat bubble message */}
                {showWaBubble && (
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 max-w-[260px] animate-fadeInUp">
                        <button
                            onClick={() => setShowWaBubble(false)}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-xs font-bold hover:bg-gray-300 cursor-pointer transition-colors"
                            aria-label="Close"
                        >
                            ✕
                        </button>
                        <p className="text-sm text-slate-700 leading-relaxed">
                            Ready to send a case or need a price list? <strong>We're live right now</strong> — let's talk!
                        </p>
                        {/* Speech bubble arrow */}
                        <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-b border-r border-gray-200 rotate-45"></div>
                    </div>
                )}

                {/* WhatsApp FAB */}
                <a
                    href="https://wa.me/201034141917"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                        if (typeof window !== 'undefined') {
                            sessionStorage.setItem('last_wa_click_time', Date.now().toString());
                            const device_type = window.innerWidth < 768 ? 'mobile' : 'desktop';
                            // @ts-expect-error - Google Tag Manager event
                            const dataLayer = window.dataLayer || [];
                            dataLayer.push({
                                event: "whatsapp_click",
                                source: "floating_button",
                                page_type: "marketing_landing",
                                device_type: device_type
                            });
                        }
                    }}
                    className="bg-[#25D366] text-white p-4 rounded-full shadow-lg hover:scale-110 transition-transform duration-300 cursor-pointer flex items-center justify-center"
                    aria-label="Chat on WhatsApp"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                </a>
            </div>
        </section>
    );
}
