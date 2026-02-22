const serviceGroups = [
    {
        group: "Ceramic & Aesthetic Restorations",
        services: [
            { name: "Zirconia", desc: "High-strength monolithic & multilayer zirconia" },
            { name: "Zircomax", desc: "Zirconia cutback with E.max powder veneer — precision meets aesthetics" },
            { name: "E.max CAD / Press", desc: "Milled & pressed lithium disilicate — optimal translucency, fully digital workflow" },
            { name: "PFM", desc: "Porcelain-fused-to-metal for posterior reliability" },
            { name: "Smile Design", desc: "Digital smile planning & proportions analysis" },
            { name: "Mock-up", desc: "PMMA intraoral preview before final delivery" },
        ]
    },
    {
        group: "Implant Solutions",
        services: [
            { name: "Planning & Surgical Guide", desc: "Complete digital implant planning and precision-printed surgical guides" },
            { name: "Screw-Retained Crown", desc: "Direct implant-connected zirconia or E.max restoration" },
            { name: "Cement-Retained Crown", desc: "Abutment-based cemented restoration for precise emergence profile" },
            { name: "Custom Abutment", desc: "CAD/CAM-designed titanium custom abutments" },
            { name: "Titanium Framework", desc: "Milled titanium frameworks for implant-supported bars" },
            { name: "Metal Framework", desc: "Printed or milled frameworks — no casting" },
        ]
    },
];

export default function ServicesSection() {
    return (
        <section className="bg-brand-offwhite relative overflow-hidden" id="services">
            {/* Whale — subtle left watermark */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-80 h-80 opacity-[0.06] pointer-events-none select-none">
                <img
                    src="/marketing/hero-bg.webp"
                    alt=""
                    aria-hidden="true"
                    width="320"
                    height="320"
                    className="w-full h-full object-contain -scale-x-100"
                />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 relative z-10 flex flex-col items-center">
                <div className="text-center mb-14">
                    <h2 className="text-brand-blue font-bold tracking-widest uppercase text-sm mb-2">Our Offerings</h2>
                    <h3 className="text-3xl md:text-5xl font-bold text-brand-black mb-6 tracking-tight">Precision & Aesthetics</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                    {serviceGroups.map((group) => (
                        <div key={group.group} className="bg-white border border-gray-200 rounded-2xl p-6 transition-[background-color,border-color,transform,box-shadow] duration-300 hover:border-brand-blue/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-blue/5 cursor-default group">
                            <h4 className="text-brand-blue text-xs font-bold uppercase tracking-widest mb-4 pb-3 border-b border-gray-200 group-hover:border-brand-blue/40 transition-colors duration-300">
                                {group.group}
                            </h4>
                            <ul className="space-y-3">
                                {group.services.map((s) => (
                                    <li key={s.name} className="flex gap-3">
                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-blue shrink-0 group-hover:shadow-[0_0_8px_rgba(59,130,246,0.6)] transition-shadow duration-300" />
                                        <div>
                                            <p className="text-brand-black text-sm font-semibold leading-tight text-left">{s.name}</p>
                                            <p className="text-brand-slate-light text-xs mt-0.5 leading-snug text-left">{s.desc}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <p className="text-left text-brand-slate-light/60 text-sm mt-6 italic">
                    * All CAD/CAM restorations are powered by cutting-edge digital workflows.
                </p>
            </div>
        </section>
    );
}
