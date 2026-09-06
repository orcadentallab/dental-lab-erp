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

/**
 * Who may be CHOSEN as an order's representative.
 *
 * Deliberately separate from isRepresentativeUser, which answers a different
 * question -- who gets stamped as the representative automatically when they
 * create an order. The coordinator belongs in this list and not in that one:
 * they register cases on behalf of whoever owns the doctor, and they may be
 * the owner themselves, so they pick the name rather than have it assumed.
 * Stamping them automatically would attribute every case they typed in to
 * them.
 */
export function canBeOrderRepresentative(user: User | null | undefined): boolean {
    return Boolean(user && (isRepresentativeUser(user) || user.role === 'coordinator'));
}

export function canAccessDesignerFeatures(user: User | null | undefined): boolean {
    return Boolean(user && (user.role === 'admin' || user.role === 'production_manager' || isDesignerUser(user)));
}

export function getEffectiveRoleLabels(user: User | null | undefined): string[] {
    if (!user) return [];

    const labels: string[] = [];

    if (user.role === 'admin') labels.push('مدير نظام');
    if (user.role === 'lab') labels.push('معمل خارجي');
    if (user.role === 'technician') labels.push('فني');
    if (user.role === 'production_manager') labels.push('مدير إنتاج');
    if (user.role === 'coordinator') labels.push('منسق عام');
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
    /** The directory area itself: the union of the three lists above. */
    | 'view_directory'
    | 'view_reports'
    /** Capacity, bottlenecks and supplier lead times -- the production
     *  manager's planning view. Split out of view_reports because that one
     *  also opens /analytics and the financial reports, which section 4.2
     *  deliberately keeps away from the floor. */
    | 'view_production_reports'
    | 'manage_services'
    | 'manage_users'
    | 'view_settings'
    | 'view_inventory'
    | 'manage_inventory'
    | 'view_shipments'
    | 'manage_shipments'
    | 'doctor_portal'
    | 'self_profile_only';

/** Every user whose whole application is a single financial profile page. */
export function isOtherEmployeeOnly(user: User | null | undefined): boolean {
    return Boolean(
        user?.employeeType === 'other' &&
        !['lab', 'technician', 'production_manager', 'designer', 'doctor'].includes(user.role)
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
    // 'lab' has left the floor. It was standing in for the production manager
    // -- the database said so in as many words (20260821006000: "'lab' is the
    // production manager") -- while the UI labelled it "external lab". The
    // two are now separate roles and only one of them is on the floor.
    const isFloor = role === 'production_manager' || role === 'technician';
    const isDesigner = isDesignerUser(user);
    // The coordinator is the accountant's scope plus the representative's.
    // Written as a union of the two existing conditions rather than as its
    // own capability list, so it cannot drift out of step with either.
    const isCoordinator = role === 'coordinator';
    const hasAccountantScope = role === 'accountant' || isCoordinator;
    const hasRepScope = role === 'representative' || isCoordinator;

    // 'lab' is an external supplier with no part in running the place. It
    // keeps exactly the four screens its own row-scoped policies still feed
    // -- its orders, its statement, its profile -- and nothing else. This is
    // narrower than before step 3 and wider than nothing on purpose: the six
    // accounts are switched off one at a time from the Users screen, and
    // until that happens they should meet a coherent app rather than a set
    // of empty pages.
    const isExternalLab = role === 'lab';

    if (isAdmin || isFloor || isDesigner || hasRepScope || hasAccountantScope || isExternalLab) {
        caps.add('view_dashboard');
        caps.add('view_orders');
        caps.add('view_accounts');
    }
    // The floor board and the shadow report are a supervisory view; the
    // designer only ever gets the shared task queue. Route guards in
    // App.tsx already draw that line, so the capabilities must too.
    // The coordinator reads the board -- knowing where a case is, is the job
    // -- but never moves a stage run. That separation is enforced in the
    // database by can_work_production(); this only matches it in the UI.
    if (isAdmin || isFloor || isCoordinator) caps.add('view_production');
    if (isAdmin || isFloor || isDesigner) caps.add('view_my_tasks');
    if (isAdmin || isFloor || hasAccountantScope) {
        caps.add('view_external_work');
        caps.add('view_inventory');
        caps.add('view_shipments');
        // Decision 4: shipping is shared between the production manager and
        // the coordinator, so that a courier hand-off never waits on one
        // person being at their desk.
        caps.add('manage_shipments');
    }
    if (isAdmin || hasAccountantScope) {
        caps.add('manage_inventory');
    }
    if (isAdmin || hasRepScope) caps.add('view_doctors');
    // The directory is the rep's working tool; retention is not. It reads
    // the whole client base's activity and the follow-up log -- who went
    // quiet, who is worth chasing -- which is a management decision, so
    // the tab and its route are admin-only.
    if (isAdmin) caps.add('view_doctor_retention');
    if (isAdmin || hasAccountantScope) {
        caps.add('view_finance');
        caps.add('view_suppliers');
    }
    if (isAdmin || hasAccountantScope || hasRepScope) caps.add('view_staff');
    // No role owns the whole address book -- the rep has doctors and staff,
    // the accountant staff and suppliers -- so the area opens on the union
    // rather than on a fourth grant nobody would remember to keep in sync.
    if (caps.has('view_doctors') || caps.has('view_suppliers') || caps.has('view_staff')) {
        caps.add('view_directory');
    }
    if (isAdmin) {
        caps.add('view_reports');
        caps.add('manage_services');
        caps.add('manage_users');
    }
    // Decision 2: the production manager edits production routes. Nobody
    // else new does -- the coordinator relays work, it does not design it.
    if (isAdmin || role === 'production_manager') caps.add('manage_production_routes');
    // Section 4.2: capacity, bottlenecks and supplier lead times are how a
    // production manager plans a week. The financial reports stay out of
    // reach, which is why this is its own capability and not view_reports.
    if (isAdmin || role === 'production_manager') caps.add('view_production_reports');
    // The designer is the one role with no settings page.
    if (isAdmin || isFloor || hasRepScope || hasAccountantScope || isExternalLab) caps.add('view_settings');

    return caps;
}

export function hasCapability(user: User | null | undefined, capability: Capability): boolean {
    return getCapabilities(user).has(capability);
}
