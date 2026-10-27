export const DOCTOR_CODE_REGIONS = [
    { value: 'cairo', label: 'القاهرة', prefix: 1 },
    { value: 'east_cairo', label: 'العاشر من رمضان / العبور / الشروق', prefix: 2 },
    { value: 'west_giza', label: 'أكتوبر / الشيخ زايد', prefix: 3 },
    { value: 'damietta', label: 'دمياط', prefix: 5 },
    { value: 'other', label: 'منطقة أخرى', prefix: 6 },
] as const;

export type DoctorCodeRegion = typeof DOCTOR_CODE_REGIONS[number]['value'];

export function normalizeDoctorName(value: string): string {
    let name = value.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').trim();
    const prefix = /^(?:(?:الدكتور|الدكتورة|الدكتوره|دكتور|دكتورة|دكتوره)\s+|د\s*[./]\s*|د\s+)/;
    while (prefix.test(name)) name = name.replace(prefix, '').trim();
    return name.replace(/\s+/g, ' ');
}

export function isArabicDoctorName(value: string): boolean {
    return /^[ء-ي]+(?: [ء-ي]+)+$/.test(normalizeDoctorName(value));
}

export function inferDoctorCodeRegion(code: string): DoctorCodeRegion | undefined {
    if (!/^[12356]\d{3}(?:-\d+)?$/.test(code)) return undefined;
    return DOCTOR_CODE_REGIONS.find(region => region.prefix === Number(code[0]))?.value;
}
