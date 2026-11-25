import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useMarketingLanguage } from '../MarketingLanguageContext';

function AccordionItem({
    question,
    answer,
    isOpen,
    onToggle,
}: {
    question: string;
    answer: string;
    isOpen: boolean;
    onToggle: () => void;
}) {
    return (
        <div
            className={clsx(
                'rounded-2xl border transition-[border-color,background-color] duration-300 overflow-hidden',
                isOpen
                    ? 'border-brand-sky/40 bg-brand-slate shadow-lg'
                    : 'border-brand-slate-light/30 bg-brand-slate/40 hover:border-brand-sky/20'
            )}
        >
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between p-5 text-start gap-4 cursor-pointer transition-colors duration-300 hover:bg-brand-slate-light/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sky/50"
                aria-expanded={isOpen ? 'true' : 'false'}
            >
                <span className="flex-1 font-bold text-white text-sm">{question}</span>
                <ChevronDown
                    size={18}
                    className={clsx(
                        'text-brand-sky shrink-0 transition-transform duration-300',
                        isOpen && 'rotate-180'
                    )}
                />
            </button>
            <div
                className={clsx(
                    'overflow-hidden transition-[max-height,opacity] duration-300',
                    isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                )}
            >
                <div className="px-5 pb-5 border-t border-brand-slate-light/20 pt-4 text-start">
                    <p className="text-brand-offwhite-dark text-sm leading-relaxed">{answer}</p>
                </div>
            </div>
        </div>
    );
}

export default function FAQSection() {
    const { t } = useMarketingLanguage();
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    return (
        <section className="bg-brand-black relative overflow-hidden py-24" id="faq">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-start">
                    {/* Left Column: Title & Intro */}
                    <div className="lg:sticky lg:top-32 text-center lg:text-start flex flex-col items-center lg:items-start text-brand-offwhite">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-slate-light/20 border border-brand-sky/30 text-brand-sky text-xs font-bold uppercase tracking-widest mb-6">
                            {t.faq.badge}
                        </div>
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                            {t.faq.headingLine1} <br className="hidden lg:block" />
                            {t.faq.headingLine2}
                        </h2>
                        <p className="text-brand-slate-light text-lg mb-8 max-w-md mx-auto lg:mx-0">
                            {t.faq.subtitle}
                        </p>

                        <div className="hidden lg:flex w-full h-px bg-gradient-to-r from-brand-sky/30 to-brand-slate/10 mt-12 mb-12" />

                        <div className="text-brand-slate-lighter text-sm italic">
                            {t.faq.supportPrompt}{' '}
                            <a
                                href="#contact"
                                className="text-brand-sky hover:text-white underline underline-offset-4 transition-colors"
                            >
                                {t.faq.supportLink}
                            </a>
                            .
                        </div>
                    </div>

                    {/* Right Column: Accordion */}
                    <div className="space-y-3">
                        {t.faq.items.map((item, index) => (
                            <AccordionItem
                                key={item.question}
                                question={item.question}
                                answer={item.answer}
                                isOpen={openIndex === index}
                                onToggle={() => setOpenIndex(openIndex === index ? null : index)}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
