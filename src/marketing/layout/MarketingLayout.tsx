import { useState, useEffect, type ReactNode } from 'react';
import { Phone, Mail, MapPin, Menu, X, Facebook, Instagram } from 'lucide-react';
import { useMarketingLanguage } from '../MarketingLanguageContext';
import { PORTAL_LOGIN_PATH, PORTAL_REGISTER_PATH } from '../content';

interface MarketingLayoutProps {
    children: ReactNode;
}

export default function MarketingLayout({ children }: MarketingLayoutProps) {
    const { lang, setLang, isRTL, t } = useMarketingLanguage();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    const navLinks = [
        { label: t.nav.services, href: '#services' },
        { label: t.nav.trust, href: '#trust' },
        { label: t.nav.portfolio, href: '#portfolio' },
        { label: t.nav.pricing, href: '#pricing' },
        { label: t.nav.faq, href: '#faq' },
        { label: t.nav.contact, href: '#contact' },
    ];

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const onResize = () => {
            if (window.innerWidth >= 768) setMobileMenuOpen(false);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const langSwitch = (
        <div
            className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100/80 p-0.5 text-xs font-bold"
            role="group"
            aria-label="Language switch"
        >
            <button
                type="button"
                onClick={() => setLang('en')}
                className={`px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                    lang === 'en'
                        ? 'bg-white text-brand-black shadow-sm'
                        : 'text-brand-slate-light hover:text-brand-black'
                }`}
            >
                EN
            </button>
            <button
                type="button"
                onClick={() => setLang('ar')}
                className={`px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                    lang === 'ar'
                        ? 'bg-white text-brand-black shadow-sm'
                        : 'text-brand-slate-light hover:text-brand-black'
                }`}
            >
                عربي
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-brand-offwhite font-sans text-brand-slate" dir={isRTL ? 'rtl' : 'ltr'}>
            {/* Header / Navbar */}
            <header
                className={`fixed top-0 left-0 right-0 z-50 transition-[background-color,box-shadow] duration-300 ${
                    scrolled
                        ? 'bg-white/95 backdrop-blur-lg shadow-md shadow-brand-black/5'
                        : 'bg-white/90 backdrop-blur-md shadow-sm'
                } border-b border-brand-offwhite-dark`}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        {/* Logo */}
                        <a data-nav href="#hero" className="flex items-center gap-3 group shrink-0">
                            <img
                                src="/orca-logo.png"
                                alt="ORCA Dental Lab"
                                width={48}
                                height={48}
                                className="h-12 w-12 rounded-xl object-cover shadow-sm bg-white transition-transform duration-300 group-hover:scale-105"
                            />
                            <div className="flex flex-col justify-center">
                                <span className="font-bold text-2xl text-brand-black leading-none tracking-widest uppercase">
                                    ORCA Lab
                                </span>
                                <span className="text-xs text-brand-blue font-semibold uppercase tracking-widest mt-0.5">
                                    {t.nav.brandSub}
                                </span>
                            </div>
                        </a>

                        {/* Desktop nav */}
                        <nav className="hidden lg:flex items-center gap-1">
                            {navLinks.map((link) => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    className="relative text-sm font-semibold text-brand-slate hover:text-brand-blue px-3 py-2 rounded-lg hover:bg-brand-blue/5 transition-colors duration-200 group"
                                >
                                    {link.label}
                                    <span className="absolute bottom-0.5 inset-x-3 h-0.5 bg-brand-blue rounded-full scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-start" />
                                </a>
                            ))}
                        </nav>

                        {/* Desktop CTA & Language Switch */}
                        <div className="hidden md:flex items-center gap-3 shrink-0">
                            {langSwitch}
                            <a
                                data-nav
                                data-track="portal_login_click"
                                href={PORTAL_LOGIN_PATH}
                                className="text-sm font-bold text-brand-slate-light hover:text-brand-black transition-colors px-2"
                            >
                                {t.nav.portalLogin}
                            </a>
                            <a
                                data-nav
                                data-track="portal_register_click"
                                href={PORTAL_REGISTER_PATH}
                                className="bg-brand-blue text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-md shadow-brand-blue/30 hover:bg-brand-sky transition-colors duration-300 hover:shadow-lg"
                            >
                                {t.nav.startCase}
                            </a>
                        </div>

                        {/* Mobile controls */}
                        <div className="flex md:hidden items-center gap-2">
                            {langSwitch}
                            <button
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                                className="p-2 rounded-lg text-brand-slate hover:bg-gray-100 transition-colors cursor-pointer"
                                aria-label={mobileMenuOpen ? t.nav.closeMenu : t.nav.openMenu}
                                aria-expanded={mobileMenuOpen}
                            >
                                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile menu panel */}
                <div
                    className={`md:hidden overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out border-t border-gray-100 bg-white ${
                        mobileMenuOpen ? 'max-h-[540px] opacity-100' : 'max-h-0 opacity-0'
                    }`}
                >
                    <nav className="max-w-7xl mx-auto px-4 py-4 space-y-1">
                        {navLinks.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="block text-base font-semibold text-brand-slate hover:text-brand-blue hover:bg-brand-blue/5 px-4 py-3 rounded-xl transition-colors"
                            >
                                {link.label}
                            </a>
                        ))}
                        <div className="border-t border-gray-100 mt-3 pt-3 space-y-2">
                            <a
                                data-nav
                                href="tel:+201034141917"
                                dir="ltr"
                                className="flex items-center gap-2 px-4 py-2.5 text-sm text-brand-slate-light hover:text-brand-blue transition-colors"
                            >
                                <Phone size={16} />
                                +20 103 414 1917
                            </a>
                            <a
                                data-nav
                                href="mailto:orcadentallab@gmail.com"
                                className="flex items-center gap-2 px-4 py-2.5 text-sm text-brand-slate-light hover:text-brand-blue transition-colors"
                            >
                                <Mail size={16} />
                                orcadentallab@gmail.com
                            </a>
                        </div>
                        <div className="border-t border-gray-100 mt-3 pt-3 flex flex-col gap-2 px-4">
                            <a
                                data-nav
                                data-track="portal_login_click"
                                href={PORTAL_LOGIN_PATH}
                                className="text-sm font-bold text-brand-slate-light hover:text-brand-black transition-colors py-2"
                            >
                                {t.nav.portalLogin}
                            </a>
                            <a
                                data-nav
                                data-track="portal_register_click"
                                href={PORTAL_REGISTER_PATH}
                                onClick={() => setMobileMenuOpen(false)}
                                className="bg-brand-blue text-white px-5 py-3 rounded-full text-sm font-bold text-center shadow-md shadow-brand-blue/30 hover:bg-brand-sky transition-colors"
                            >
                                {t.nav.startCase}
                            </a>
                        </div>
                    </nav>
                </div>
            </header>

            <main className="pt-20">{children}</main>

            {/* Footer */}
            <footer className="bg-brand-black text-brand-offwhite-dark relative overflow-hidden">
                {/* Subtle gradient accent */}
                <div className="absolute top-0 end-0 w-1/2 h-full bg-gradient-to-l from-brand-blue/[0.04] to-transparent pointer-events-none" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10 text-start">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
                        {/* Col 1: Brand */}
                        <div className="sm:col-span-2 lg:col-span-1 space-y-4">
                            <div className="flex items-center gap-3">
                                <img
                                    src="/orca-logo.png"
                                    alt="ORCA Dental Lab"
                                    width={40}
                                    height={40}
                                    loading="lazy"
                                    className="h-10 w-10 rounded-lg bg-white"
                                />
                                <div className="flex flex-col">
                                    <span className="font-bold text-xl text-white tracking-tight leading-none">
                                        ORCA Lab
                                    </span>
                                    <span className="text-[10px] text-brand-sky font-semibold uppercase tracking-widest mt-0.5">
                                        {t.nav.brandSub}
                                    </span>
                                </div>
                            </div>
                            <p className="text-sm text-brand-slate-lighter leading-relaxed max-w-xs">
                                {t.footer.brandDesc}
                            </p>
                            {/* Social Links */}
                            <div className="flex gap-3 pt-2">
                                <a
                                    data-nav
                                    href="https://www.facebook.com/orca.labeg"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="Facebook"
                                    className="w-10 h-10 rounded-full bg-brand-slate/40 flex items-center justify-center text-brand-slate-lighter hover:bg-brand-blue hover:text-white cursor-pointer transition-[color,background-color] duration-300"
                                >
                                    <Facebook size={18} />
                                </a>
                                <a
                                    data-nav
                                    href="https://www.instagram.com/orca.labeg/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="Instagram"
                                    className="w-10 h-10 rounded-full bg-brand-slate/40 flex items-center justify-center text-brand-slate-lighter hover:bg-brand-blue hover:text-white cursor-pointer transition-[color,background-color] duration-300"
                                >
                                    <Instagram size={18} />
                                </a>
                            </div>
                        </div>

                        {/* Col 2: Quick Links */}
                        <div>
                            <h4 className="font-bold text-white mb-5 text-sm uppercase tracking-wider">
                                {t.footer.quickLinks}
                            </h4>
                            <ul className="space-y-3 text-sm">
                                <li>
                                    <a
                                        data-nav
                                        href="#services"
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.nav.services}
                                    </a>
                                </li>
                                <li>
                                    <a
                                        data-nav
                                        href="#trust"
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.nav.trust}
                                    </a>
                                </li>
                                <li>
                                    <a
                                        data-nav
                                        href="#portfolio"
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.nav.portfolio}
                                    </a>
                                </li>
                                <li>
                                    <a
                                        data-nav
                                        href="#pricing"
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.nav.pricing}
                                    </a>
                                </li>
                                <li>
                                    <a
                                        data-nav
                                        href="#faq"
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.nav.faq}
                                    </a>
                                </li>
                            </ul>
                        </div>

                        {/* Col 3: Contact Info */}
                        <div>
                            <h4 className="font-bold text-white mb-5 text-sm uppercase tracking-wider">
                                {t.footer.contactTitle}
                            </h4>
                            <ul className="space-y-4 text-sm">
                                <li>
                                    <a
                                        data-nav
                                        href="tel:+201034141917"
                                        className="flex items-start gap-3 group hover:text-white transition-colors duration-200"
                                    >
                                        <Phone size={16} className="mt-0.5 shrink-0 text-brand-sky" />
                                        <span dir="ltr">+20 103 414 1917</span>
                                    </a>
                                </li>
                                <li>
                                    <a
                                        data-nav
                                        href="mailto:orcadentallab@gmail.com"
                                        className="flex items-start gap-3 group hover:text-white transition-colors duration-200"
                                    >
                                        <Mail size={16} className="mt-0.5 shrink-0 text-brand-sky" />
                                        <span>orcadentallab@gmail.com</span>
                                    </a>
                                </li>
                                <li className="flex items-start gap-3">
                                    <MapPin size={16} className="mt-0.5 shrink-0 text-brand-sky" />
                                    <span>{t.contact.locationValue}</span>
                                </li>
                            </ul>
                        </div>

                        {/* Col 4: Portal */}
                        <div>
                            <h4 className="font-bold text-white mb-5 text-sm uppercase tracking-wider">
                                {t.footer.portalTitle}
                            </h4>
                            <ul className="space-y-3 text-sm">
                                <li>
                                    <a
                                        data-nav
                                        data-track="portal_login_click"
                                        href={PORTAL_LOGIN_PATH}
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.footer.doctorLogin}
                                    </a>
                                </li>
                                <li>
                                    <a
                                        data-nav
                                        data-track="portal_register_click"
                                        href={PORTAL_REGISTER_PATH}
                                        className="hover:text-white ltr:hover:translate-x-1 rtl:hover:-translate-x-1 inline-block transition-[color,transform] duration-200"
                                    >
                                        {t.footer.registerClinic}
                                    </a>
                                </li>
                            </ul>
                            <div className="mt-6">
                                <a
                                    data-nav
                                    data-track="portal_register_click"
                                    href={PORTAL_REGISTER_PATH}
                                    className="inline-flex items-center gap-2 bg-brand-blue/20 hover:bg-brand-blue text-brand-sky hover:text-white px-5 py-2.5 rounded-full text-sm font-bold transition-colors duration-300"
                                >
                                    {t.footer.startCase}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom bar — extra bottom/end padding so floating WhatsApp button never overlaps copyright or tagline */}
                <div className="border-t border-brand-slate/30">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-24 sm:pb-8 sm:pe-24 lg:pe-24 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-brand-slate-lighter">
                        <p>© {new Date().getFullYear()} {t.footer.rightsReserved}</p>
                        <p className="italic text-brand-slate-light">{t.footer.tagline}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
