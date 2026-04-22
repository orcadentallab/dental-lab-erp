import type { User } from '../services/db';

export const DUAL_ROLE_DESIGNER_PERMISSION = 'secondary_designer';
export const FIXED_SALARY_DESIGNER_PERMISSION = 'designer_fixed_salary';

export function hasCustomPermission(user: User | null | undefined, permission: string): boolean {
    return Boolean(user?.customPermissions?.[permission]);
}

export function isDesignerUser(user: User | null | undefined): boolean {
    return Boolean(user && (user.role === 'designer' || hasCustomPermission(user, DUAL_ROLE_DESIGNER_PERMISSION)));
}

export function isRepresentativeUser(user: User | null | undefined): boolean {
    return Boolean(user && (user.role === 'representative' || (user.role === 'admin' && user.username !== 'admin')));
}

export function canAccessDesignerFeatures(user: User | null | undefined): boolean {
    return Boolean(user && (user.role === 'admin' || user.role === 'lab' || isDesignerUser(user)));
}

export function getEffectiveRoleLabels(user: User | null | undefined): string[] {
    if (!user) return [];

    const labels: string[] = [];

    if (user.role === 'admin') labels.push('مدير نظام');
    if (user.role === 'lab') labels.push('معمل خارجي');
    if (user.role === 'representative') labels.push('مندوب');
    if (user.role === 'accountant') labels.push('محاسب');
    if (user.role === 'designer') labels.push('مصمم');
    if (user.role === 'doctor') labels.push('طبيب');

    if (user.role !== 'designer' && hasCustomPermission(user, DUAL_ROLE_DESIGNER_PERMISSION)) {
        labels.push('مصمم');
    }

    return labels;
}

export function getUserRoleDisplay(user: User | null | undefined): string {
    return getEffectiveRoleLabels(user).join(' + ');
}
