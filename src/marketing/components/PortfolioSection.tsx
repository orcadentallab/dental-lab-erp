import { useState } from 'react';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { useMarketingLanguage } from '../MarketingLanguageContext';
import {
    getWhatsAppUrl,
    moreCases,
    portfolioCases,
    PORTAL_REGISTER_PATH,
    type CasePhotoEntry,
    type PortfolioCaseEntry,
} from '../content';

function ImageModal({
    src,
    alt,
    closeLabel,
    ariaLabel,
    onClose,
}: {
    src: string;
    alt: string;
    closeLabel: string;
    ariaLabel: string;
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
        >
            <div className="relative max-w-5xl max-h-[90vh] w-full">
                <img
                    src={src}
                    alt={alt}
                    className="w-full h-auto max-h-[85vh] object-contain rounded-2xl"
                />
                <button
                    onClick={onClose}
                    className="absolute -top-3 -end-3 w-10 h-10 bg-white text-brand-black rounded-full flex items-center justify-center font-bold text-lg shadow-xl hover:bg-gray-100 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-sky/50"
                    aria-label={closeLabel}
                >
                    ✕
                </button>
            </div>
        </div>
    );
}

function ImageCard({
    img,
    size,
    onImageClick,
}: {
    img: CasePhotoEntry;
    size: 'large' | 'small';
    onImageClick: (src: string, alt: string) => void;
}) {
    return (
        <div
            className={`relative group overflow-hidden bg-brand-slate/30 border border-brand-slate-light/10 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-brand-blue/10 hover:border-brand-sky/30 ${
                size === 'large' ? 'rounded-2xl' : 'rounded-xl'
            }`}
            onClick={() => onImageClick(img.src, img.alt)}
        >
            <img
                src={img.src}
                alt={img.alt}
                width={size === 'large' ? 800 : 400}
                height={size === 'large' ? 600 : 300}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                loading="lazy"
            />
            <div
                className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-brand-black/90 via-brand-black/60 to-transparent ${
                    size === 'large' ? 'p-4' : 'p-3'
                }`}
            >
                <span className={`text-white font-semibold block text-start ${size === 'large' ? 'text-sm' : 'text-xs'}`}>
                    {img.caption}
                </span>
            </div>
        </div>
    );
}

function CaseBlock({
    caseData,
    lang,
    onImageClick,
}: {
    caseData: PortfolioCaseEntry;
    lang: 'en' | 'ar';
    onImageClick: (src: string, alt: string) => void;
}) {
    const largeImages = caseData.images.filter((img) => img.large);
    const smallImages = caseData.images.filter((img) => !img.large);

    const title = lang === 'ar' ? caseData.titleAr : caseData.title;
    const category = lang === 'ar' ? caseData.categoryAr : caseData.category;
    const description = lang === 'ar' ? caseData.descriptionAr : caseData.description;

    return (
        <div className="relative">
            {/* Case header */}
            <div className="flex items-center gap-4 mb-6">
                <span className="inline-block px-3 py-1 bg-brand-sky/15 text-brand-sky text-xs font-bold uppercase tracking-wider rounded-lg shrink-0">
                    {category}
                </span>
                <span className="h-px flex-1 bg-brand-slate-light/20" />
            </div>

            <h4 className="text-2xl md:text-3xl font-bold text-white mb-3 text-start">{title}</h4>
            <p className="text-brand-slate-lighter text-start max-w-full mb-8 leading-relaxed">
                {description}
            </p>

            {caseData.layout === 'side-stack' && largeImages.length === 1 && smallImages.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="md:col-span-2">
                        <ImageCard img={largeImages[0]} size="large" onImageClick={onImageClick} />
                    </div>
                    <div className="flex flex-col gap-5">
                        {smallImages.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="small" onImageClick={onImageClick} />
                        ))}
                    </div>
                </div>
            ) : caseData.layout === 'reverse-side-stack' && smallImages.length > 0 && largeImages.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="flex flex-col gap-5">
                        {smallImages.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="small" onImageClick={onImageClick} />
                        ))}
                    </div>
                    <div className="md:col-span-2 flex flex-col gap-5">
                        {largeImages.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="large" onImageClick={onImageClick} />
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    <div
                        className={`grid gap-5 mb-5 ${
                            largeImages.length === 1
                                ? 'grid-cols-1 max-w-2xl'
                                : largeImages.length === 3
                                  ? 'grid-cols-1 md:grid-cols-3'
                                  : 'grid-cols-1 md:grid-cols-2'
                        }`}
                    >
                        {largeImages.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="large" onImageClick={onImageClick} />
                        ))}
                    </div>

                    {smallImages.length > 0 && (
                        <div
                            className={`grid gap-4 ${
                                smallImages.length <= 2
                                    ? 'grid-cols-2 md:grid-cols-3'
                                    : smallImages.length === 3
                                      ? 'grid-cols-3'
                                      : 'grid-cols-2 md:grid-cols-4'
                            }`}
                        >
                            {smallImages.map((img, idx) => (
                                <ImageCard key={idx} img={img} size="small" onImageClick={onImageClick} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function PortfolioSection() {
    const { lang, isRTL, t } = useMarketingLanguage();
    const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
    const whatsappUrl = getWhatsAppUrl(t.portfolio.whatsappPrefill);

    const handleImageClick = (src: string, alt: string) => setLightboxImage({ src, alt });

    return (
        <section className="py-24 bg-brand-black relative overflow-hidden" id="portfolio">
            {/* Whale watermark — top right */}
            <div className="absolute -right-10 top-32 w-72 h-72 opacity-[0.04] pointer-events-none select-none rotate-12">
                <img
                    src="/marketing/hero-bg.webp"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    width="288"
                    height="288"
                    className="w-full h-full object-contain invert"
                />
            </div>
            {/* Whale watermark — bottom left */}
            <div className="absolute -left-16 bottom-64 w-96 h-96 opacity-[0.03] pointer-events-none select-none -rotate-12">
                <img
                    src="/marketing/hero-bg.webp"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    width="384"
                    height="384"
                    className="w-full h-full object-contain invert -scale-x-100"
                />
            </div>

            {/* Subtle glow accents */}
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-brand-blue rounded-full mix-blend-screen filter blur-[120px] opacity-10" />
            <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-brand-sky rounded-full mix-blend-screen filter blur-[120px] opacity-8" />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                {/* Header */}
                <div className="text-center max-w-3xl mb-16 mx-auto flex flex-col items-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-slate-light/20 border border-brand-sky/30 text-brand-sky text-xs font-bold uppercase tracking-widest mb-6">
                        <span className="w-2 h-2 rounded-full bg-brand-sky animate-pulse" />
                        {t.portfolio.eyebrow}
                    </div>
                    <h3 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">
                        {t.portfolio.heading}
                    </h3>
                    <p className="text-lg text-brand-slate-lighter">{t.portfolio.subtitle}</p>
                </div>

                {/* Workflow Showcase */}
                <div className="mb-24">
                    <div className="flex items-center gap-4 mb-6">
                        <span className="inline-block px-3 py-1 bg-brand-sky/15 text-brand-sky text-xs font-bold uppercase tracking-wider rounded-lg shrink-0">
                            {t.portfolio.workflowTag}
                        </span>
                        <span className="h-px flex-1 bg-brand-slate-light/20" />
                    </div>
                    <h4 className="text-2xl md:text-3xl font-bold text-white mb-3 text-start">
                        {t.portfolio.workflowTitle}
                    </h4>
                    <p className="text-brand-slate-lighter text-start max-w-full mb-8 leading-relaxed">
                        {t.portfolio.workflowDesc}
                    </p>

                    <div
                        className="relative group rounded-2xl overflow-hidden bg-brand-slate/20 border border-brand-slate-light/15 cursor-pointer transition-all duration-300 hover:border-brand-sky/30 hover:shadow-2xl hover:shadow-brand-blue/10 max-w-2xl mx-auto"
                        onClick={() => handleImageClick('/marketing/Work squence.webp', t.portfolio.workflowAlt)}
                    >
                        <img
                            src="/marketing/Work squence.webp"
                            alt={t.portfolio.workflowAlt}
                            width="600"
                            height="1800"
                            className="w-full h-auto object-contain transition-transform duration-700 group-hover:scale-[1.02]"
                            loading="lazy"
                        />
                    </div>
                </div>

                {/* All Cases */}
                <div className="space-y-24">
                    {portfolioCases.map((caseData, idx) => (
                        <CaseBlock
                            key={idx}
                            caseData={caseData}
                            lang={lang}
                            onImageClick={handleImageClick}
                        />
                    ))}
                </div>

                {/* More Cases */}
                <div className="mt-24">
                    <div className="flex items-center gap-4 mb-8">
                        <span className="inline-block px-3 py-1 bg-brand-blue/15 text-brand-blue text-xs font-bold uppercase tracking-wider rounded-lg shrink-0">
                            {t.portfolio.moreCasesTag}
                        </span>
                        <span className="h-px flex-1 bg-brand-slate-light/20" />
                    </div>
                    <p className="text-brand-slate-lighter text-start mb-8 leading-relaxed">
                        {t.portfolio.moreCasesDesc}
                    </p>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        {moreCases.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="small" onImageClick={handleImageClick} />
                        ))}
                    </div>
                </div>

                {/* CTA */}
                <div className="mt-24 text-center flex flex-col items-center">
                    <div className="relative bg-brand-slate/40 backdrop-blur-sm p-8 sm:p-12 rounded-3xl border border-brand-slate-light/20 w-full max-w-3xl flex flex-col items-center overflow-hidden">
                        <div className="absolute -right-6 -bottom-6 w-24 h-24 opacity-[0.06] pointer-events-none select-none rotate-12">
                            <img
                                src="/marketing/hero-bg.webp"
                                alt=""
                                aria-hidden="true"
                                loading="lazy"
                                width="96"
                                height="96"
                                className="w-full h-full object-contain invert"
                            />
                        </div>

                        <h4 className="text-2xl font-bold text-white mb-3">{t.portfolio.ctaTitle}</h4>
                        <p className="text-brand-slate-lighter mb-8 max-w-xl mx-auto">{t.portfolio.ctaDesc}</p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <a
                                data-track="portal_register_click"
                                href={PORTAL_REGISTER_PATH}
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-brand-blue hover:bg-brand-sky text-white font-bold rounded-xl cursor-pointer transition-[transform,colors,box-shadow] duration-300 hover:-translate-y-1 shadow-md shadow-brand-blue/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-sky/50"
                            >
                                {t.portfolio.ctaRegister}
                                <ArrowRight size={18} className={isRTL ? 'rotate-180' : ''} />
                            </a>
                            {whatsappUrl && (
                                <a
                                    href={whatsappUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#25D366] hover:bg-[#128C7E] text-white font-bold rounded-xl cursor-pointer transition-[transform,colors,box-shadow] duration-300 hover:-translate-y-1 shadow-md shadow-[#25D366]/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/50"
                                >
                                    <MessageCircle size={18} />
                                    {t.portfolio.ctaWhatsapp}
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {lightboxImage && (
                <ImageModal
                    src={lightboxImage.src}
                    alt={lightboxImage.alt}
                    closeLabel={t.portfolio.closePreview}
                    ariaLabel={t.portfolio.imagePreviewAria}
                    onClose={() => setLightboxImage(null)}
                />
            )}
        </section>
    );
}
