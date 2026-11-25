export type MarketingLang = 'en' | 'ar';

export interface MarketingDictionary {
    meta: {
        title: string;
        description: string;
        ogTitle: string;
        ogDescription: string;
    };
    nav: {
        services: string;
        trust: string;
        portfolio: string;
        pricing: string;
        faq: string;
        contact: string;
        portalLogin: string;
        startCase: string;
        openMenu: string;
        closeMenu: string;
        brandSub: string;
    };
    hero: {
        badge: string;
        titlePrefix: string;
        titleHighlight: string;
        titleSuffix: string;
        subtitle: string;
        scannerBadge: string;
        scannerText: string;
        registerClinic: string;
        sendWhatsapp: string;
        whatsappPrefill: string;
        tagline: string;
    };
    services: {
        eyebrow: string;
        heading: string;
        footnote: string;
        groups: {
            group: string;
            services: { name: string; desc: string }[];
        }[];
    };
    trust: {
        eyebrow: string;
        heading: string;
        subtitle: string;
        journeyHeading: string;
        experienceHeading: string;
        yearsLabel: string;
        teamRolesLabel: string;
        materialsLabel: string;
        workflowLabel: string;
        testimonialsHeading: string;
        teamHeading: string;
    };
    portfolio: {
        eyebrow: string;
        heading: string;
        subtitle: string;
        workflowTag: string;
        workflowTitle: string;
        workflowDesc: string;
        workflowAlt: string;
        moreCasesTag: string;
        moreCasesDesc: string;
        ctaTitle: string;
        ctaDesc: string;
        ctaRegister: string;
        ctaWhatsapp: string;
        whatsappPrefill: string;
        closePreview: string;
        imagePreviewAria: string;
    };
    pricing: {
        eyebrow: string;
        heading: string;
        subtitle: string;
        colService: string;
        colPrice: string;
        fromPrefix: string;
        categories: {
            category: string;
            items: { name: string; price: string }[];
        }[];
        ctaTitle: string;
        ctaDesc: string;
        ctaRegister: string;
        ctaWhatsapp: string;
        whatsappPrefill: string;
        advantageTitle: string;
        advantages: { title: string; desc: string }[];
    };
    faq: {
        badge: string;
        headingLine1: string;
        headingLine2: string;
        subtitle: string;
        supportPrompt: string;
        supportLink: string;
        items: { question: string; answer: string }[];
    };
    contact: {
        eyebrow: string;
        heading: string;
        subtitle: string;
        callLabel: string;
        emailLabel: string;
        labLabel: string;
        locationValue: string;
        formTitle: string;
        successMsg: string;
        errorMsg: string;
        doctorNameLabel: string;
        doctorNamePlaceholder: string;
        clinicNameLabel: string;
        clinicNamePlaceholder: string;
        phoneLabel: string;
        phonePlaceholder: string;
        messageLabel: string;
        messagePlaceholder: string;
        sendingBtn: string;
        submitBtn: string;
        whatsappLabel: string;
        whatsappPrefill: string;
    };
    footer: {
        brandDesc: string;
        quickLinks: string;
        contactTitle: string;
        portalTitle: string;
        doctorLogin: string;
        registerClinic: string;
        startCase: string;
        rightsReserved: string;
        tagline: string;
    };
}

