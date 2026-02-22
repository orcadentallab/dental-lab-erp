import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

const faqs = [
    {
        question: "Who are we?",
        questionAr: "احنا مين؟",
        answer: "ORCA Dental Lab is a specialized digital dental laboratory based in Egypt. Our entire team is composed of dentists, bringing clinical expertise into every step of the laboratory process.",
        answerAr: "أوركا Dental Lab هو Digital Dental Lab مقرنا في مصر. تميزنا الحقيقي إن فريقنا بالكامل من أطباء أسنان، وبالتالي كل خطوة في عملنا مبنية على clinical experience ومعرفة دقيقة باحتياجات الطبيب والمريض."
    },
    {
        question: "What do we do?",
        questionAr: "بنقدم ايه؟",
        answer: "We provide advanced dental prosthetic solutions including Crowns, Bridges, Veneers, Implant Restorations, and Full-Mouth Rehabilitations. Our focus is on precision, aesthetics, and reliability.",
        answerAr: "بنوفّر حلول متكاملة في مجال التركيبات والتجميل تشمل: Crowns، Bridges، Veneers، Implant Restorations، وFull-mouth Rehabilitation."
    },
    {
        question: "How do we do it?",
        questionAr: "ازاي بنشتغل؟",
        answer: "We combine state-of-the-art digital technologies (Digital Scanning, CAD/CAM) with clinical knowledge. Every case is managed with accuracy and professional insight that only dentists can offer.",
        answerAr: "بنستخدم أحدث تقنيات طب الأسنان الرقمية (Digital Scanning – CAD/CAM Design) مع خبرة عملية مباشرة من الأطباء. كل حالة يتم التعامل معها بدقة متناهية ومتابعة مستمرة."
    },
    {
        question: "Why choose ORCA?",
        questionAr: "ليه تختار أوركا؟",
        answer: "Because every detail matters. At ORCA, we understand the challenges of both the clinic and the lab — seamless communication, dependable timelines, and results that meet functional and aesthetic expectations.",
        answerAr: "لأننا بنؤمن أن \"كل تفصيلة بتفرق\". خبرتنا كدكاترة بتخلينا نفهم تحديات العيادة والمعمل في نفس الوقت."
    }
];

function AccordionItem({ item, isOpen, onToggle }: {
    item: typeof faqs[0];
    isOpen: boolean;
    onToggle: () => void;
}) {
    return (
        <div className={clsx(
            'rounded-2xl border transition-[border-color,background-color] duration-300 overflow-hidden',
            isOpen ? 'border-brand-sky/40 bg-brand-slate shadow-lg' : 'border-brand-slate-light/30 bg-brand-slate/40 hover:border-brand-sky/20'
        )}>
            <button onClick={onToggle} className="w-full flex items-center justify-between p-5 text-left gap-4 cursor-pointer transition-colors duration-300 hover:bg-brand-slate-light/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sky/50" aria-expanded={isOpen}>
                <div className="flex-1">
                    <p className="font-bold text-white text-sm">{item.question}</p>
                    {item.questionAr && <p className="text-brand-sky text-xs mt-0.5 font-medium" dir="rtl">{item.questionAr}</p>}
                </div>
                <ChevronDown size={18} className={clsx('text-brand-sky shrink-0 transition-transform duration-300', isOpen && 'rotate-180')} />
            </button>
            <div className={clsx('overflow-hidden transition-[max-height,opacity] duration-300', isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0')}>
                <div className="px-5 pb-5 space-y-2 border-t border-brand-slate-light/20 pt-4">
                    <p className="text-brand-offwhite-dark text-sm leading-relaxed">{item.answer}</p>
                    {item.answerAr && <p className="text-brand-slate-lighter text-sm leading-relaxed" dir="rtl">{item.answerAr}</p>}
                </div>
            </div>
        </div>
    );
}

export default function FAQSection() {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    return (
        <section className="bg-brand-black relative overflow-hidden py-24" id="faq">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-start">

                    {/* Left Column: Title & Intro */}
                    <div className="lg:sticky lg:top-32 text-center lg:text-left flex flex-col items-center lg:items-start text-brand-offwhite">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-slate-light/20 border border-brand-sky/30 text-brand-sky text-xs font-bold uppercase tracking-widest mb-6">
                            Support & Knowledge
                        </div>
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Frequently <br className="hidden lg:block" />Asked Questions</h2>
                        <p className="text-brand-slate-light text-lg mb-8 max-w-md mx-auto lg:mx-0">
                            Find clear, quick answers to the most common questions about our dental abstraction workflows, materials, and digital processes.
                        </p>

                        {/* Decorative element */}
                        <div className="hidden lg:flex w-full h-px bg-gradient-to-r from-brand-sky/30 to-brand-slate/10 mt-12 mb-12"></div>

                        <div className="text-brand-slate-lighter text-sm italic">
                            Got a more specific case question? <a href="#contact" className="text-brand-sky hover:text-white underline underline-offset-4 transition-colors">Contact our technical support</a>.
                        </div>
                    </div>

                    {/* Right Column: Accordion */}
                    <div className="space-y-3">
                        {faqs.map((item, index) => (
                            <AccordionItem
                                key={index}
                                item={item}
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
