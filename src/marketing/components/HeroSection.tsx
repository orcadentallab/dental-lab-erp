import { ArrowRight, MessageCircle } from 'lucide-react';
import { useMarketingLanguage } from '../MarketingLanguageContext';
import { getWhatsAppUrl, PORTAL_REGISTER_PATH } from '../content';

export default function HeroSection() {
    const { t, isRTL } = useMarketingLanguage();
    const whatsappUrl = getWhatsAppUrl(t.hero.whatsappPrefill);

    return (
        <section className="relative w-full bg-brand-black text-brand-offwhite overflow-hidden" id="hero">
            {/* Background: smile photo, dark overlay */}
            <div className="absolute inset-0 z-0">
                <img
                    src="/marketing/hero.webp"
                    alt=""
                    aria-hidden="true"
                    fetchPriority="high"
                    width="1920"
                    height="1080"
                    className="w-full h-full object-cover object-center opacity-30"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-brand-black/95 via-brand-black/80 to-brand-black/50" />
                <div className="absolute inset-0 bg-gradient-to-t from-brand-black via-transparent to-brand-black/60" />
            </div>

            {/* Content */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-36 lg:pt-44 lg:pb-48 flex flex-col items-center text-center">
                <div className="max-w-4xl flex flex-col items-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-slate-light/20 border border-brand-sky/30 text-brand-sky text-xs font-bold uppercase tracking-widest mb-6">
                        <span className="w-2 h-2 rounded-full bg-brand-sky animate-pulse" />
                        {t.hero.badge}
                    </div>

                    <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.08]">
                        {t.hero.titlePrefix}{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-sky to-brand-blue">
                            {t.hero.titleHighlight}
                        </span>{' '}
                        <br className="hidden md:block" />
                        {t.hero.titleSuffix}
                    </h1>

                    <p className="text-base sm:text-xl text-brand-offwhite-dark mb-8 max-w-2xl leading-relaxed mx-auto">
                        {t.hero.subtitle}
                    </p>

                    {/* Scanner service highlight */}
                    <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl px-5 py-3 mb-10 text-start">
                        <span className="w-2.5 h-2.5 rounded-full bg-brand-sky animate-pulse shrink-0" />
                        <p className="text-sm text-white/90 font-medium">
                            <span className="text-brand-sky font-bold">{t.hero.scannerBadge}</span>{' '}
                            {t.hero.scannerText}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center w-full sm:w-auto">
                        <a
                            data-track="portal_register_click"
                            href={PORTAL_REGISTER_PATH}
                            className="inline-flex items-center justify-center gap-2 bg-brand-blue hover:bg-brand-sky text-white px-8 py-4 rounded-full font-bold text-base sm:text-lg cursor-pointer transition-[transform,colors,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-blue/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-sky/50"
                        >
                            {t.hero.registerClinic}
                            <ArrowRight size={20} className={isRTL ? 'rotate-180' : ''} />
                        </a>
                        {whatsappUrl && (
                            <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full font-bold text-base sm:text-lg text-white bg-[#25D366]/15 border border-[#25D366]/50 hover:bg-[#25D366] hover:border-[#25D366] cursor-pointer transition-[transform,colors,background-color] duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/50"
                            >
                                <MessageCircle size={20} />
                                {t.hero.sendWhatsapp}
                            </a>
                        )}
                    </div>

                    <p className="mt-8 text-white/40 text-sm italic tracking-widest text-center">
                        {t.hero.tagline}
                    </p>
                </div>
            </div>

            {/* Fade to next section */}
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-brand-offwhite to-transparent pointer-events-none z-20" />
        </section>
    );
}
