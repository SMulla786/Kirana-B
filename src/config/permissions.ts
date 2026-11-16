import {MembershipRole} from '@prisma/client';

/** Every action the API authorizes. Routes check these, never role names. */
export const PERMISSIONS = [
    'business.read',
    'business.update',
    'members.read',
    'members.manage',
    'catalog.read',
    'catalog.manage',
    'stock.manage',
    'pos.use',
    'customers.manage',
    'purchases.manage',
    'reports.view',
    'finance.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
    OWNER: ALL,
    MANAGER: ALL.filter((p) => p !== 'business.update'),
    CASHIER: ['business.read', 'pos.use', 'catalog.read', 'customers.manage'],
    INVENTORY_MANAGER: [
        'business.read',
        'catalog.read',
        'catalog.manage',
        'stock.manage',
        'purchases.manage',
    ],
    ACCOUNTANT: ['business.read', 'members.read', 'catalog.read', 'reports.view', 'finance.view'],
    STAFF: ['business.read', 'catalog.read'],
};

export const hasPermission = (role: MembershipRole | null | undefined, permission: Permission) =>
    !!role && ROLE_PERMISSIONS[role].includes(permission);

/** Which membership roles an actor may grant or change. Nobody grants OWNER through the API. */
export const canAssignRole = (actor: MembershipRole, target: MembershipRole) => {
    if (target === MembershipRole.OWNER) return false;
    if (actor === MembershipRole.OWNER) return true;
    return actor === MembershipRole.MANAGER && target !== MembershipRole.MANAGER;
};
