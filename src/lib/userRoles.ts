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
    if (user.role === 'technician') labels.push('فني');
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

/* ------------------------------------------------------------------ *
 * Capabilities
 *
 * Navigation must not branch on `user.role`. Two rules make the role
 * field a lie on its own: a non-designer can carry the
 * `secondary_designer` permission, and an admin whose username is not
 * literally `admin` counts as a representative. Both are folded in here
 * so every consumer asks one question instead of re-deriving the rules.
 *
 * The technician is deliberately a near-copy of `lab`: the floor is one
 * technician per stage, and hiding the rest of the operation from them
 * would cost more than it protects.
 * ------------------------------------------------------------------ */

export type Capability =
    | 'view_dashboard'
    | 'view_orders'
    | 'view_production'
    | 'view_my_tasks'
    | 'manage_production_routes'
    | 'view_finance'
    | 'view_accounts'
    | 'view_external_work'
    | 'view_doctors'
    | 'view_doctor_retention'
    | 'view_suppliers'
    | 'view_staff'
    | 'view_reports'
    | 'manage_services'
    | 'manage_users'
    | 'view_settings'
    | 'doctor_portal'
    | 'self_profile_only';

/** Every user whose whole application is a single financial profile page. */
export function isOtherEmployeeOnly(user: User | null | undefined): boolean {
    return Boolean(
        user?.employeeType === 'other' &&
        !['lab', 'technician', 'designer', 'doctor'].includes(user.role)
    );
}

export function getCapabilities(user: User | null | undefined): Set<Capability> {
    const caps = new Set<Capability>();
    if (!user) return caps;

    if (isOtherEmployeeOnly(user)) {
        caps.add('self_profile_only');
        caps.add('view_settings');
        return caps;
    }

    if (user.role === 'doctor') {
        caps.add('doctor_portal');
        return caps;
    }

    const role = user.role;
    const isAdmin = role === 'admin';
    const isFloor = role === 'lab' || role === 'technician';
    const isDesigner = isDesignerUser(user);

    if (isAdmin || isFloor || isDesigner || role === 'representative' || role === 'accountant') {
        caps.add('view_dashboard');
        caps.add('view_orders');
        caps.add('view_accounts');
    }
    // The floor board and the shadow report are a supervisory view; the
    // designer only ever gets the shared task queue. Route guards in
    // App.tsx already draw that line, so the capabilities must too.
    if (isAdmin || isFloor) caps.add('view_production');
    if (isAdmin || isFloor || isDesigner) caps.add('view_my_tasks');
    if (isAdmin || isFloor || role === 'accountant') caps.add('view_external_work');
    if (isAdmin || role === 'representative') caps.add('view_doctors');
    // The directory is the rep's working tool; retention is not. It reads
    // the whole client base's activity and the follow-up log -- who went
    // quiet, who is worth chasing -- which is a management decision, so
    // the tab and its route are admin-only.
    if (isAdmin) caps.add('view_doctor_retention');
    if (isAdmin || role === 'accountant') {
        caps.add('view_finance');
        caps.add('view_suppliers');
    }
    if (isAdmin || role === 'accountant' || role === 'representative') caps.add('view_staff');
    if (isAdmin) {
        caps.add('view_reports');
        caps.add('manage_services');
        caps.add('manage_users');
        caps.add('manage_production_routes');
    }
    // The designer is the one role with no settings page.
    if (isAdmin || isFloor || role === 'representative' || role === 'accountant') caps.add('view_settings');

    return caps;
}

export function hasCapability(user: User | null | undefined, capability: Capability): boolean {
    return getCapabilities(user).has(capability);
}
