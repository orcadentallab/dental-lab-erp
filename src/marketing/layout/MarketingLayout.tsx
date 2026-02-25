import { useState, useEffect, type ReactNode } from 'react';
import { Phone, Mail, MapPin, Menu, X, Facebook, Instagram } from 'lucide-react';

interface MarketingLayoutProps {
    children: ReactNode;
}

const navLinks = [
    { label: 'Services', href: '#services' },
    { label: 'Portfolio', href: '#portfolio' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
    { label: 'Contact', href: '#contact' },
];

export default function MarketingLayout({ children }: MarketingLayoutProps) {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Close mobile menu on resize to desktop
    useEffect(() => {
        const onResize = () => { if (window.innerWidth >= 768) setMobileMenuOpen(false); };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return (
        <div className="min-h-screen bg-brand-offwhite font-sans text-brand-slate" dir="ltr">
            {/* Header / Navbar */}
            <header
                className={`fixed top-0 left-0 right-0 z-50 transition-[background-color,box-shadow] duration-300 ${scrolled
                    ? 'bg-white/95 backdrop-blur-lg shadow-md shadow-brand-black/5'
                    : 'bg-white/90 backdrop-blur-md shadow-sm'
                    } border-b border-brand-offwhite-dark`}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        {/* Logo */}
                        <a href="#hero" className="flex items-center gap-3 group">
                            <img src="/orca-logo.png" alt="ORCA Dental Lab" className="h-12 w-12 rounded-xl object-cover shadow-sm bg-white transition-transform duration-300 group-hover:scale-105" />
                            <div className="flex flex-col justify-center">
                                <span className="font-bold text-2xl text-brand-black leading-none tracking-widest uppercase">ORCA Lab</span>
                                <span className="text-xs text-brand-blue font-semibold uppercase tracking-widest mt-0.5">Dental Solutions</span>
                            </div>
                        </a>

                        {/* Desktop nav */}
                        <nav className="hidden md:flex items-center gap-1">
                            {navLinks.map(link => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    className="relative text-sm font-semibold text-brand-slate hover:text-brand-blue px-3 py-2 rounded-lg hover:bg-brand-blue/5 transition-colors duration-200 group"
                                >
                                    {link.label}
                                    <span className="absolute bottom-0.5 left-3 right-3 h-0.5 bg-brand-blue rounded-full scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                                </a>
                            ))}
                        </nav>

                        {/* Desktop CTA */}
                        <div className="hidden md:flex items-center gap-4">
                            <a href="/login" className="text-sm font-bold text-brand-slate-light hover:text-brand-black transition-colors">
                                Portal Login
                            </a>
                            <a href="#contact" className="bg-brand-blue text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-md shadow-brand-blue/30 hover:bg-brand-sky transition-colors duration-300 hover:shadow-lg">
                                Start a Case →
                            </a>
                        </div>

                        {/* Mobile hamburger */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden p-2 rounded-lg text-brand-slate hover:bg-gray-100 transition-colors cursor-pointer"
                            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                            aria-expanded={mobileMenuOpen ? "true" : "false"}
                        >
                            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>
                    </div>
                </div>

                {/* Mobile menu panel */}
                <div
                    className={`md:hidden overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out border-t border-gray-100 bg-white ${mobileMenuOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                        }`}
                >
                    <nav className="max-w-7xl mx-auto px-4 py-4 space-y-1">
                        {navLinks.map(link => (
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
                            <a href="tel:+201034141917" className="flex items-center gap-2 px-4 py-2.5 text-sm text-brand-slate-light hover:text-brand-blue transition-colors">
                                <Phone size={16} />
                                +20 103 414 1917
                            </a>
                            <a href="mailto:orcadentallab@gmail.com" className="flex items-center gap-2 px-4 py-2.5 text-sm text-brand-slate-light hover:text-brand-blue transition-colors">
                                <Mail size={16} />
                                orcadentallab@gmail.com
                            </a>
                        </div>
                        <div className="border-t border-gray-100 mt-3 pt-3 flex flex-col gap-2 px-4">
                            <a href="/login" className="text-sm font-bold text-brand-slate-light hover:text-brand-black transition-colors py-2">
                                Portal Login
                            </a>
                            <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="bg-brand-blue text-white px-5 py-3 rounded-full text-sm font-bold text-center shadow-md shadow-brand-blue/30 hover:bg-brand-sky transition-colors">
                                Start a Case →
                            </a>
                        </div>
                    </nav>
                </div>
            </header>

            <main className="pt-20">
                {children}
            </main>

            {/* Footer */}
            <footer className="bg-brand-black text-brand-offwhite-dark relative overflow-hidden">
                {/* Subtle gradient accent */}
                <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-brand-blue/[0.04] to-transparent pointer-events-none" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
                        {/* Col 1: Brand */}
                        <div className="sm:col-span-2 lg:col-span-1 space-y-4">
                            <div className="flex items-center gap-3">
                                <img src="/orca-logo.png" alt="ORCA Dental Lab" className="h-10 w-10 rounded-lg bg-white" />
                                <div className="flex flex-col">
                                    <span className="font-bold text-xl text-white tracking-tight leading-none">ORCA Lab</span>
                                    <span className="text-[10px] text-brand-sky font-semibold uppercase tracking-widest mt-0.5">Dental Solutions</span>
                                </div>
                            </div>
                            <p className="text-sm text-brand-slate-lighter leading-relaxed max-w-xs">
                                Orca Dental Lab specializes in high-precision dental restorations, utilizing advanced digital technologies to ensure consistent quality and reliability.
                            </p>
                            {/* Social Links */}
                            <div className="flex gap-3 pt-2">
                                <a href="https://www.facebook.com/orca.labeg" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="w-10 h-10 rounded-full bg-brand-slate/40 flex items-center justify-center text-brand-slate-lighter hover:bg-brand-blue hover:text-white cursor-pointer transition-[color,background-color] duration-300">
                                    <Facebook size={18} />
                                </a>
                                <a href="https://www.instagram.com/orca.labeg/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="w-10 h-10 rounded-full bg-brand-slate/40 flex items-center justify-center text-brand-slate-lighter hover:bg-brand-blue hover:text-white cursor-pointer transition-[color,background-color] duration-300">
                                    <Instagram size={18} />
                                </a>
                            </div>
                        </div>

                        {/* Col 2: Quick Links */}
                        <div>
                            <h4 className="font-bold text-white mb-5 text-sm uppercase tracking-wider">Quick Links</h4>
                            <ul className="space-y-3 text-sm">
                                <li><a href="#services" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">Services</a></li>
                                <li><a href="#portfolio" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">Portfolio</a></li>
                                <li><a href="#pricing" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">Pricing</a></li>
                                <li><a href="#faq" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">FAQ</a></li>
                                <li><a href="#contact" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">Contact Us</a></li>
                            </ul>
                        </div>

                        {/* Col 3: Contact Info */}
                        <div>
                            <h4 className="font-bold text-white mb-5 text-sm uppercase tracking-wider">Contact</h4>
                            <ul className="space-y-4 text-sm">
                                <li>
                                    <a href="tel:+201034141917" className="flex items-start gap-3 group hover:text-white transition-colors duration-200">
                                        <Phone size={16} className="mt-0.5 shrink-0 text-brand-sky" />
                                        <span>+20 103 414 1917</span>
                                    </a>
                                </li>
                                <li>
                                    <a href="mailto:orcadentallab@gmail.com" className="flex items-start gap-3 group hover:text-white transition-colors duration-200">
                                        <Mail size={16} className="mt-0.5 shrink-0 text-brand-sky" />
                                        <span>orcadentallab@gmail.com</span>
                                    </a>
                                </li>
                                <li className="flex items-start gap-3">
                                    <MapPin size={16} className="mt-0.5 shrink-0 text-brand-sky" />
                                    <span>Cairo, Egypt</span>
                                </li>
                            </ul>
                        </div>

                        {/* Col 4: Portal */}
                        <div>
                            <h4 className="font-bold text-white mb-5 text-sm uppercase tracking-wider">Portal</h4>
                            <ul className="space-y-3 text-sm">
                                <li><a href="/login" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">Doctor Login</a></li>
                                <li><a href="/login" className="hover:text-white hover:translate-x-1 inline-block transition-[color,transform] duration-200">Register Clinic</a></li>
                            </ul>
                            <div className="mt-6">
                                <a href="#contact" className="inline-flex items-center gap-2 bg-brand-blue/20 hover:bg-brand-blue text-brand-sky hover:text-white px-5 py-2.5 rounded-full text-sm font-bold transition-colors duration-300">
                                    Start a Case →
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom bar */}
                <div className="border-t border-brand-slate/30">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-brand-slate-lighter">
                        <p>© {new Date().getFullYear()} ORCA Dental Lab. All rights reserved.</p>
                        <p className="italic text-brand-slate-light">✦ A Dentist's Touch Behind Every Detail</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