export const marketingDictionary: Record<MarketingLang, MarketingDictionary> = {
    en: {
        meta: {
            title: 'ORCA Dental Lab | Digital Dental Restorations & Doctor Portal',
            description:
                'ORCA Dental Lab is a dentist-led digital dental laboratory in Egypt offering CAD/CAM crowns, veneers, implant prosthetics, and a dedicated doctor portal.',
            ogTitle: 'ORCA Dental Lab | Digital Dental Restorations',
            ogDescription:
                'Dentist-led digital dental lab in Egypt. Register your clinic in the doctor portal or send a case directly on WhatsApp.',
        },
        nav: {
            services: 'Services',
            trust: 'Why ORCA',
            portfolio: 'Portfolio',
            pricing: 'Pricing',
            faq: 'FAQ',
            contact: 'Contact',
            portalLogin: 'Portal Login',
            startCase: 'Start a Case →',
            openMenu: 'Open menu',
            closeMenu: 'Close menu',
            brandSub: 'Dental Solutions',
        },
        hero: {
            badge: 'Precision Digital Dentistry',
            titlePrefix: 'Crafting',
            titleHighlight: 'High-Precision',
            titleSuffix: 'Dental Restorations',
            subtitle:
                'ORCA Dental Lab specializes in digital dental restorations, combining CAD/CAM workflows with clinical oversight to deliver consistent fit, aesthetics, and reliability for your clinic.',
            scannerBadge: 'NEW:',
            scannerText:
                'We bring our intraoral scanners to your clinic — seamless digital impressions with zero equipment investment on your end.',
            registerClinic: 'Register your clinic',
            sendWhatsapp: 'Send a case on WhatsApp',
            whatsappPrefill: "Hello ORCA Dental Lab, I'd like to send a case.",
            tagline: "✦ A Dentist's Touch Behind Every Detail",
        },
        services: {
            eyebrow: 'Our Offerings',
            heading: 'Precision & Aesthetics',
            footnote: '* All CAD/CAM restorations follow structured digital design and quality-control workflows.',
            groups: [
                {
                    group: 'Ceramic & Aesthetic Restorations',
                    services: [
                        { name: 'Zirconia', desc: 'High-strength monolithic & multilayer zirconia' },
                        { name: 'Zircomax', desc: 'Zirconia cutback with E.max powder veneer — precision meets aesthetics' },
                        { name: 'E.max CAD / Press', desc: 'Milled & pressed lithium disilicate — optimal translucency, fully digital workflow' },
                        { name: 'PFM', desc: 'Porcelain-fused-to-metal for posterior reliability' },
                        { name: 'Smile Design', desc: 'Digital smile planning & proportions analysis' },
                        { name: 'Mock-up', desc: 'PMMA intraoral preview before final delivery' },
                    ],
                },
                {
                    group: 'Implant Solutions',
                    services: [
                        { name: 'Planning & Surgical Guide', desc: 'Complete digital implant planning and precision-printed surgical guides' },
                        { name: 'Screw-Retained Crown', desc: 'Direct implant-connected zirconia or E.max restoration' },
                        { name: 'Cement-Retained Crown', desc: 'Abutment-based cemented restoration for precise emergence profile' },
                        { name: 'Custom Abutment', desc: 'CAD/CAM-designed titanium custom abutments' },
                        { name: 'Titanium Framework', desc: 'Milled titanium frameworks for implant-supported bars' },
                        { name: 'Metal Framework', desc: 'Printed or milled frameworks — no casting' },
                    ],
                },
            ],
        },
        trust: {
            eyebrow: 'Why Dentists Trust Us',
            heading: 'Built Around Clinical Predictability',
            subtitle:
                'Clear communication, dentist-led CAD review, and documented quality checks on every restoration.',
            journeyHeading: 'How a case moves with us',
            experienceHeading: 'Lab Capabilities & Experience',
            yearsLabel: 'Years in Business',
            teamRolesLabel: 'Team Roles',
            materialsLabel: 'Technologies & Materials',
            workflowLabel: 'Production Workflow',
            testimonialsHeading: 'What Dentists Say',
            teamHeading: 'Clinical & Lab Team',
        },
        portfolio: {
            eyebrow: 'Our Portfolio',
            heading: 'Clinical Case Gallery',
            subtitle:
                'Real cases designed and finished with digital precision — from single anterior crowns to full-arch implant rehabilitations.',
            workflowTag: 'Our Digital Workflow',
            workflowTitle: 'From Scan to Final — A Complete Case Journey',
            workflowDesc:
                'Pre-operative assessment, intraoral scan, CAD design review, PMMA mock-up validation, and final restoration.',
            workflowAlt: 'Complete Digital Workflow — Pre-operative to Final Restoration',
            moreCasesTag: 'Additional Clinical Cases',
            moreCasesDesc:
                'Selected zirconia crowns, endocrowns, implant restorations, and anterior ceramic cases.',
            ctaTitle: 'Ready to send your next case?',
            ctaDesc:
                'Register your clinic in the doctor portal to submit cases and track status in real time, or message us directly on WhatsApp.',
            ctaRegister: 'Register your clinic',
            ctaWhatsapp: 'Send a case on WhatsApp',
            whatsappPrefill: "Hello ORCA Dental Lab, I'd like to discuss a clinical case.",
            closePreview: 'Close preview',
            imagePreviewAria: 'Image preview',
        },
        pricing: {
            eyebrow: 'Detailed Price List',
            heading: 'Transparent Value',
            subtitle:
                'Starting prices for our digital dental restorations and prosthetics in EGP.',
            colService: 'Service',
            colPrice: 'Price (EGP)',
            fromPrefix: 'from',
            categories: [
                {
                    category: 'Crowns & Bridges',
                    items: [
                        { name: 'Zirconia (Zr)', price: '750' },
                        { name: 'Zircomax', price: '1000' },
                        { name: 'E.max (Lithium Disilicate)', price: '950' },
                        { name: 'PFM', price: '450' },
                    ],
                },
                {
                    category: 'Implant Prosthetics',
                    items: [
                        { name: 'Custom Abutment', price: '600' },
                        { name: 'Toronto Framework', price: '250' },
                    ],
                },
                {
                    category: 'Surgical & Mock Up',
                    items: [
                        { name: 'Surgical Guide', price: '1100' },
                        { name: 'Mock Up Cast (Smile Design)', price: '600' },
                    ],
                },
            ],
            ctaTitle: 'Want The Full Picture?',
            ctaDesc:
                'Register your clinic in the doctor portal for full case pricing and digital tracking, or message us on WhatsApp.',
            ctaRegister: 'Register your clinic',
            ctaWhatsapp: 'Chat on WhatsApp',
            whatsappPrefill: "Hello ORCA Dental Lab, I'd like to request the full price list.",
            advantageTitle: 'The ORCA Advantage',
            advantages: [
                {
                    title: '100% Digital Workflow',
                    desc: 'CAD/CAM precision — avoiding manual casting distortions',
                },
                {
                    title: 'Trusted Dental Materials',
                    desc: 'Multilayer zirconia, lithium disilicate (E.max), and medical-grade PMMA',
                },
                {
                    title: 'Doctor Portal Tracking',
                    desc: 'Follow every stage from scan upload to clinic delivery in one place',
                },
                {
                    title: 'Scanner at Your Clinic',
                    desc: 'We bring the intraoral scanner to your office for on-site digital impressions',
                },
            ],
        },
        faq: {
            badge: 'Support & Knowledge',
            headingLine1: 'Frequently',
            headingLine2: 'Asked Questions',
            subtitle:
                'Clear answers to common questions about our dental restoration workflows, materials, and digital processes.',
            supportPrompt: 'Got a more specific case question?',
            supportLink: 'Contact our technical support',
            items: [
                {
                    question: 'Who are we?',
                    answer: 'ORCA Dental Lab is a specialized digital dental laboratory based in Egypt. Our clinical team is led by dentists, bringing clinical insight into every step of the laboratory process.',
                },
                {
                    question: 'What do we do?',
                    answer: 'We provide digital dental prosthetic solutions including Crowns, Bridges, Veneers, Implant Restorations, Surgical Guides, and Full-Mouth Rehabilitations focused on fit, aesthetics, and reliability.',
                },
                {
                    question: 'How do we do it?',
                    answer: 'We combine digital technologies (Intraoral Scanning, CAD/CAM design, milling, and 3D printing) with clinical oversight so every margin, contact, and occlusal plane is checked before delivery.',
                },
                {
                    question: 'Why choose ORCA?',
                    answer: 'Because every detail matters. Understanding both the clinic and the lab helps us keep communication clear, quality consistent, and restorations predictable at chairside.',
                },
            ],
        },
        contact: {
            eyebrow: 'Connect With Us',
            heading: 'Ready to elevate your practice?',
            subtitle:
                "Get in touch to discuss your next complex case, request our full price list, or register your clinic in the doctor portal.",
            callLabel: 'Call Us / WhatsApp',
            emailLabel: 'Email',
            labLabel: 'Laboratory',
            locationValue: 'Cairo, Egypt',
            formTitle: 'Send us a message',
            successMsg: "✅ Message sent successfully! We'll reach out to you soon.",
            errorMsg: '❌ Something went wrong. Please try again or contact us via WhatsApp.',
            doctorNameLabel: 'Doctor Name',
            doctorNamePlaceholder: 'Dr. Mohamed Ali',
            clinicNameLabel: 'Clinic Name',
            clinicNamePlaceholder: 'Dental Clinic',
            phoneLabel: 'Phone Number',
            phonePlaceholder: '+20...',
            messageLabel: 'Message',
            messagePlaceholder: 'We would like to send a digital case…',
            sendingBtn: 'Sending…',
            submitBtn: "Send Message — We’ll get back to you.",
            whatsappLabel: 'Chat on WhatsApp',
            whatsappPrefill: "Hello ORCA Dental Lab, I'd like to ask about sending a case.",
        },
        footer: {
            brandDesc:
                'ORCA Dental Lab specializes in high-precision digital dental restorations, supporting clinics with structured CAD/CAM workflows and portal tracking.',
            quickLinks: 'Quick Links',
            contactTitle: 'Contact',
            portalTitle: 'Doctor Portal',
            doctorLogin: 'Doctor Login',
            registerClinic: 'Register Clinic',
            startCase: 'Start a Case →',
            rightsReserved: 'ORCA Dental Lab. All rights reserved.',
            tagline: "✦ A Dentist's Touch Behind Every Detail",
        },
    },
    ar: {
        meta: {
            title: 'ORCA Dental Lab | معمل أسنان رقمي وبوابة الطبيب',
            description:
                'معمل ORCA Dental Lab في مصر — تركيبات أسنان رقمية (Zirconia، E.max، Implant Prosthetics) مع بوابة إلكترونية لمتابعة الحالات.',
            ogTitle: 'ORCA Dental Lab | معمل أسنان رقمي',
            ogDescription:
                'سجّل عيادتك في بوابة الطبيب أو ابعت حالتك مباشرة على واتساب.',
        },
        nav: {
            services: 'الخدمات',
            trust: 'ليه أوركا',
            portfolio: 'سابقة الأعمال',
            pricing: 'الأسعار',
            faq: 'الأسئلة الشائعة',
            contact: 'تواصل معنا',
            portalLogin: 'دخول البوابة',
            startCase: 'ابدأ حالة ←',
            openMenu: 'فتح القائمة',
            closeMenu: 'إغلاق القائمة',
            brandSub: 'حلول رقمية للأسنان',
        },
        hero: {
            badge: 'Precision Digital Dentistry',
            titlePrefix: 'تصنيع',
            titleHighlight: 'تركيبات رقمية',
            titleSuffix: 'بدقة إكلينيكية عالية',
            subtitle:
                'معمل ORCA Dental Lab متخصص في التركيبات الرقمية، بنجمع بين تكنولوجيا الـ CAD/CAM وإشراف أطباء الأسنان علشان نضمن fit دقيق ونتيجة تجميلية ثابتة لعيادتك.',
            scannerBadge: 'جديد:',
            scannerText:
                'بنوصلك بالـ intraoral scanner لحد عيادتك — digital impressions دقيقة من غير أي تكلفة أجهزة عليك.',
            registerClinic: 'سجّل عيادتك الآن',
            sendWhatsapp: 'ابعت حالة على واتساب',
            whatsappPrefill: 'أهلاً ORCA Dental Lab، حابب أبعت حالة جديدة.',
            tagline: '✦ لمسة طبيب وراء كل تفصيلة',
        },
        services: {
            eyebrow: 'خدماتنا',
            heading: 'الدقة والجمال في كل تركيبة',
            footnote: '* كل حالات الـ CAD/CAM بتمر بخطوات تصميم رقمي ومراجعة جودة منظمة.',
            groups: [
                {
                    group: 'تركيبات السيراميك والتجميل',
                    services: [
                        { name: 'Zirconia', desc: 'تركيبات monolithic و multilayer zirconia بصلابة وجمال طبيعي' },
                        { name: 'Zircomax', desc: 'Zirconia cutback مع E.max powder veneer — توازن بين القوة والـ aesthetics' },
                        { name: 'E.max CAD / Press', desc: 'Lithium disilicate بتصميم رقمي كامل وشفافية مثالية' },
                        { name: 'PFM', desc: 'Porcelain-fused-to-metal للضروس الخلفية واعتمادية عالية' },
                        { name: 'Smile Design', desc: 'تخطيط رقمي للابتسامة وتحليل النسب الجمالية' },
                        { name: 'Mock-up', desc: 'نموذج تجريبي من الـ PMMA داخل الفم قبل التسليم النهائي' },
                    ],
                },
                {
                    group: 'حلول الزرعات (Implant Solutions)',
                    services: [
                        { name: 'Planning & Surgical Guide', desc: 'تخطيط رقمي كامل للزرعات وطباعة surgical guides بدقة عالية' },
                        { name: 'Screw-Retained Crown', desc: 'تيجان zirconia أو E.max متصلة مباشرة بالـ implant' },
                        { name: 'Cement-Retained Crown', desc: 'تيجان على abutment لـ emergence profile مظبوط' },
                        { name: 'Custom Abutment', desc: 'دعامات titanium مخصصة بتصميم CAD/CAM' },
                        { name: 'Titanium Framework', desc: 'هياكل titanium مخروطة لتركيبات الـ implant bars' },
                        { name: 'Metal Framework', desc: 'هياكل معدنية مطبوعة أو مخروطة — بدون casting يدوي' },
                    ],
                },
            ],
        },
        trust: {
            eyebrow: 'ليه الأطباء بيثقوا فينا',
            heading: 'شغل مبني على وضوح إكلينيكي',
            subtitle:
                'تواصل مباشر، مراجعة CAD بإشراف أطباء، وفحص جودة واضح لكل حالة قبل التسليم.',
            journeyHeading: 'رحلة الحالة معانا في 4 خطوات',
            experienceHeading: 'إمكانيات وخبرة المعمل',
            yearsLabel: 'سنوات الخبرة',
            teamRolesLabel: 'تخصصات الفريق',
            materialsLabel: 'التقنيات والخامات',
            workflowLabel: 'نظام التصنيع',
            testimonialsHeading: 'آراء الأطباء',
            teamHeading: 'فريق المعمل',
        },
        portfolio: {
            eyebrow: 'سابقة الأعمال',
            heading: 'معرض الحالات الإكلينيكية',
            subtitle:
                'حالات حقيقية متصممة ومتنفذة بدقة رقمية — من التيجان الفردية لحد تأهيل الفك الكامل على زرعات.',
            workflowTag: 'مسار العمل الرقمي',
            workflowTitle: 'من الـ Scan للتسليم — رحلة الحالة الكاملة',
            workflowDesc:
                'تقييم الحالة، أخذ الـ intraoral scan، مراجعة التصميم على الـ CAD، تجربة الـ PMMA mock-up، والتركيبة النهائية.',
            workflowAlt: 'مسار العمل الرقمي الكامل في معمل ORCA',
            moreCasesTag: 'حالات إكلينيكية إضافية',
            moreCasesDesc:
                'مجموعة إضافية من حالات الـ zirconia crowns والـ endocrowns وتركيبات الزرعات والـ veneers.',
            ctaTitle: 'جاهز تبعت حالتك الجاية؟',
            ctaDesc:
                'سجّل عيادتك في بوابة الطبيب علشان تبعت الحالات وتتابعها لحظة بلحظة، أو تواصل معانا على واتساب.',
            ctaRegister: 'سجّل عيادتك الآن',
            ctaWhatsapp: 'ابعت حالة على واتساب',
            whatsappPrefill: 'أهلاً ORCA Dental Lab، حابب أستفسر عن حالة.',
            closePreview: 'إغلاق الصورة',
            imagePreviewAria: 'عرض الصورة',
        },
        pricing: {
            eyebrow: 'قائمة الأسعار',
            heading: 'أسعار واضحة وشفافة',
            subtitle: 'الأسعار الابتدائية للتركيبات الرقمية بالجنيه المصري (EGP).',
            colService: 'الخدمة',
            colPrice: 'السعر (EGP)',
            fromPrefix: 'يبدأ من',
            categories: [
                {
                    category: 'التيجان والجسور (Crowns & Bridges)',
                    items: [
                        { name: 'Zirconia (Zr)', price: '750' },
                        { name: 'Zircomax', price: '1000' },
                        { name: 'E.max (Lithium Disilicate)', price: '950' },
                        { name: 'PFM', price: '450' },
                    ],
                },
                {
                    category: 'تركيبات الزرعات (Implant Prosthetics)',
                    items: [
                        { name: 'Custom Abutment', price: '600' },
                        { name: 'Toronto Framework', price: '250' },
                    ],
                },
                {
                    category: 'الجايد الجراحي والـ Mock Up',
                    items: [
                        { name: 'Surgical Guide', price: '1100' },
                        { name: 'Mock Up Cast (Smile Design)', price: '600' },
                    ],
                },
            ],
            ctaTitle: 'محتاج قائمة الأسعار الكاملة؟',
            ctaDesc:
                'سجّل عيادتك في بوابة الطبيب علشان تشوف تفاصيل الأسعار وتتابع حالاتك، أو كلمنا على واتساب.',
            ctaRegister: 'سجّل عيادتك الآن',
            ctaWhatsapp: 'تواصل على واتساب',
            whatsappPrefill: 'أهلاً ORCA Dental Lab، ممكن قائمة الأسعار الكاملة؟',
            advantageTitle: 'مميزات الشغل مع ORCA',
            advantages: [
                {
                    title: 'شغل رقمي 100%',
                    desc: 'دقة CAD/CAM — بعيداً عن أخطاء الـ manual casting',
                },
                {
                    title: 'خامات معتمدة في الشغل اليومي',
                    desc: 'Multilayer zirconia، E.max، وPMMA طبي للـ mock-up',
                },
                {
                    title: 'متابعة من بوابة الطبيب',
                    desc: 'تقدر تتابع حالة الأوردر من وقت رفع الـ scan لحد التسليم للعيادة',
                },
                {
                    title: 'الـ Scanner لحد عيادتك',
                    desc: 'بنيجي عيادتك بالـ intraoral scanner لأخذ الـ digital impression بسهولة',
                },
            ],
        },
        faq: {
            badge: 'الدعم والمعلومات',
            headingLine1: 'الأسئلة',
            headingLine2: 'الشائعة',
            subtitle:
                'إجابات واضحة على أكتر الأسئلة اللي بتهم أطباء الأسنان بخصوص خطوات الشغل والخامات والتعامل الرقمي.',
            supportPrompt: 'عندك سؤال بخصوص حالة معينة؟',
            supportLink: 'تواصل مع الدعم الفني',
            items: [
                {
                    question: 'احنا مين؟',
                    answer: 'أوركا Dental Lab هو Digital Dental Lab مقره في مصر. تميزنا الحقيقي إن الإشراف الإكلينيكي في فريقنا بيقوده أطباء أسنان، وبالتالي كل خطوة مبنية على فهم دقيق لاحتياجات الطبيب والمريض.',
                },
                {
                    question: 'بنقدم إيه؟',
                    answer: 'بنوفر حلول متكاملة في التركيبات والتجميل تشمل: Crowns، Bridges، Veneers، Implant Restorations، Surgical Guides، وFull-Mouth Rehabilitation.',
                },
                {
                    question: 'ازاي بنشتغل؟',
                    answer: 'بنستخدم أحدث تقنيات طب الأسنان الرقمية (Intraoral Scanning و CAD/CAM Design و Milling و 3D Printing) مع مراجعة كل margin وcontact وocclusion قبل التسليم.',
                },
                {
                    question: 'ليه تختار ORCA؟',
                    answer: 'لأننا بنؤمن إن "كل تفصيلة بتفرق". فهمنا لتحديات العيادة والمعمل في نفس الوقت بيخلينا نحافظ على تواصل واضح وجودة ثابتة على الـ chairside.',
                },
            ],
        },
        contact: {
            eyebrow: 'تواصل معانا',
            heading: 'جاهز ترفع مستوى شغلك في العيادة؟',
            subtitle:
                'تواصل معانا لمناقشة حالتك الجاية، طلب قائمة الأسعار، أو تسجيل عيادتك في بوابة الطبيب.',
            callLabel: 'اتصال / واتساب',
            emailLabel: 'البريد الإلكتروني',
            labLabel: 'المعمل',
            locationValue: 'القاهرة، مصر',
            formTitle: 'ابعتلنا رسالة',
            successMsg: '✅ تم إرسال رسالتك بنجاح! هنتواصل معاك قريب.',
            errorMsg: '❌ حصل خطأ أثناء الإرسال. جرب تاني أو كلمنا على واتساب.',
            doctorNameLabel: 'اسم الدكتور',
            doctorNamePlaceholder: 'د. محمد علي',
            clinicNameLabel: 'اسم العيادة',
            clinicNamePlaceholder: 'عيادة الأسنان',
            phoneLabel: 'رقم الموبايل',
            phonePlaceholder: '+20...',
            messageLabel: 'الرسالة',
            messagePlaceholder: 'حابب أبعت حالة ديجيتال…',
            sendingBtn: 'جاري الإرسال…',
            submitBtn: 'ابعت الرسالة — وهنرد عليك قريب',
            whatsappLabel: 'تواصل على واتساب',
            whatsappPrefill: 'أهلاً ORCA Dental Lab، حابب أستفسر عن إرسال حالة.',
        },
        footer: {
            brandDesc:
                'معمل ORCA Dental Lab متخصص في التركيبات الرقمية الدقيقة، وبيدعم العيادات بنظام CAD/CAM منظم ومتابعة لحظية من بوابة الطبيب.',
            quickLinks: 'روابط سريعة',
            contactTitle: 'بيانات التواصل',
            portalTitle: 'بوابة الطبيب',
            doctorLogin: 'دخول الطبيب',
            registerClinic: 'تسجيل عيادة جديدة',
            startCase: 'ابدأ حالة ←',
            rightsReserved: 'ORCA Dental Lab. جميع الحقوق محفوظة.',
            tagline: '✦ لمسة طبيب وراء كل تفصيلة',
        },
    },
};
