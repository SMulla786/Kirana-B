import {MembershipRole} from '@prisma/client';

/** Every action the API authorizes. Routes check these, never role names. */
export const PERMISSIONS = [
    'business.read',
    'business.update',
    'members.read',
    'members.manage',
    'catalog.read',
    'catalog.manage',
    'catalog.cost.view', // purchase cost and stock valuation
    'stock.manage',
    'pos.use',
    'pos.discount', // give a line discount
    'pos.price.override', // sell at a price other than the catalogue's
    'pos.credit', // complete a sale (part) on customer credit (udhaar)
    'sales.view', // sales history, invoice detail and reprint
    'sales.return', // record a sales return and refund
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
    CASHIER: ['business.read', 'pos.use', 'catalog.read', 'customers.manage', 'sales.view'],
    INVENTORY_MANAGER: [
        'business.read',
        'catalog.read',
        'catalog.manage',
        'catalog.cost.view',
        'stock.manage',
        'purchases.manage',
    ],
    ACCOUNTANT: [
        'business.read',
        'members.read',
        'catalog.read',
        'catalog.cost.view',
        'reports.view',
        'finance.view',
        'sales.view',
    ],
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
