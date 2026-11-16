import {randomInt, randomUUID} from 'node:crypto';
import supertest from 'supertest';
import {MembershipRole} from '@prisma/client';
import app from '../src/app';
import prisma from '../src/client';

export const api = supertest(app);
export {prisma};

// Tests share one DB that is never wiped, so every username/email/phone must be unique.
export const uniqueName = (prefix = 'user') => `${prefix}_${randomUUID().slice(0, 8)}`;
export const uniqueEmail = () => `${uniqueName()}@example.com`;
export const uniquePhone = () => `9${String(randomInt(1e9)).padStart(9, '0')}`;

export const PASSWORD = 'secret123';

export const newOwnerPayload = () => ({
    fullname: 'Test Owner',
    email: uniqueEmail(),
    username: uniqueName('owner'),
    password: PASSWORD,
    phoneNumber: uniquePhone(),
    business: {name: uniqueName('Shop'), address: '12 Market Road', City: 'Pune'},
});

export const bearer = (token: string) => ({Authorization: `Bearer ${token}`});

export const login = async (identifier: string, password = PASSWORD) => {
    const res = await api.post('/api/v1/auth/login').send({identifier, password});
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.body.message}`);
    return res.body.data as {
        accessToken: string;
        refreshToken: string;
        me: {business: {id: string}; store: {id: string}; permissions: string[]};
    };
};

/** Self-signup → verify (code read from the DB) → login. */
export const createOwner = async () => {
    const payload = newOwnerPayload();
    const res = await api.post('/api/v1/auth/register').send(payload);
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.body.message}`);
    const {verifyCode} = await prisma.user.findUniqueOrThrow({
        where: {username: payload.username},
    });
    await api
        .post('/api/v1/auth/verify-code')
        .send({username: payload.username, code: verifyCode})
        .expect(200);
    const session = await login(payload.username);
    return {...session, payload, kiranaId: session.me.business.id, token: session.accessToken};
};

/** Owner adds a member with `role`, then that member logs in. */
export const createMember = async (ownerToken: string, role: MembershipRole) => {
    const username = uniqueName(role.toLowerCase());
    const res = await api
        .post('/api/v1/business/members')
        .set(bearer(ownerToken))
        .send({
            fullname: `Test ${role}`,
            email: uniqueEmail(),
            username,
            password: PASSWORD,
            phoneNumber: uniquePhone(),
            role,
        });
    if (res.status !== 201) throw new Error(`add member failed: ${res.status} ${res.body.message}`);
    const session = await login(username);
    return {
        ...session,
        username,
        membershipId: res.body.data.id as string,
        token: session.accessToken,
    };
};
