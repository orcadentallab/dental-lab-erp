import { useState } from 'react';

interface CaseImage {
    src: string;
    label: string;
    large?: boolean;
}

interface PortfolioCase {
    title: string;
    category: string;
    description: string;
    images: CaseImage[];
    layout?: 'default' | 'side-stack' | 'reverse-side-stack';
}

const portfolioCases: PortfolioCase[] = [
    {
        title: "Zr Multi Layer — Anterior Rehabilitation",
        category: "Multi-layer Zirconia",
        description: "Multi-layer zirconia anterior rehabilitation — achieving natural gradation of translucency and color from cervical to incisal, with individualized characterization matching the patient's facial aesthetics.",
        images: [
            { src: "/marketing/Zr Multi/Before.webp", label: "Before", large: true },
            { src: "/marketing/Zr Multi/556929803_10241330631106077_4098193000564997894_n.webp", label: "Final Result", large: true },
            { src: "/marketing/Zr Multi/cast.webp", label: "Cast Model" },
            { src: "/marketing/Zr Multi/556854355_10241330626025950_5375520214538015687_n.webp", label: "Alternative Angle" },
            { src: "/marketing/Zr Multi/558880201_10241330637466236_7179418825091317744_n (1).webp", label: "Detail View" },
        ],
    },
    {
        title: "E.max Veneers — Smile Makeover",
        category: "Esthetic Veneers",
        description: "Ultra-thin E.max veneers crafted for a complete anterior smile makeover — balancing minimal preparation with maximum aesthetic impact and natural light transmission.",
        images: [
            { src: "/marketing/Case Venners/Case Venner1.webp", label: "Primary Showcase", large: true },
            { src: "/marketing/Case Venners/Case Venner2.webp", label: "Secondary View", large: true },
        ],
    },
    {
        title: "E.max Veneers — Precision Layering",
        category: "E.max Veneers",
        description: "Press-technique E.max veneers with meticulous layering and staining — a before-and-after transformation showcasing the power of digital-guided smile design.",
        layout: 'side-stack',
        images: [
            { src: "/marketing/Emax Venners/main.webp", label: "Final Result", large: true },
            { src: "/marketing/Emax Venners/Before.webp", label: "Before" },
            { src: "/marketing/Emax Venners/WhatsApp Image 2026-02-20 at 10.59.09 PM].webp", label: "Additional View" },
        ],
    },
    {
        title: "Full Arch Implant Rehabilitation",
        category: "Implant Prosthetics",
        description: "Complete full-arch implant-supported rehabilitation delivering total functional restoration with a natural, harmonious smile line and long-term stability.",
        layout: 'side-stack',
        images: [
            { src: "/marketing/Case Full Arch/full arch3.webp", label: "Full Arch — Hero", large: true },
            { src: "/marketing/Case Full Arch/full arch.webp", label: "View 1" },
            { src: "/marketing/Case Full Arch/full arch2.webp", label: "View 2" },
        ],
    },
    {
        title: "Anterior Crowns & Aesthetics",
        category: "Crown Rehabilitation",
        description: "Six-unit anterior crown rehabilitation — precision shade matching with detailed surface texture and translucency for a seamless, lifelike result.",
        images: [
            { src: "/marketing/Case Crowns Esthatic/Before.webp", label: "Before", large: true },
            { src: "/marketing/Case Crowns Esthatic/face.webp", label: "Final Result", large: true },
            { src: "/marketing/Case Crowns Esthatic/Design.webp", label: "Digital Design" },
            { src: "/marketing/Case Crowns Esthatic/Front.webp", label: "Front View" },
            { src: "/marketing/Case Crowns Esthatic/angle.webp", label: "Angle View" },
            { src: "/marketing/Case Crowns Esthatic/back.webp", label: "Palatal View" },
        ],
    },
    {
        title: "Crowns Anterior — Natural Integration",
        category: "Anterior Crowns",
        description: "Anterior crown restorations designed for seamless integration with adjacent natural teeth — achieving ideal proportions, surface anatomy, and gingival harmony.",
        images: [
            { src: "/marketing/Crowns anterior/before.webp", label: "Before", large: true },
            { src: "/marketing/Crowns anterior/WhatsApp Image 2026-01-22 at 4.03.46 PM.webp", label: "Final View 1", large: true },
            { src: "/marketing/Crowns anterior/WhatsApp Image 2026-01-22 at 4.03.47 PM.webp", label: "Final View 2", large: true },
        ],
    },
];

const moreCases: CaseImage[] = [
    { src: "/marketing/Case Esthatic/WhatsApp Image 2026-02-20 at 10.56.23 PM.webp", label: "Esthetic Case" },
    { src: "/marketing/Case Esthatic/WhatsApp Image 2026-02-20 at 10.5623 PM.webp", label: "Esthetic Case" },
    { src: "/marketing/Case Zirconia Crowns/zirconia.webp", label: "Zirconia Crowns" },
    { src: "/marketing/zirconia in implant.webp", label: "Zirconia on Implant" },
    { src: "/marketing/Case Endocrown/endocrown.webp", label: "Endocrown" },
];

function ImageModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
        >
            <div className="relative max-w-5xl max-h-[90vh] w-full">
                <img src={src} alt={alt} className="w-full h-auto max-h-[85vh] object-contain rounded-2xl" />
                <button
                    onClick={onClose}
                    className="absolute -top-3 -right-3 w-10 h-10 bg-white text-brand-black rounded-full flex items-center justify-center font-bold text-lg shadow-xl hover:bg-gray-100 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-sky/50"
                    aria-label="Close preview"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}

function ImageCard({ img, size, onImageClick }: { img: CaseImage; size: 'large' | 'small'; onImageClick: (src: string, alt: string) => void }) {
    return (
        <div
            className={`relative group overflow-hidden bg-brand-slate/30 border border-brand-slate-light/10 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-brand-blue/10 hover:border-brand-sky/30 ${size === 'large' ? 'rounded-2xl' : 'rounded-xl'}`}
            onClick={() => onImageClick(img.src, img.label)}
        >
            <img
                src={img.src}
                alt={img.label}
                width={size === 'large' ? '800' : '400'}
                height={size === 'large' ? '600' : '300'}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                loading="lazy"
            />
            <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-brand-black/80 to-transparent ${size === 'large' ? 'p-4' : 'p-3'} translate-y-full group-hover:translate-y-0 transition-transform duration-300`}>
                <span className={`text-white font-semibold ${size === 'large' ? 'text-sm' : 'text-xs'}`}>{img.label}</span>
            </div>
        </div>
    );
}

function CaseBlock({ caseData, onImageClick }: { caseData: PortfolioCase; onImageClick: (src: string, alt: string) => void }) {
    const largeImages = caseData.images.filter(img => img.large);
    const smallImages = caseData.images.filter(img => !img.large);

    return (
        <div className="relative">
            {/* Case header */}
            <div className="flex items-center gap-4 mb-6">
                <span className="inline-block px-3 py-1 bg-brand-sky/15 text-brand-sky text-xs font-bold uppercase tracking-wider rounded-lg shrink-0">
                    {caseData.category}
                </span>
                <span className="h-px flex-1 bg-brand-slate-light/20"></span>
            </div>

            <h4 className="text-2xl md:text-3xl font-bold text-white mb-3 text-left">{caseData.title}</h4>
            <p className="text-brand-slate-lighter text-left max-w-full mb-8 leading-relaxed">{caseData.description}</p>

            {/* Side-stack layout: 1 large + small images stacked vertically beside it */}
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
                    {/* Default: Large images row */}
                    <div className={`grid gap-5 mb-5 ${largeImages.length === 1 ? 'grid-cols-1 max-w-2xl'
                            : largeImages.length === 3 ? 'grid-cols-1 md:grid-cols-3'
                                : 'grid-cols-1 md:grid-cols-2'
                        }`}>
                        {largeImages.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="large" onImageClick={onImageClick} />
                        ))}
                    </div>

                    {/* Default: Small images grid */}
                    {smallImages.length > 0 && (
                        <div className={`grid gap-4 ${smallImages.length <= 2 ? 'grid-cols-2 md:grid-cols-3'
                            : smallImages.length === 3 ? 'grid-cols-3'
                                : 'grid-cols-2 md:grid-cols-4'
                            }`}>
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
    const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

    const handleImageClick = (src: string, alt: string) => setLightboxImage({ src, alt });

    return (
        <section className="py-24 bg-brand-black relative overflow-hidden" id="portfolio">
            {/* Whale watermark — top right */}
            <div className="absolute -right-10 top-32 w-72 h-72 opacity-[0.04] pointer-events-none select-none rotate-12">
                <img src="/marketing/hero-bg.webp" alt="" aria-hidden="true" width="288" height="288" className="w-full h-full object-contain invert" />
            </div>
            {/* Whale watermark — bottom left */}
            <div className="absolute -left-16 bottom-64 w-96 h-96 opacity-[0.03] pointer-events-none select-none -rotate-12">
                <img src="/marketing/hero-bg.webp" alt="" aria-hidden="true" width="384" height="384" className="w-full h-full object-contain invert -scale-x-100" />
            </div>

            {/* Subtle glow accents */}
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-brand-blue rounded-full mix-blend-screen filter blur-[120px] opacity-10"></div>
            <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-brand-sky rounded-full mix-blend-screen filter blur-[120px] opacity-8"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">

                {/* Header */}
                <div className="text-center max-w-3xl mb-6 mx-auto flex flex-col items-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-slate-light/20 border border-brand-sky/30 text-brand-sky text-xs font-bold uppercase tracking-widest mb-6">
                        <span className="w-2 h-2 rounded-full bg-brand-sky animate-pulse" />
                        Our Portfolio
                    </div>
                    <h3 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">Showcase of Excellence</h3>
                    <p className="text-lg text-brand-slate-lighter">
                        A curated selection of our clinical work. Every case reflects our commitment to precision, aesthetics, and uncompromised quality.
                    </p>
                </div>

                {/* Sample indicator */}
                <div className="text-center mb-20">
                    <span className="inline-flex items-center gap-2 text-brand-slate-lighter/60 text-sm">
                        <span className="w-8 h-px bg-brand-slate-light/30"></span>
                        Showing a selection of our work — we handle hundreds of cases monthly
                        <span className="w-8 h-px bg-brand-slate-light/30"></span>
                    </span>
                </div>

                {/* ——— WORKFLOW SHOWCASE ——— */}
                <div className="mb-28">
                    <div className="flex items-center gap-4 mb-6">
                        <span className="inline-block px-3 py-1 bg-brand-sky/15 text-brand-sky text-xs font-bold uppercase tracking-wider rounded-lg shrink-0">
                            Our Digital Workflow
                        </span>
                        <span className="h-px flex-1 bg-brand-slate-light/20"></span>
                    </div>
                    <h4 className="text-2xl md:text-3xl font-bold text-white mb-3 text-left">From Scan to Final — A Complete Case Journey</h4>
                    <p className="text-brand-slate-lighter text-left max-w-full mb-8 leading-relaxed">
                        Every case at ORCA follows a meticulous digital pipeline: pre-operative assessment → intraoral scan → digital design iterations → PMMA mock-up validation → final precision restoration.
                    </p>

                    <div
                        className="relative group rounded-2xl overflow-hidden bg-brand-slate/20 border border-brand-slate-light/15 cursor-pointer transition-all duration-300 hover:border-brand-sky/30 hover:shadow-2xl hover:shadow-brand-blue/10 max-w-2xl mx-auto"
                        onClick={() => handleImageClick("/marketing/Work squence.webp", "Complete Digital Workflow — Pre-operative to Final Restoration")}
                    >
                        <img
                            src="/marketing/Work squence.webp"
                            alt="Complete Digital Workflow — Pre-operative to Final Restoration"
                            width="600"
                            height="1800"
                            className="w-full h-auto object-contain transition-transform duration-700 group-hover:scale-[1.02]"
                            loading="lazy"
                        />
                    </div>
                </div>

                {/* All Cases */}
                <div className="space-y-28">
                    {portfolioCases.map((caseData, idx) => (
                        <CaseBlock key={idx} caseData={caseData} onImageClick={handleImageClick} />
                    ))}
                </div>

                {/* More Cases — grouped small ones */}
                <div className="mt-28">
                    <div className="flex items-center gap-4 mb-8">
                        <span className="inline-block px-3 py-1 bg-brand-blue/15 text-brand-blue text-xs font-bold uppercase tracking-wider rounded-lg shrink-0">
                            More Cases
                        </span>
                        <span className="h-px flex-1 bg-brand-slate-light/20"></span>
                    </div>
                    <p className="text-brand-slate-lighter text-left mb-8 leading-relaxed">
                        A glimpse of additional work spanning zirconia crowns, endocrowns, implant restorations, and custom esthetic solutions.
                    </p>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        {moreCases.map((img, idx) => (
                            <ImageCard key={idx} img={img} size="small" onImageClick={handleImageClick} />
                        ))}
                    </div>
                </div>

                {/* CTA + "This is just a sample" */}
                <div className="mt-28 text-center flex flex-col items-center">
                    <div className="relative inline-block bg-brand-slate/40 backdrop-blur-sm p-8 sm:p-12 rounded-3xl border border-brand-slate-light/20 w-full md:w-auto flex flex-col items-center overflow-hidden">
                        {/* Mini whale in CTA */}
                        <div className="absolute -right-6 -bottom-6 w-24 h-24 opacity-[0.06] pointer-events-none select-none rotate-12">
                            <img src="/marketing/hero-bg.webp" alt="" aria-hidden="true" width="96" height="96" className="w-full h-full object-contain invert" />
                        </div>

                        <p className="text-brand-sky text-sm font-semibold uppercase tracking-widest mb-3">This is just a sample</p>
                        <h4 className="text-2xl font-bold text-white mb-2">We handle hundreds of cases every month</h4>
                        <p className="text-brand-slate-lighter mb-8 max-w-xl mx-auto">
                            From single crowns to full-mouth rehabilitations — reach out to discuss your next case or request our complete portfolio.
                        </p>
                        <a
                            href="https://wa.me/201034141917"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-8 py-4 bg-brand-blue hover:bg-brand-sky text-white font-bold rounded-xl cursor-pointer transition-[transform,colors,box-shadow] duration-300 hover:-translate-y-1 shadow-md shadow-brand-blue/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-sky/50"
                        >
                            Discuss a Case With Us
                        </a>
                    </div>
                </div>

            </div>

            {/* Lightbox */}
            {lightboxImage && (
                <ImageModal src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
            )}
        </section>
    );
}
