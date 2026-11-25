import { useMarketingLanguage } from '../MarketingLanguageContext';

export default function ServicesSection() {
    const { t } = useMarketingLanguage();

    return (
        <section className="bg-brand-offwhite relative overflow-hidden" id="services">
            {/* Whale — subtle left watermark */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-80 h-80 opacity-[0.06] pointer-events-none select-none">
                <img
                    src="/marketing/hero-bg.webp"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    width="320"
                    height="320"
                    className="w-full h-full object-contain -scale-x-100"
                />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 relative z-10 flex flex-col items-center">
                <div className="text-center mb-14">
                    <h2 className="text-brand-blue font-bold tracking-widest uppercase text-sm mb-2">
                        {t.services.eyebrow}
                    </h2>
                    <h3 className="text-3xl md:text-5xl font-bold text-brand-black mb-6 tracking-tight">
                        {t.services.heading}
                    </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto w-full">
                    {t.services.groups.map((group) => (
                        <div
                            key={group.group}
                            className="bg-white border border-gray-200 rounded-2xl p-6 transition-[background-color,border-color,transform,box-shadow] duration-300 hover:border-brand-blue/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-blue/5 cursor-default group"
                        >
                            <h4 className="text-brand-blue text-xs font-bold uppercase tracking-widest mb-4 pb-3 border-b border-gray-200 group-hover:border-brand-blue/40 transition-colors duration-300 text-start">
                                {group.group}
                            </h4>
                            <ul className="space-y-3">
                                {group.services.map((s) => (
                                    <li key={s.name} className="flex gap-3">
                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-blue shrink-0 group-hover:shadow-[0_0_8px_rgba(59,130,246,0.6)] transition-shadow duration-300" />
                                        <div className="text-start">
                                            <p className="text-brand-black text-sm font-semibold leading-tight">
                                                {s.name}
                                            </p>
                                            <p className="text-brand-slate-light text-xs mt-0.5 leading-snug">
                                                {s.desc}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <p className="text-center text-brand-slate-light/70 text-sm mt-6 italic">
                    {t.services.footnote}
                </p>
            </div>
        </section>
    );
}
