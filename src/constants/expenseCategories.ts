export const EXPENSE_CATEGORY = {
    salaries: 'مرتبات وأجور',
    shipping: 'شحن وتوصيل',
    transport: 'انتقالات ووقود',
    marketing: 'دعاية وتسويق',
    hospitality: 'ضيافة واجتماعات',
    materials: 'خامات ومستهلكات',
    bankFees: 'عمولات ورسوم بنكية',
    rentUtilities: 'إيجارات ومرافق',
    maintenance: 'صيانة وإصلاحات',
    other: 'مصروفات أخرى',
} as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORY[keyof typeof EXPENSE_CATEGORY];

export const ALL_EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
    EXPENSE_CATEGORY.salaries,
    EXPENSE_CATEGORY.shipping,
    EXPENSE_CATEGORY.transport,
    EXPENSE_CATEGORY.marketing,
    EXPENSE_CATEGORY.hospitality,
    EXPENSE_CATEGORY.materials,
    EXPENSE_CATEGORY.bankFees,
    EXPENSE_CATEGORY.rentUtilities,
    EXPENSE_CATEGORY.maintenance,
    EXPENSE_CATEGORY.other,
];

export const EMPLOYEE_EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
    EXPENSE_CATEGORY.shipping,
    EXPENSE_CATEGORY.transport,
    EXPENSE_CATEGORY.hospitality,
    EXPENSE_CATEGORY.materials,
    EXPENSE_CATEGORY.other,
];

const normalizeArabic = (text: string): string => text.trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase();

const CATEGORY_ALIASES: ReadonlyArray<readonly [string, ExpenseCategory]> = [
    ['salaries', EXPENSE_CATEGORY.salaries],
    ['مرتبات واجور', EXPENSE_CATEGORY.salaries],
    ['shipping', EXPENSE_CATEGORY.shipping],
    ['انتقالات', EXPENSE_CATEGORY.transport],
    ['وقود', EXPENSE_CATEGORY.transport],
    ['بنزين', EXPENSE_CATEGORY.transport],
    ['marketing', EXPENSE_CATEGORY.marketing],
    ['advertising', EXPENSE_CATEGORY.marketing],
    ['دعايا وسوشيال ميديا', EXPENSE_CATEGORY.marketing],
    ['دعايه وسوشيال ميديا', EXPENSE_CATEGORY.marketing],
    ['دعاية وسوشيال ميديا', EXPENSE_CATEGORY.marketing],
    ['meetings', EXPENSE_CATEGORY.hospitality],
    ['اجتماعات ونثريات', EXPENSE_CATEGORY.hospitality],
    ['بوفيه وضيافة', EXPENSE_CATEGORY.hospitality],
    ['material', EXPENSE_CATEGORY.materials],
    ['أدوات ومهمات', EXPENSE_CATEGORY.materials],
    ['ادوات ومهمات', EXPENSE_CATEGORY.materials],
    ['transfer_fee', EXPENSE_CATEGORY.bankFees],
    ['bank_fees', EXPENSE_CATEGORY.bankFees],
    ['other', EXPENSE_CATEGORY.other],
    ['أخرى', EXPENSE_CATEGORY.other],
];

const CATEGORY_BY_NORMALIZED_NAME = new Map<string, ExpenseCategory>();
ALL_EXPENSE_CATEGORIES.forEach(category => CATEGORY_BY_NORMALIZED_NAME.set(normalizeArabic(category), category));
CATEGORY_ALIASES.forEach(([alias, category]) => CATEGORY_BY_NORMALIZED_NAME.set(normalizeArabic(alias), category));

export function normalizeExpenseCategory(category?: string | null): ExpenseCategory {
    if (!category) return EXPENSE_CATEGORY.other;
    return CATEGORY_BY_NORMALIZED_NAME.get(normalizeArabic(category)) || EXPENSE_CATEGORY.other;
}

export function isCanonicalExpenseCategory(category?: string | null): category is ExpenseCategory {
    return !!category && ALL_EXPENSE_CATEGORIES.includes(category as ExpenseCategory);
}
