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
        title: 'Multi-Layer Zirconia Anterior Crowns',
        titleAr: 'تيجان زيركونيا متعددة الطبقات للأسنان الأمامية',
        category: 'Multi-Layer Zirconia',
        categoryAr: 'زيركونيا متعددة الطبقات',
        description:
            'Six-unit maxillary anterior multi-layer zirconia crowns with natural cervical-to-incisal translucency gradation and individualized surface characterization.',
        descriptionAr:
            'ست تيجان أمامية علوية من الزيركونيا متعددة الطبقات مع تدرج طبيعي للشفافية من العنق إلى الحافة القاطعة وتفاصيل سطحية دقيقة.',
        images: [
            {
                src: '/marketing/Zr Multi/Before.webp',
                alt: 'Multi-Layer Zirconia Anterior Crowns — Before',
                caption: 'Multi-Layer Zirconia Anterior Crowns — Before',
                large: true,
            },
            {
                src: '/marketing/Zr Multi/556929803_10241330631106077_4098193000564997894_n.webp',
                alt: 'Multi-Layer Zirconia Anterior Crowns — Final Result',
                caption: 'Multi-Layer Zirconia Anterior Crowns — Final Result',
                large: true,
            },
            {
                src: '/marketing/Zr Multi/cast.webp',
                alt: 'Multi-Layer Zirconia Anterior Crowns — Working Cast',
                caption: 'Multi-Layer Zirconia Anterior Crowns — Working Cast',
            },
            {
                src: '/marketing/Zr Multi/556854355_10241330626025950_5375520214538015687_n.webp',
                alt: 'Multi-Layer Zirconia Anterior Crowns — Incisal Translucency',
                caption: 'Multi-Layer Zirconia Anterior Crowns — Incisal Translucency',
            },
            {
                src: '/marketing/Zr Multi/558880201_10241330637466236_7179418825091317744_n (1).webp',
                alt: 'Multi-Layer Zirconia Anterior Crowns — Surface Characterization',
                caption: 'Multi-Layer Zirconia Anterior Crowns — Surface Characterization',
            },
        ],
    },
    {
        title: 'Anterior E.max Veneers',
        titleAr: 'فينيرز E.max للأسنان الأمامية',
        category: 'Esthetic Veneers',
        categoryAr: 'فينيرز تجميلية',
        description:
            'Conservative anterior E.max veneers restoring tooth proportions, surface luster, and natural light transmission.',
        descriptionAr:
            'فينيرز E.max أمامية بتحضير محافظ لاستعادة تناسب الأسنان ولمعان السطح والشفافية الضوئية الطبيعية.',
        images: [
            {
                src: '/marketing/Case Venners/Case Venner1.webp',
                alt: 'Anterior E.max Veneers — Bonding Progression',
                caption: 'Anterior E.max Veneers — Bonding Progression',
                large: true,
            },
            {
                src: '/marketing/Case Venners/Case Venner2.webp',
                alt: 'Anterior E.max Veneers — Before and After',
                caption: 'Anterior E.max Veneers — Before and After',
                large: true,
            },
        ],
    },
    {
        title: 'Pressed E.max Anterior Veneers',
        titleAr: 'فينيرز E.max Press للأسنان الأمامية',
        category: 'E.max Veneers',
        categoryAr: 'فينيرز E.max',
        description:
            'Pressed E.max anterior veneers with individualized layering and staining for natural esthetics.',
        descriptionAr:
            'فينيرز E.max Press أمامية بطبقات وتلوين يدوي دقيق لتحقيق مظهر جمالي طبيعي.',
        layout: 'side-stack',
        images: [
            {
                src: '/marketing/Emax Venners/main.webp',
                alt: 'Pressed E.max Anterior Veneers — Final Result',
                caption: 'Pressed E.max Anterior Veneers — Final Result',
                large: true,
            },
            {
                src: '/marketing/Emax Venners/Before.webp',
                alt: 'Pressed E.max Anterior Veneers — Before',
                caption: 'Pressed E.max Anterior Veneers — Before',
            },
            {
                src: '/marketing/Emax Venners/WhatsApp Image 2026-02-20 at 10.59.09 PM].webp',
                alt: 'Pressed E.max Anterior Veneers — Seated Restoration',
                caption: 'Pressed E.max Anterior Veneers — Seated Restoration',
            },
        ],
    },
    {
        title: 'Full-Arch Implant Prosthesis',
        titleAr: 'تركيبة الفك الكامل المدعومة بالزرعات',
        category: 'Implant Prosthetics',
        categoryAr: 'تركيبات الزرعات',
        description:
            'Full-arch implant-supported prosthesis with gingival characterization, delivering functional occlusion and a balanced smile line.',
        descriptionAr:
            'تركيبة كاملة للفك العلوي مدعومة بالزرعات مع محاكاة اللثة، لتحقيق إطباق وظيفي سليم وخط ابتسامة متناسق.',
        layout: 'side-stack',
        images: [
            {
                src: '/marketing/Case Full Arch/full arch3.webp',
                alt: 'Full-Arch Implant Prosthesis — Final Result',
                caption: 'Full-Arch Implant Prosthesis — Final Result',
                large: true,
            },
            {
                src: '/marketing/Case Full Arch/full arch.webp',
                alt: 'Full-Arch Implant Prosthesis — Gingival Characterization',
                caption: 'Full-Arch Implant Prosthesis — Gingival Characterization',
            },
            {
                src: '/marketing/Case Full Arch/full arch2.webp',
                alt: 'Full-Arch Implant Prosthesis — Arch Contour',
                caption: 'Full-Arch Implant Prosthesis — Arch Contour',
            },
        ],
    },
    {
        title: 'Six-Unit Anterior Crown and Bridge',
        titleAr: 'تيجان وجسر أمامي من ست وحدات',
        category: 'Anterior Restorations',
        categoryAr: 'تركيبات أمامية',
        description:
            'Six-unit maxillary anterior crown and bridge rehabilitation restoring missing lateral incisor space, shade harmony, and surface anatomy.',
        descriptionAr:
            'تأهيل أمامي علوي من ست وحدات (تيجان وجسر) لتعويض الرباعية المفقودة وتحقيق تناغم اللون والتشريح السطحي.',
        images: [
            {
                src: '/marketing/Case Crowns Esthatic/Before.webp',
                alt: 'Six-Unit Anterior Crown and Bridge — Before',
                caption: 'Six-Unit Anterior Crown and Bridge — Before',
                large: true,
            },
            {
                src: '/marketing/Case Crowns Esthatic/face.webp',
                alt: 'Six-Unit Anterior Crown and Bridge — Final Result',
                caption: 'Six-Unit Anterior Crown and Bridge — Final Result',
                large: true,
            },
            {
                src: '/marketing/Case Crowns Esthatic/Design.webp',
                alt: 'Six-Unit Anterior Crown and Bridge — Digital Design',
                caption: 'Six-Unit Anterior Crown and Bridge — Digital Design',
            },
            {
                src: '/marketing/Case Crowns Esthatic/Front.webp',
                alt: 'Six-Unit Anterior Crown and Bridge — Seated Restoration',
                caption: 'Six-Unit Anterior Crown and Bridge — Seated Restoration',
            },
            {
                src: '/marketing/Case Crowns Esthatic/angle.webp',
                alt: 'Six-Unit Anterior Crown and Bridge — Shade Harmony',
                caption: 'Six-Unit Anterior Crown and Bridge — Shade Harmony',
            },
            {
                src: '/marketing/Case Crowns Esthatic/back.webp',
                alt: 'Six-Unit Anterior Crown and Bridge — Surface Anatomy',
                caption: 'Six-Unit Anterior Crown and Bridge — Surface Anatomy',
            },
        ],
    },
    {
        title: 'Maxillary Anterior Crowns',
        titleAr: 'تيجان الأسنان الأمامية العلوية',
        category: 'Anterior Crowns',
        categoryAr: 'تيجان أمامية',
        description:
            'Maxillary anterior crown restorations matched to adjacent natural dentition for proportion, anatomy, and gingival integration.',
        descriptionAr:
            'تيجان أمامية علوية متطابقة مع الأسنان المجاورة في النسب والتشريح وتناغم اللثة.',
        images: [
            {
                src: '/marketing/Crowns anterior/before.webp',
                alt: 'Maxillary Anterior Crowns — Before',
                caption: 'Maxillary Anterior Crowns — Before',
                large: true,
            },
            {
                src: '/marketing/Crowns anterior/WhatsApp Image 2026-01-22 at 4.03.46 PM.webp',
                alt: 'Maxillary Anterior Crowns — Final Result',
                caption: 'Maxillary Anterior Crowns — Final Result',
                large: true,
            },
            {
                src: '/marketing/Crowns anterior/WhatsApp Image 2026-01-22 at 4.03.47 PM.webp',
                alt: 'Maxillary Anterior Crowns — Shade Match',
                caption: 'Maxillary Anterior Crowns — Shade Match',
                large: true,
            },
        ],
    },
];

export const moreCases: CasePhotoEntry[] = [
    {
        src: '/marketing/Case Esthatic/WhatsApp Image 2026-02-20 at 10.56.23 PM.webp',
        alt: 'Anterior Ceramic Bridge — Prepared Abutments',
        caption: 'Anterior Ceramic Bridge — Prepared Abutments',
    },
    {
        src: '/marketing/Case Esthatic/WhatsApp Image 2026-02-20 at 10.5623 PM.webp',
        alt: 'Anterior Ceramic Bridge — Final Result',
        caption: 'Anterior Ceramic Bridge — Final Result',
    },
    {
        src: '/marketing/Case Zirconia Crowns/zirconia.webp',
        alt: 'Posterior Zirconia Crowns',
        caption: 'Posterior Zirconia Crowns',
    },
    {
        src: '/marketing/zirconia in implant.webp',
        alt: 'Screw-Retained Implant Zirconia Crowns',
        caption: 'Screw-Retained Implant Zirconia Crowns',
    },
    {
        src: '/marketing/Case Endocrown/endocrown.webp',
        alt: 'Posterior Ceramic Endocrown',
        caption: 'Posterior Ceramic Endocrown',
    },
];
