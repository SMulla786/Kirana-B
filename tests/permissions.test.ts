import {describe, expect, it} from 'vitest';
import {MembershipRole} from '@prisma/client';
import {PERMISSIONS, ROLE_PERMISSIONS, canAssignRole} from '../src/config/permissions';

const roles = Object.values(MembershipRole);
const managerGrants: MembershipRole[] = ['CASHIER', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'STAFF'];

describe('permissions', () => {
    it.each(roles.flatMap((a) => roles.map((t) => [a, t] as const)))(
        'canAssignRole(%s, %s)',
        (actor, target) => {
            const expected =
                actor === 'OWNER'
                    ? target !== 'OWNER'
                    : actor === 'MANAGER' && managerGrants.includes(target);
            expect(canAssignRole(actor, target)).toBe(expected);
        },
    );

    it('OWNER has every permission', () => {
        expect([...ROLE_PERMISSIONS.OWNER].sort()).toEqual([...PERMISSIONS].sort());
    });

    it('MANAGER lacks only business.update', () => {
        expect(PERMISSIONS.filter((p) => !ROLE_PERMISSIONS.MANAGER.includes(p))).toEqual([
            'business.update',
        ]);
    });

    it.each(roles)('%s has business.read', (role) => {
        expect(ROLE_PERMISSIONS[role]).toContain('business.read');
    });
});
