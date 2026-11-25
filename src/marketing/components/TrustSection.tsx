import { ShieldCheck, ScanLine, Cpu, CheckCircle2, Truck } from 'lucide-react';
import { useMarketingLanguage } from '../MarketingLanguageContext';
import {
    caseJourneySteps,
    experienceData,
    labNumbers,
    remakePolicy,
    teamMembers,
    testimonials,
} from '../content';

const stepIcons = [ScanLine, Cpu, CheckCircle2, Truck];

export default function TrustSection() {
    const { lang, t } = useMarketingLanguage();

    const hasExperience =
        Boolean(experienceData.yearsInBusiness) ||
        experienceData.teamRoles.length > 0 ||
        experienceData.technologiesAndMaterials.length > 0 ||
        Boolean(experienceData.workflowNote);

    return (
        <section className="py-24 bg-white relative overflow-hidden border-t border-gray-100" id="trust">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                {/* Header */}
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-brand-blue font-bold tracking-widest uppercase text-sm mb-2">
                        {t.trust.eyebrow}
                    </h2>
                    <h3 className="text-3xl md:text-5xl font-bold text-brand-black mb-5 tracking-tight">
                        {t.trust.heading}
                    </h3>
                    <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
                        {t.trust.subtitle}
                    </p>
                </div>

                {/* Verified Numbers — hidden until owner populates labNumbers in content.ts */}
                {labNumbers.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
                        {labNumbers.map((item, idx) => (
                            <div
                                key={idx}
                                className="bg-brand-offwhite border border-gray-200 rounded-2xl p-6 text-center"
                            >
                                <p className="text-3xl font-bold text-brand-blue tabular-nums">{item.value}</p>
                                <p className="text-sm text-slate-600 mt-1 font-medium">
                                    {lang === 'ar' && item.labelAr ? item.labelAr : item.label}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {/* 4-Step Case Journey Strip */}
                <div className="mb-14">
                    <h4 className="text-xl md:text-2xl font-bold text-brand-black mb-8 text-center">
                        {t.trust.journeyHeading}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        {caseJourneySteps.map((item, idx) => {
                            const Icon = stepIcons[idx] ?? CheckCircle2;
                            return (
                                <div
                                    key={item.step}
                                    className="bg-brand-offwhite border border-gray-200 rounded-2xl p-6 flex flex-col text-start transition-[border-color,box-shadow] duration-300 hover:border-brand-blue/40 hover:shadow-lg hover:shadow-brand-blue/5"
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="w-10 h-10 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center">
                                            <Icon size={20} />
                                        </span>
                                        <span className="text-xs font-bold tracking-widest text-brand-slate-light">
                                            {item.step}
                                        </span>
                                    </div>
                                    <h5 className="text-base font-bold text-brand-black mb-2">
                                        {lang === 'ar' ? item.titleAr : item.titleEn}
                                    </h5>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        {lang === 'ar' ? item.descAr : item.descEn}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Written Remake / QC Policy */}
                <div className="bg-brand-black text-white rounded-3xl p-8 sm:p-10 border border-brand-slate-light/20 flex flex-col md:flex-row items-start gap-6 text-start">
                    <div className="w-12 h-12 rounded-2xl bg-brand-sky/15 text-brand-sky flex items-center justify-center shrink-0">
                        <ShieldCheck size={26} />
                    </div>
                    <div>
                        <h4 className="text-xl font-bold text-white mb-2">
                            {lang === 'ar' ? remakePolicy.titleAr : remakePolicy.titleEn}
                        </h4>
                        <p className="text-sm sm:text-base text-brand-offwhite-dark leading-relaxed">
                            {lang === 'ar' ? remakePolicy.bodyAr : remakePolicy.bodyEn}
                        </p>
                    </div>
                </div>

                {/* Experience Block — rendered only when owner fills in fields in content.ts */}
                {hasExperience && (
                    <div className="mt-12 bg-brand-offwhite border border-gray-200 rounded-3xl p-8 text-start">
                        <h4 className="text-xl font-bold text-brand-black mb-6">
                            {t.trust.experienceHeading}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {experienceData.yearsInBusiness && (
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-brand-blue mb-1">
                                        {t.trust.yearsLabel}
                                    </p>
                                    <p className="text-base font-semibold text-brand-black">
                                        {experienceData.yearsInBusiness}
                                    </p>
                                </div>
                            )}
                            {experienceData.workflowNote && (
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-brand-blue mb-1">
                                        {t.trust.workflowLabel}
                                    </p>
                                    <p className="text-base font-semibold text-brand-black">
                                        {experienceData.workflowNote}
                                    </p>
                                </div>
                            )}
                            {experienceData.teamRoles.length > 0 && (
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-brand-blue mb-2">
                                        {t.trust.teamRolesLabel}
                                    </p>
                                    <ul className="space-y-1 text-sm text-slate-700">
                                        {experienceData.teamRoles.map((role) => (
                                            <li key={role}>• {role}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {experienceData.technologiesAndMaterials.length > 0 && (
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-brand-blue mb-2">
                                        {t.trust.materialsLabel}
                                    </p>
                                    <ul className="space-y-1 text-sm text-slate-700">
                                        {experienceData.technologiesAndMaterials.map((item) => (
                                            <li key={item}>• {item}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Team Members — hidden until owner populates teamMembers in content.ts */}
                {teamMembers.length > 0 && (
                    <div className="mt-14">
                        <h4 className="text-xl font-bold text-brand-black mb-6 text-center">
                            {t.trust.teamHeading}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {teamMembers.map((member) => (
                                <div
                                    key={member.name}
                                    className="bg-brand-offwhite border border-gray-200 rounded-2xl p-5 flex items-center gap-4 text-start"
                                >
                                    {member.photo && (
                                        <img
                                            src={member.photo}
                                            alt={member.name}
                                            width={64}
                                            height={64}
                                            loading="lazy"
                                            className="w-16 h-16 rounded-xl object-cover shrink-0"
                                        />
                                    )}
                                    <div>
                                        <p className="font-bold text-brand-black text-base">{member.name}</p>
                                        <p className="text-sm text-slate-600">{member.role}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Testimonials — hidden until owner populates testimonials in content.ts */}
                {testimonials.length > 0 && (
                    <div className="mt-14">
                        <h4 className="text-xl font-bold text-brand-black mb-6 text-center">
                            {t.trust.testimonialsHeading}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {testimonials.map((item, idx) => (
                                <blockquote
                                    key={idx}
                                    className="bg-brand-offwhite border border-gray-200 rounded-2xl p-6 text-start"
                                >
                                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                                        “{item.quote}”
                                    </p>
                                    <footer className="flex items-center gap-3">
                                        {item.photo && (
                                            <img
                                                src={item.photo}
                                                alt={item.name}
                                                width={40}
                                                height={40}
                                                loading="lazy"
                                                className="w-10 h-10 rounded-full object-cover"
                                            />
                                        )}
                                        <div>
                                            <p className="font-bold text-brand-black text-sm">{item.name}</p>
                                            <p className="text-xs text-slate-500">
                                                {item.title} — {item.clinic}
                                            </p>
                                        </div>
                                    </footer>
                                </blockquote>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
