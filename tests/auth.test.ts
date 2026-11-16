import {randomUUID} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import emailService from '../src/services/email.service';
import {
    api,
    bearer,
    createOwner,
    login,
    newOwnerPayload,
    PASSWORD,
    prisma,
    uniqueEmail,
} from './helpers';

const A = '/api/v1/auth';
const me = (token: string) => api.get(`${A}/me`).set(bearer(token));

afterEach(() => vi.restoreAllMocks());

describe('register / verify / login', () => {
    it('register creates the business graph and leaks nothing', async () => {
        const payload = newOwnerPayload();
        const res = await api.post(`${A}/register`).send(payload);
        expect(res.status).toBe(201);
        expect(Object.keys(res.body.data)).toEqual(['user']);
        expect(Object.keys(res.body.data.user).sort()).toEqual(['email', 'id', 'username']);

        const user = await prisma.user.findUniqueOrThrow({
            where: {username: payload.username},
            include: {memberships: {include: {kirana: {include: {stores: true}}}}},
        });
        expect(JSON.stringify(res.body)).not.toContain('password');
        expect(JSON.stringify(res.body)).not.toContain(user.verifyCode!);
        expect(user.role).toBe('KIRANA');
        expect(user.isVerified).toBe(false);
        expect(user.memberships).toHaveLength(1);
        expect(user.memberships[0].role).toBe('OWNER');
        expect(user.memberships[0].kirana.name).toBe(payload.business.name);
        const stores = user.memberships[0].kirana.stores;
        expect(stores).toHaveLength(1);
        expect(stores[0].isDefault).toBe(true);
    });

    it('rejects an extra role field (400) and a duplicate username (409)', async () => {
        const payload = newOwnerPayload();
        await api
            .post(`${A}/register`)
            .send({...payload, role: 'ADMIN'})
            .expect(400);
        await api.post(`${A}/register`).send(payload).expect(201);
        await api
            .post(`${A}/register`)
            .send({...newOwnerPayload(), username: payload.username})
            .expect(409);
    });

    it('wrong verify code is 400 and login before verification is 403', async () => {
        const payload = newOwnerPayload();
        await api.post(`${A}/register`).send(payload).expect(201);
        const {verifyCode} = await prisma.user.findUniqueOrThrow({
            where: {username: payload.username},
        });
        const wrong = verifyCode === '000000' ? '111111' : '000000';
        await api
            .post(`${A}/verify-code`)
            .send({username: payload.username, code: wrong})
            .expect(400);
        await api
            .post(`${A}/login`)
            .send({identifier: payload.username, password: PASSWORD})
            .expect(403);
    });

    it('unknown user and wrong password give the same 401 message', async () => {
        const owner = await createOwner();
        const a = await api
            .post(`${A}/login`)
            .send({identifier: `nobody_${randomUUID().slice(0, 8)}`, password: PASSWORD});
        const b = await api
            .post(`${A}/login`)
            .send({identifier: owner.payload.username, password: 'wrongpass123'});
        expect(a.status).toBe(401);
        expect(b.status).toBe(401);
        expect(a.body.message).toBe('Invalid credentials');
        expect(b.body.message).toBe(a.body.message);
    });

    it('login by uppercase email works', async () => {
        const owner = await createOwner();
        const res = await api
            .post(`${A}/login`)
            .send({identifier: owner.payload.email.toUpperCase(), password: PASSWORD});
        expect(res.status).toBe(200);
    });

    it('owner login returns tenant context', async () => {
        const owner = await createOwner();
        const {me: m} = owner as unknown as {
            me: {
                membershipRole: string;
                permissions: string[];
                business: {id: string};
                store: {id: string};
            };
        };
        expect(m.membershipRole).toBe('OWNER');
        expect(m.permissions).toContain('business.update');
        expect(m.business.id).toBeTruthy();
        expect(m.store.id).toBeTruthy();
    });

    it('login response carries the rate-limit policy header', async () => {
        const owner = await createOwner();
        const res = await api
            .post(`${A}/login`)
            .send({identifier: owner.payload.username, password: PASSWORD});
        const keys = Object.keys(res.headers).map((k) => k.toLowerCase());
        expect(keys).toContain('ratelimit-policy');
    });
});

describe('token handling', () => {
    it('rejects refresh-as-bearer, garbage and tampered access tokens, and refresh with access', async () => {
        const s = await createOwner();
        await me(s.refreshToken).expect(401);
        await me('garbage').expect(401);
        await me(`${s.accessToken}x`).expect(401);
        const [h, p, sig] = s.accessToken.split('.');
        await me(`${h}.${p}.${sig.split('').reverse().join('')}`).expect(401);
        await api.post(`${A}/refresh`).send({refreshToken: s.accessToken}).expect(401);
    });

    it('rotates refresh tokens and revokes the session on reuse', async () => {
        const s = await createOwner();
        const r1 = s.refreshToken;
        const res = await api.post(`${A}/refresh`).send({refreshToken: r1});
        expect(res.status).toBe(200);
        const r2 = res.body.data.refreshToken as string;
        expect(r2).not.toBe(r1);
        await api.post(`${A}/refresh`).send({refreshToken: r1}).expect(401);
        await api.post(`${A}/refresh`).send({refreshToken: r2}).expect(401);
        await me(s.accessToken).expect(401);
    });

    it('logout revokes the session; logout without a token is 200', async () => {
        const s = await createOwner();
        await me(s.accessToken).expect(200);
        await api.post(`${A}/logout`).send({refreshToken: s.refreshToken}).expect(200);
        await me(s.accessToken).expect(401);
        await api.post(`${A}/logout`).send({}).expect(200);
    });

    it('stops working after the user is deactivated', async () => {
        const s = await createOwner();
        await me(s.accessToken).expect(200);
        await prisma.user.update({where: {username: s.payload.username}, data: {isActive: false}});
        await me(s.accessToken).expect(401);
    });
});

