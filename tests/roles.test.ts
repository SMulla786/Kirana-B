import {describe, expect, it} from 'vitest';
import {ROLE_PERMISSIONS} from '../src/config/permissions';
import {encryptPassword} from '../src/utils/encryption';
import {
    PASSWORD,
    api,
    bearer,
    createMember,
    createOwner,
    login,
    prisma,
    uniqueEmail,
    uniqueName,
    uniquePhone,
} from './helpers';

const memberBody = (role: string) => ({
    fullname: 'New Member',
    email: uniqueEmail(),
    username: uniqueName('m'),
    password: PASSWORD,
    phoneNumber: uniquePhone(),
    role,
});
const getCats = (t: string) => api.get('/api/v1/catalog/categories').set(bearer(t));
const postCat = (t: string) =>
    api
        .post('/api/v1/catalog/categories')
        .set(bearer(t))
        .send({name: uniqueName('cat')});
const getMembers = (t: string) => api.get('/api/v1/business/members').set(bearer(t));
const postMember = (t: string, role: string) =>
    api.post('/api/v1/business/members').set(bearer(t)).send(memberBody(role));
const patchMember = (t: string, id: string, body: object) =>
    api.patch(`/api/v1/business/members/${id}`).set(bearer(t)).send(body);
const ownerMembershipId = async (kiranaId: string) =>
    (await prisma.membership.findFirstOrThrow({where: {kiranaId, role: 'OWNER'}})).id;

describe('role permissions', () => {
    it('CASHIER', async () => {
        const o = await createOwner();
        const c = await createMember(o.token, 'CASHIER');
        await getCats(c.token).expect(200);
        await postCat(c.token).expect(403);
        await getMembers(c.token).expect(403);
        await api.patch('/api/v1/business').set(bearer(c.token)).send({City: 'X'}).expect(403);
        expect(c.me.permissions).toEqual(ROLE_PERMISSIONS.CASHIER);
    });

    it('STAFF', async () => {
        const o = await createOwner();
        const s = await createMember(o.token, 'STAFF');
        await getCats(s.token).expect(200);
        await postCat(s.token).expect(403);
        await getMembers(s.token).expect(403);
    });

    it('INVENTORY_MANAGER', async () => {
        const o = await createOwner();
        const i = await createMember(o.token, 'INVENTORY_MANAGER');
        await postCat(i.token).expect(201);
    });

    it('ACCOUNTANT', async () => {
        const o = await createOwner();
        const a = await createMember(o.token, 'ACCOUNTANT');
        await getMembers(a.token).expect(200);
        await postMember(a.token, 'STAFF').expect(403);
        await postCat(a.token).expect(403);
    });

    it('MANAGER', async () => {
        const o = await createOwner();
        const m = await createMember(o.token, 'MANAGER');
        const other = await createMember(o.token, 'MANAGER');
        const cashier = await createMember(o.token, 'CASHIER');
        await postMember(m.token, 'CASHIER').expect(201);
        await postMember(m.token, 'MANAGER').expect(403);
        await api.patch('/api/v1/business').set(bearer(m.token)).send({City: 'X'}).expect(403);
        await patchMember(m.token, cashier.membershipId, {isActive: false}).expect(200);
        await patchMember(m.token, other.membershipId, {isActive: false}).expect(403);
        await patchMember(m.token, await ownerMembershipId(o.kiranaId), {isActive: false}).expect(
            403,
        );
    });

    it('OWNER', async () => {
        const o = await createOwner();
        await postMember(o.token, 'MANAGER').expect(201);
        await postMember(o.token, 'OWNER').expect(403);
        await patchMember(o.token, await ownerMembershipId(o.kiranaId), {isActive: false}).expect(
            403,
        );
    });
});

describe('member lifecycle', () => {
    it('deactivated member: token 401, fresh login 403', async () => {
        const o = await createOwner();
        const c = await createMember(o.token, 'CASHIER');
        await getCats(c.token).expect(200);
        await patchMember(o.token, c.membershipId, {isActive: false}).expect(200);
        await getCats(c.token).expect(401);
        await api
            .post('/api/v1/auth/login')
            .send({identifier: c.username, password: PASSWORD})
            .expect(403);
    });

    it('role change applies to the existing token', async () => {
        const o = await createOwner();
        const c = await createMember(o.token, 'CASHIER');
        await postCat(c.token).expect(403);
        await patchMember(o.token, c.membershipId, {role: 'INVENTORY_MANAGER'}).expect(200);
        await postCat(c.token).expect(201);
    });
});

describe('platform admin', () => {
    it('admin flows', async () => {
        const username = uniqueName('admin');
        await prisma.user.create({
            data: {
                fullname: 'Admin',
                username,
                email: uniqueEmail(),
                phoneNumber: uniquePhone(),
                password: await encryptPassword(PASSWORD),
                role: 'ADMIN',
                isVerified: true,
            },
        });
        const session = await login(username);
        expect(session.me.business).toBeNull();
        await api.get('/api/v1/business').set(bearer(session.accessToken)).expect(403);

        const body = {
            fullname: 'Made Owner',
            email: uniqueEmail(),
            username: uniqueName('mo'),
            password: PASSWORD,
            phoneNumber: uniquePhone(),
            business: {name: uniqueName('Shop'), address: '1 Road', City: 'Pune'},
        };
        await api
            .post('/api/v1/admin/businesses')
            .set(bearer(session.accessToken))
            .send(body)
            .expect(201);
        const owner = await login(body.username);
        const biz = await prisma.kirana.findUniqueOrThrow({
            where: {id: owner.me.business.id},
            include: {stores: true},
        });
        expect(biz.name).toBe(body.business.name);
        expect(biz.stores.filter((s) => s.isDefault)).toHaveLength(1);
    });

    it('owner cannot reach /admin', async () => {
        const o = await createOwner();
        await api.get('/api/v1/admin').set(bearer(o.token)).expect(403);
    });
});
