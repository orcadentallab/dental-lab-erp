import { ArrowRight } from 'lucide-react';
import { useMarketingLanguage } from '../MarketingLanguageContext';
import { getWhatsAppUrl, PORTAL_REGISTER_PATH } from '../content';

export default function PricingSection() {
    const { isRTL, t } = useMarketingLanguage();
    const whatsappUrl = getWhatsAppUrl(t.pricing.whatsappPrefill);

    return (
        <section className="py-24 bg-brand-offwhite relative overflow-hidden" id="pricing">
            {/* Orca element — top right subtle */}
            <div className="absolute -right-20 -top-10 w-[420px] h-[420px] opacity-[0.04] pointer-events-none select-none rotate-[-15deg]">
                <img
                    src="/marketing/element.webp"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    width="420"
                    height="420"
                    className="w-full h-full object-contain"
                />
            </div>
            {/* Orca element — bottom left */}
            <div className="absolute -left-24 -bottom-16 w-[350px] h-[350px] opacity-[0.03] pointer-events-none select-none rotate-[20deg] -scale-x-100">
                <img
                    src="/marketing/element.webp"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    width="350"
                    height="350"
                    className="w-full h-full object-contain"
                />
            </div>

            {/* Subtle gradient accent */}
            <div className="absolute top-0 end-0 w-1/3 h-full bg-gradient-to-l from-brand-blue/[0.03] to-transparent pointer-events-none" />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                {/* Section Header */}
                <div className="text-center mb-16">
                    <h2 className="text-brand-blue font-bold tracking-widest uppercase text-sm mb-2">
                        {t.pricing.eyebrow}
                    </h2>
                    <h3 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 tracking-tight">
                        {t.pricing.heading}
                    </h3>
                    <p className="text-lg text-slate-600">{t.pricing.subtitle}</p>
                </div>

                {/* 2-Column Layout: Table + CTA */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
                    {/* Left: Price Table */}
                    <div className="bg-white rounded-3xl shadow-xl shadow-brand-blue/5 overflow-hidden border border-gray-100">
                        <div className="flex justify-between items-center bg-brand-black text-white px-8 py-5">
                            <div className="font-bold tracking-wider uppercase text-sm">
                                {t.pricing.colService}
                            </div>
                            <div className="font-bold tracking-wider uppercase text-sm">
                                {t.pricing.colPrice}
                            </div>
                        </div>

                        <div className="divide-y divide-gray-100">
                            {t.pricing.categories.map((categoryGroup) => (
                                <div key={categoryGroup.category} className="p-8">
                                    <h4 className="text-brand-sky font-bold uppercase tracking-widest text-xs mb-6 flex items-center gap-4">
                                        {categoryGroup.category}
                                        <span className="h-px flex-1 bg-brand-slate-light/20" />
                                    </h4>

                                    <ul className="space-y-1">
                                        {categoryGroup.items.map((item, itemIdx) => (
                                            <li
                                                key={itemIdx}
                                                className="flex items-end py-1.5 text-brand-slate hover:text-brand-blue transition-colors duration-200"
                                            >
                                                <div className="shrink-0 font-medium">{item.name}</div>
                                                <div className="flex-1 mx-4 border-b border-dotted border-gray-300 relative top-[-6px] hidden sm:block opacity-60" />
                                                <div className="shrink-0 ms-auto flex items-baseline">
                                                    <span className="text-xs text-brand-slate-light me-1 font-normal">
                                                        {t.pricing.fromPrefix}
                                                    </span>
                                                    <span className="text-lg font-semibold tabular-nums text-brand-black">
                                                        {item.price}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: CTA + Info */}
                    <div className="flex flex-col gap-8">
                        <div className="relative bg-white p-8 sm:p-10 rounded-3xl border border-gray-200 shadow-sm overflow-hidden text-start">
                            <div className="absolute -end-8 -bottom-8 w-32 h-32 opacity-[0.05] pointer-events-none select-none rotate-12">
                                <img
                                    src="/marketing/element.webp"
                                    alt=""
                                    aria-hidden="true"
                                    loading="lazy"
                                    width="128"
                                    height="128"
                                    className="w-full h-full object-contain"
                                />
                            </div>

                            <h4 className="font-bold text-2xl text-slate-900 mb-3">{t.pricing.ctaTitle}</h4>
                            <p className="text-slate-600 mb-8">{t.pricing.ctaDesc}</p>
                            <div className="flex flex-wrap gap-3">
                                <a
                                    data-track="portal_register_click"
                                    href={PORTAL_REGISTER_PATH}
                                    className="inline-flex items-center gap-2 px-6 py-4 bg-brand-blue hover:bg-brand-sky text-white text-base font-bold rounded-xl cursor-pointer transition-[background-color,transform,box-shadow] duration-300 hover:-translate-y-1 shadow-lg shadow-brand-blue/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/50"
                                >
                                    {t.pricing.ctaRegister}
                                    <ArrowRight size={18} className={isRTL ? 'rotate-180' : ''} />
                                </a>
                                {whatsappUrl && (
                                    <a
                                        href={whatsappUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-6 py-4 bg-[#25D366] hover:bg-[#128C7E] text-white text-base font-bold rounded-xl cursor-pointer transition-[background-color,transform,box-shadow] duration-300 hover:-translate-y-1 shadow-lg shadow-[#25D366]/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/50"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                                        </svg>
                                        {t.pricing.ctaWhatsapp}
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Advantage points */}
                        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm text-start">
                            <h4 className="font-bold text-lg text-slate-900 mb-5">
                                {t.pricing.advantageTitle}
                            </h4>
                            <ul className="space-y-4">
                                {t.pricing.advantages.map((adv) => (
                                    <li key={adv.title} className="flex gap-3">
                                        <span className="w-2 h-2 mt-2 rounded-full bg-brand-blue shrink-0" />
                                        <div>
                                            <p className="font-semibold text-slate-800 text-sm">{adv.title}</p>
                                            <p className="text-slate-500 text-xs mt-0.5">{adv.desc}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
