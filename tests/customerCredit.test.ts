import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {api, bearer, createMember, prisma} from './helpers';
import {customer, product, shop} from './saleFixtures';

type Body = Record<string, unknown>;

// A credit sale of `pieces` at 10.00 each (NEAREST_1 round-off keeps whole rupees).
const creditSale = (
    token: string,
    customerId: string,
    productId: string,
    pieces: number,
    x: Body = {},
) =>
    api
        .post('/api/v1/pos/sales')
        .set(bearer(token))
        .send({
            customerId,
            lines: [{productId, unit: 'PIECE', quantity: pieces}],
            payments: [{method: 'CREDIT', amount: (pieces * 10).toFixed(2)}],
            idempotencyKey: randomUUID(),
            ...x,
        });
const setLimit = (token: string, id: string, creditLimit: string | null) =>
    api.patch(`/api/v1/customers/${id}`).set(bearer(token)).send({creditLimit}).expect(200);

describe('credit limit at checkout', () => {
    it('shows outstanding and limit in the checkout preview', async () => {
        const s = await shop();
        const p = await product(s.token);
        const c = await customer(s.token);
        await setLimit(s.token, c.id, '100');
        await creditSale(s.token, c.id, p.id, 3).expect(201);
        const res = await api
            .post('/api/v1/pos/checkout')
            .set(bearer(s.token))
            .send({customerId: c.id, lines: [{productId: p.id, unit: 'PIECE', quantity: 1}]})
            .expect(200);
        expect(res.body.data.customer).toEqual({
            id: c.id,
            name: c.name,
            phoneNumber: c.phoneNumber,
            isActive: true,
            outstanding: '30.00',
            creditLimit: '100.00',
            available: '70.00',
        });
        const walkIn = await api
            .post('/api/v1/pos/checkout')
            .set(bearer(s.token))
            .send({lines: [{productId: p.id, unit: 'PIECE', quantity: 1}]})
            .expect(200);
        expect(walkIn.body.data.customer).toBeNull();
    });

    it('refuses credit past the limit unless an allowed user overrides it, and records why', async () => {
        const s = await shop();
        const p = await product(s.token);
        const c = await customer(s.token);
        await setLimit(s.token, c.id, '50');
        await creditSale(s.token, c.id, p.id, 5).expect(201); // exactly at the limit is fine

        const over = await creditSale(s.token, c.id, p.id, 1).expect(409);
        expect(over.body.message).toBe('Over the credit limit by 10.00');
        expect(over.body.errors[0]).toMatchObject({
            field: 'payments',
            outstanding: '50.00',
            creditLimit: '50.00',
            available: '0.00',
        });
        expect(await prisma.sale.count({where: {customerId: c.id}})).toBe(1);

        const manager = await createMember(s.token, 'MANAGER');
        const ok = await creditSale(manager.token, c.id, p.id, 1, {overrideCreditLimit: true});
        expect(ok.status).toBe(201);
        const entry = await prisma.customerLedgerEntry.findFirstOrThrow({
            where: {saleId: ok.body.data.id},
        });
        expect(entry).toMatchObject({
            type: 'CREDIT_SALE',
            reason: 'Over the credit limit of 50.00 by 10.00',
        });
        expect(entry.balanceAfter.toFixed(2)).toBe('60.00');

        // No limit: no check. A zero limit: no credit at all.
        await setLimit(s.token, c.id, null);
        await creditSale(s.token, c.id, p.id, 20).expect(201);
        const z = await customer(s.token);
        await setLimit(s.token, z.id, '0');
        await creditSale(s.token, z.id, p.id, 1).expect(409);
    });

    it('lets only one of two racing credit sales take the last of the limit', async () => {
        const s = await shop();
        const p = await product(s.token);
        const c = await customer(s.token);
        await setLimit(s.token, c.id, '50');
        const both = await Promise.all([
            creditSale(s.token, c.id, p.id, 3),
            creditSale(s.token, c.id, p.id, 3),
        ]);
        expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
        const balance = await prisma.customerBalance.findUniqueOrThrow({where: {customerId: c.id}});
        expect(balance.balance.toFixed(2)).toBe('30.00');
    });

    it('takes no new bill for an archived customer', async () => {
        const s = await shop();
        const p = await product(s.token);
        const c = await customer(s.token);
        await api
            .patch(`/api/v1/customers/${c.id}`)
            .set(bearer(s.token))
            .send({isActive: false})
            .expect(200);
        const res = await creditSale(s.token, c.id, p.id, 1).expect(409);
        expect(res.body.errors[0].field).toBe('customerId');
        await api
            .post('/api/v1/pos/checkout')
            .set(bearer(s.token))
            .send({customerId: c.id, lines: [{productId: p.id, unit: 'PIECE', quantity: 1}]})
            .expect(409);
    });
});
