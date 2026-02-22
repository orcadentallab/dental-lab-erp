import { ArrowRight } from 'lucide-react';

export default function HeroSection() {
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
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-36 pb-44 lg:pt-48 lg:pb-56 flex flex-col items-center text-center">
                <div className="max-w-4xl flex flex-col items-center">

                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-slate-light/20 border border-brand-sky/30 text-brand-sky text-xs font-bold uppercase tracking-widest mb-6">
                        <span className="w-2 h-2 rounded-full bg-brand-sky animate-pulse" />
                        Precision Digital Dentistry
                    </div>

                    <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.05]">
                        Crafting{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-sky to-brand-blue">
                            World-Class
                        </span>{' '}
                        <br className="hidden md:block" />
                        Dental Restorations
                    </h1>

                    <p className="text-lg sm:text-xl text-brand-offwhite-dark mb-8 max-w-2xl leading-relaxed mx-auto">
                        Orca Dental Lab specializes in high-precision dental restorations, utilizing advanced digital technologies to ensure consistent quality, efficiency, and reliability for dental professionals.
                    </p>

                    {/* Scanner service highlight */}
                    <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl px-6 py-3 mb-10">
                        <span className="w-2.5 h-2.5 rounded-full bg-brand-sky animate-pulse shrink-0" />
                        <p className="text-sm text-white/90 font-medium">
                            <span className="text-brand-sky font-bold">NEW:</span> We bring our intraoral scanners to your clinic — seamless digital impressions, zero investment on your end.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <a
                            href="#contact"
                            className="inline-flex items-center justify-center gap-2 bg-brand-blue hover:bg-brand-sky text-white px-8 py-4 rounded-full font-bold text-lg cursor-pointer transition-[transform,colors,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-blue/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-sky/50"
                        >
                            Start Your Next Case With ORCA.
                            <ArrowRight size={20} />
                        </a>
                        <a
                            href="#portfolio"
                            className="inline-flex items-center justify-center px-8 py-4 rounded-full font-bold text-lg text-white border border-white/20 hover:bg-white/10 cursor-pointer transition-[transform,colors] duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
                        >
                            View Portfolio
                        </a>
                    </div>

                    <p className="mt-8 text-white/30 text-sm italic tracking-widest text-center">
                        ✦ A Dentist's Touch Behind Every Detail
                    </p>
                </div>
            </div>

            {/* Fade to next section */}
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-brand-offwhite to-transparent pointer-events-none z-20" />
        </section>
    );
}