describe('sessions', () => {
    it('lists, flags current, and revokes other sessions', async () => {
        const s1 = await createOwner();
        const s2 = await login(s1.payload.username);
        const res = await api.get(`${A}/sessions`).set(bearer(s1.accessToken)).expect(200);
        const sessions = res.body.data as {id: string; current: boolean}[];
        expect(sessions.length).toBeGreaterThanOrEqual(2);
        expect(sessions.filter((x) => x.current)).toHaveLength(1);

        const otherId = s2.refreshToken.split('.')[0];
        await api.delete(`${A}/sessions/${otherId}`).set(bearer(s1.accessToken)).expect(200);
        await me(s2.accessToken).expect(401);
        await me(s1.accessToken).expect(200);
        await api.delete(`${A}/sessions/${randomUUID()}`).set(bearer(s1.accessToken)).expect(404);
    });

    it("cannot revoke another user's session (404)", async () => {
        const a = await createOwner();
        const b = await createOwner();
        const bId = b.refreshToken.split('.')[0];
        await api.delete(`${A}/sessions/${bId}`).set(bearer(a.accessToken)).expect(404);
        await me(b.accessToken).expect(200);
    });

    it('logout-all kills every session', async () => {
        const s1 = await createOwner();
        const s2 = await login(s1.payload.username);
        await api.post(`${A}/logout-all`).set(bearer(s1.accessToken)).expect(200);
        await me(s1.accessToken).expect(401);
        await me(s2.accessToken).expect(401);
    });
});

describe('password reset', () => {
    const capture = () =>
        vi
            .spyOn(emailService, 'sendResetPasswordEmail')
            .mockResolvedValue({success: true} as never);

    it('forgot gives the same message for known and unknown emails', async () => {
        capture();
        const s = await createOwner();
        const known = await api.post(`${A}/password/forgot`).send({email: s.payload.email});
        const unknown = await api.post(`${A}/password/forgot`).send({email: uniqueEmail()});
        expect(known.status).toBe(200);
        expect(unknown.status).toBe(200);
        expect(unknown.body.message).toBe(known.body.message);
    });

    it('reset works once, kills old sessions and changes the password', async () => {
        const spy = capture();
        const s = await createOwner();
        await api.post(`${A}/password/forgot`).send({email: s.payload.email}).expect(200);
        const token = spy.mock.calls[0][1] as string;

        await api.post(`${A}/password/reset`).send({token, newPassword: 'brandnew456'}).expect(200);
        await me(s.accessToken).expect(401);
        await api
            .post(`${A}/login`)
            .send({identifier: s.payload.username, password: PASSWORD})
            .expect(401);
        await api
            .post(`${A}/login`)
            .send({identifier: s.payload.username, password: 'brandnew456'})
            .expect(200);
        await api.post(`${A}/password/reset`).send({token, newPassword: 'another789'}).expect(400);
    });

    it('rejects an expired token', async () => {
        const spy = capture();
        const s = await createOwner();
        await api.post(`${A}/password/forgot`).send({email: s.payload.email}).expect(200);
        const token = spy.mock.calls[0][1] as string;
        await prisma.user.update({
            where: {username: s.payload.username},
            data: {passwordResetExpiry: new Date(Date.now() - 60_000)},
        });
        await api.post(`${A}/password/reset`).send({token, newPassword: 'brandnew456'}).expect(400);
    });
});

describe('change password and profile', () => {
    it('wrong current password is 400', async () => {
        const s = await createOwner();
        await api
            .post(`${A}/password/change`)
            .set(bearer(s.accessToken))
            .send({currentPassword: 'wrongpass123', newPassword: 'brandnew456'})
            .expect(400);
    });

    it('change keeps the current session and drops the others', async () => {
        const s1 = await createOwner();
        const s2 = await login(s1.payload.username);
        await api
            .post(`${A}/password/change`)
            .set(bearer(s1.accessToken))
            .send({currentPassword: PASSWORD, newPassword: 'brandnew456'})
            .expect(200);
        await me(s2.accessToken).expect(401);
        await me(s1.accessToken).expect(200);
    });

    it('/me requires auth; PATCH is strict and updates fullname', async () => {
        const s = await createOwner();
        await api.get(`${A}/me`).expect(401);
        await api.patch(`${A}/me`).set(bearer(s.accessToken)).send({email: 'x@y.com'}).expect(400);
        const res = await api
            .patch(`${A}/me`)
            .set(bearer(s.accessToken))
            .send({fullname: 'New Name'});
        expect(res.status).toBe(200);
        expect(res.body.data.fullname).toBe('New Name');
    });
});
