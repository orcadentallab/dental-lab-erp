/**
 * Editable marketing content for ORCA Dental Lab.
 *
 * Owner guide:
 * - Fill in any `TODO` fields below when verified data is ready.
 * - Empty arrays or `null` / empty string fields are automatically hidden on the page
 *   so no placeholder or unverified claims are shown to dentists.
 */

export interface TestimonialItem {
    name: string;
    title: string;
    clinic: string;
    quote: string;
    photo?: string;
}

export interface StatNumberItem {
    value: string;
    label: string;
    labelAr?: string;
}

export interface TeamMemberItem {
    name: string;
    role: string;
    photo?: string;
}

export interface ExperienceData {
    // TODO: Set years in business (e.g., "5+ years") when ready to publish
    yearsInBusiness: string | null;
    // TODO: Add verified team roles (e.g., ["Prosthodontists", "CAD/CAM Designers", "Ceramists"])
    teamRoles: string[];
    // TODO: Add verified technologies and materials used (e.g., ["Multilayer Zirconia", "E.max CAD / Press", "Printed PMMA", "3D Surgical Guides"])
    technologiesAndMaterials: string[];
    // TODO: Add workflow summary if using design-first + partner production labs
    workflowNote: string | null;
}

export interface CasePhotoEntry {
    src: string;
    alt: string;
    caption: string;
    large?: boolean;
}

export interface PortfolioCaseEntry {
    title: string;
    titleAr: string;
    category: string;
    categoryAr: string;
    description: string;
    descriptionAr: string;
    images: CasePhotoEntry[];
    layout?: 'default' | 'side-stack' | 'reverse-side-stack';
}

/**
 * Returns a prefilled WhatsApp URL using VITE_LAB_WHATSAPP_NUMBER,
 * or null when the environment variable is not configured.
 */
export function getWhatsAppUrl(prefilledMessage: string): string | null {
    const raw = import.meta.env.VITE_LAB_WHATSAPP_NUMBER as string | undefined;
    const digits = (raw ?? '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(prefilledMessage)}`;
}

/**
 * Portal routes on this branch.
 * /login is the doctor portal entry; ?intent=new pre-selects new clinic registration.
 */
export const PORTAL_LOGIN_PATH = '/login';
export const PORTAL_REGISTER_PATH = '/login?intent=new';

// TODO: Add named dentist testimonials when available. Leave empty to hide the block.
export const testimonials: TestimonialItem[] = [];

// TODO: Add verified lab metrics (cases delivered, doctors served, average turnaround, remake rate) when ready. Leave empty to hide.
export const labNumbers: StatNumberItem[] = [];

// TODO: Add team members (name, role, photo) when photos and bios are ready. Leave empty to hide.
export const teamMembers: TeamMemberItem[] = [];

// TODO: Fill in experience fields below. Only filled fields render on the page.
export const experienceData: ExperienceData = {
    yearsInBusiness: null, // TODO: e.g. "6+ years"
    teamRoles: [], // TODO: e.g. ["Dentists & Clinical Supervisors", "CAD/CAM Designers", "Ceramic Specialists"]
    technologiesAndMaterials: [], // TODO: e.g. ["Multilayer Zirconia", "E.max CAD & Press", "3D-Printed PMMA", "Implant Titanium Frameworks"]
    workflowNote: null, // TODO: e.g. "Design-first digital workflow with partner production labs"
};

export interface RemakePolicyContent {
    titleEn: string;
    titleAr: string;
    bodyEn: string;
    bodyAr: string;
}

export const remakePolicy: RemakePolicyContent = {
    titleEn: 'Quality Control & Remake Policy',
    titleAr: 'سياسة الجودة والـ Remake',
    bodyEn:
        'Every restoration passes margin, occlusion, contact, and shade verification against your scan or impression before dispatch. If a clinical fit or margin issue arises that traces back to lab design or fabrication, we remake the case at no additional lab fee after reviewing the clinical feedback.',
    bodyAr:
        'كل حالة بتعدي على فحص دقيق للـ margin والـ occlusion والـ contact والـ shade مقارنة بالـ scan أو الطبعة قبل التسليم. لو حصلت أي مشكلة في الـ fit أو الـ margin بسبب التصميم أو التصنيع في المعمل، بنعيد الحالة بدون تكلفة إضافية بعد مراجعة الملاحظات الإكلينيكية مع الطبيب.',
};

export interface CaseJourneyStep {
    step: string;
    titleEn: string;
    titleAr: string;
    descEn: string;
    descAr: string;
}

export const caseJourneySteps: CaseJourneyStep[] = [
    {
        step: '01',
        titleEn: 'Send case or scan',
        titleAr: 'ابعت الحالة أو الـ Scan',
        descEn: 'Submit your digital STL/PLY scan or request an on-site clinic scan through the portal or WhatsApp.',
        descAr: 'ارفع ملف الـ STL/PLY أو اطلب فحص بالـ intraoral scanner في عيادتك عن طريق البوابة أو واتساب.',
    },
    {
        step: '02',
        titleEn: 'Digital design',
        titleAr: 'التصميم الرقمي (CAD)',
        descEn: 'Our clinical team reviews margins, occlusion, and smile proportions in CAD before milling or printing.',
        descAr: 'فريقنا الإكلينيكي بيراجع الـ margins والـ occlusion وتناسق الابتسامة على برامج الـ CAD قبل التصنيع.',
    },
    {
        step: '03',
        titleEn: 'Production and QC',
        titleAr: 'التصنيع ومراقبة الجودة',
        descEn: 'Precision milling or 3D printing followed by layering, glazing, and multi-point quality inspection.',
        descAr: 'تصنيع دقيق بالـ milling أو الـ 3D printing مع الفينيش والـ QC الشامل قبل ما الحالة تخرج من المعمل.',
    },
    {
        step: '04',
        titleEn: 'Delivery to your clinic',
        titleAr: 'التسليم للعيادة',
        descEn: 'Tracked dispatch straight to your clinic with full case status visibility inside the doctor portal.',
        descAr: 'توصيل مباشر للعيادة مع متابعة لحظية لحالة الأوردر من جوا بوابة الطبيب.',
    },
];

// Portfolio case entries: add a new image by adding one object to `images` or `moreCases`.
export const portfolioCases: PortfolioCaseEntry[] = [
    {
        title: 'Multi-Layer Zirconia — Anterior Rehabilitation',
        titleAr: 'تركيبات Zirconia متعددة الطبقات — تأهيل أمامي',
        category: 'Multi-layer Zirconia',
        categoryAr: 'Zirconia متعدد الطبقات',
        description:
            'Multi-layer zirconia anterior rehabilitation with natural cervical-to-incisal translucency gradation and individualized surface characterization.',
        descriptionAr:
            'تأهيل للأسنان الأمامية بـ Multi-layer Zirconia مع تدرج طبيعي للـ translucency من الـ cervical للـ incisal وتفاصيل سطحية دقيقة.',
        images: [
            {
                src: '/marketing/Zr Multi/Before.webp',
                alt: 'Multi-layer zirconia anterior case — pre-operative clinical view',
                caption: 'Multi-layer zirconia anterior — Before',
                large: true,
            },
            {
                src: '/marketing/Zr Multi/556929803_10241330631106077_4098193000564997894_n.webp',
                alt: 'Multi-layer zirconia anterior crowns — final clinical result',
                caption: 'Multi-layer zirconia anterior — Final result',
                large: true,
            },
            {
                src: '/marketing/Zr Multi/cast.webp',
                alt: 'Multi-layer zirconia anterior case — 3D printed working model',
                caption: 'Zirconia crowns — Working cast',
            },
            {
                src: '/marketing/Zr Multi/556854355_10241330626025950_5375520214538015687_n.webp',
                alt: 'Multi-layer zirconia anterior crowns — lateral angle',
                caption: 'Zirconia crowns — Lateral view',
            },
            {
                src: '/marketing/Zr Multi/558880201_10241330637466236_7179418825091317744_n (1).webp',
                alt: 'Multi-layer zirconia anterior crowns — close-up texture detail',
                caption: 'Zirconia crowns — Surface detail',
            },
        ],
    },
    {
        title: 'E.max Veneers — Smile Makeover',
        titleAr: 'فينيرز E.max — تصميم ابتسامة',
        category: 'Esthetic Veneers',
        categoryAr: 'Veneers تجميلية',
        description:
            'Ultra-thin E.max veneers crafted for an anterior smile makeover, balancing conservative preparation with natural light transmission.',
        descriptionAr:
            'فينيرز E.max فائقة الدقة لتصميم الابتسامة الأمامية مع الحفاظ على أقل تحضير ممكن وشفافية ضوئية طبيعية.',
        images: [
            {
                src: '/marketing/Case Venners/Case Venner1.webp',
                alt: 'E.max anterior veneers — frontal smile view',
                caption: 'E.max veneers — Frontal smile view',
                large: true,
            },
            {
                src: '/marketing/Case Venners/Case Venner2.webp',
                alt: 'E.max anterior veneers — close-up intraoral view',
                caption: 'E.max veneers — Intraoral view',
                large: true,
            },
        ],
    },
    {
        title: 'E.max Veneers — Precision Layering',
        titleAr: 'فينيرز E.max — طبقات وتلوين يدوي',
        category: 'E.max Veneers',
        categoryAr: 'E.max Veneers',
        description:
            'Pressed E.max veneers with detailed layering and staining guided by digital smile design.',
        descriptionAr:
            'فينيرز E.max Press مع layering وstaining دقيق مبني على الـ Digital Smile Design.',
        layout: 'side-stack',
        images: [
            {
                src: '/marketing/Emax Venners/main.webp',
                alt: 'Pressed E.max veneers — final smile transformation',
                caption: 'Pressed E.max veneers — Final result',
                large: true,
            },
            {
                src: '/marketing/Emax Venners/Before.webp',
                alt: 'Pressed E.max veneers — pre-operative view',
                caption: 'Pressed E.max veneers — Before',
            },
            {
                src: '/marketing/Emax Venners/WhatsApp Image 2026-02-20 at 10.59.09 PM].webp',
                alt: 'Pressed E.max veneers — lateral clinical view',
                caption: 'Pressed E.max veneers — Lateral view',
            },
        ],
    },
    {
        title: 'Full-Arch Implant Rehabilitation',
        titleAr: 'تأهيل الفك الكامل على زرعات (Full-Arch Implant)',
        category: 'Implant Prosthetics',
        categoryAr: 'تركيبات الزرعات',
        description:
            'Full-arch implant-supported prosthesis delivering functional occlusion and a balanced smile line.',
        descriptionAr:
            'تركيبة كاملة مدعومة بالزرعات (Full-Arch Implant) لتحقيق إطباق وظيفي سليم وخط ابتسامة متناسق.',
        layout: 'side-stack',
        images: [
            {
                src: '/marketing/Case Full Arch/full arch3.webp',
                alt: 'Full-arch implant-supported zirconia prosthesis — final view',
                caption: 'Full-arch implant prosthesis — Final view',
                large: true,
            },
            {
                src: '/marketing/Case Full Arch/full arch.webp',
                alt: 'Full-arch implant rehabilitation — occlusal and framework view',
                caption: 'Full-arch implant — Framework & occlusion',
            },
            {
                src: '/marketing/Case Full Arch/full arch2.webp',
                alt: 'Full-arch implant rehabilitation — buccal profile',
                caption: 'Full-arch implant — Buccal profile',
            },
        ],
    },
    {
        title: 'Anterior Crowns — Six-Unit Rehabilitation',
        titleAr: 'تيجان أمامية — تأهيل 6 وحدات',
        category: 'Crown Rehabilitation',
        categoryAr: 'تيجان تجميلية',
        description:
            'Six-unit anterior crown rehabilitation with shade matching, surface anatomy, and natural translucency.',
        descriptionAr:
            'تأهيل 6 أسنان أمامية مع تطابق دقيق للـ shade وتشريح سطحي وشفافية طبيعية.',
        images: [
            {
                src: '/marketing/Case Crowns Esthatic/Before.webp',
                alt: 'Six-unit anterior crowns — pre-operative view',
                caption: 'Six-unit anterior crowns — Before',
                large: true,
            },
            {
                src: '/marketing/Case Crowns Esthatic/face.webp',
                alt: 'Six-unit anterior crowns — final facial smile result',
                caption: 'Six-unit anterior crowns — Final result',
                large: true,
            },
            {
                src: '/marketing/Case Crowns Esthatic/Design.webp',
                alt: 'Six-unit anterior crowns — CAD digital design preview',
                caption: 'Six-unit anterior crowns — Digital design',
            },
            {
                src: '/marketing/Case Crowns Esthatic/Front.webp',
                alt: 'Six-unit anterior crowns — retracted frontal view',
                caption: 'Six-unit anterior crowns — Frontal view',
            },
            {
                src: '/marketing/Case Crowns Esthatic/angle.webp',
                alt: 'Six-unit anterior crowns — three-quarter angle view',
                caption: 'Six-unit anterior crowns — Angle view',
            },
            {
                src: '/marketing/Case Crowns Esthatic/back.webp',
                alt: 'Six-unit anterior crowns — palatal aspect',
                caption: 'Six-unit anterior crowns — Palatal view',
            },
        ],
    },
    {
        title: 'Anterior Crowns — Natural Integration',
        titleAr: 'تيجان أمامية — اندماج طبيعي مع الأسنان المجاورة',
        category: 'Anterior Crowns',
        categoryAr: 'تيجان أمامية',
        description:
            'Anterior crown restorations matched to adjacent natural dentition for proportion, anatomy, and gingival harmony.',
        descriptionAr:
            'تيجان أمامية مصممة للاندماج الطبيعي مع الأسنان المجاورة في النسب والتشريح وتناغم اللثة.',
        images: [
            {
                src: '/marketing/Crowns anterior/before.webp',
                alt: 'Anterior crowns — pre-operative preparation view',
                caption: 'Anterior crowns — Before',
                large: true,
            },
            {
                src: '/marketing/Crowns anterior/WhatsApp Image 2026-01-22 at 4.03.46 PM.webp',
                alt: 'Anterior crowns — final seated result view 1',
                caption: 'Anterior crowns — Final result',
                large: true,
            },
            {
                src: '/marketing/Crowns anterior/WhatsApp Image 2026-01-22 at 4.03.47 PM.webp',
                alt: 'Anterior crowns — final seated result view 2',
                caption: 'Anterior crowns — Close-up shade match',
                large: true,
            },
        ],
    },
];

export const moreCases: CasePhotoEntry[] = [
    {
        src: '/marketing/Case Esthatic/WhatsApp Image 2026-02-20 at 10.56.23 PM.webp',
        alt: 'Anterior esthetic ceramic restoration — smile view',
        caption: 'Anterior ceramic — Esthetic case',
    },
    {
        src: '/marketing/Case Esthatic/WhatsApp Image 2026-02-20 at 10.5623 PM.webp',
        alt: 'Anterior esthetic ceramic restoration — close-up',
        caption: 'Anterior ceramic — Detail view',
    },
    {
        src: '/marketing/Case Zirconia Crowns/zirconia.webp',
        alt: 'Monolithic and layered zirconia crowns on working model',
        caption: 'Zirconia crowns — Model check',
    },
    {
        src: '/marketing/zirconia in implant.webp',
        alt: 'Screw-retained zirconia crown on dental implant',
        caption: 'Zirconia crown on implant',
    },
    {
        src: '/marketing/Case Endocrown/endocrown.webp',
        alt: 'Posterior ceramic endocrown restoration on working cast',
        caption: 'Posterior ceramic endocrown',
    },
];
