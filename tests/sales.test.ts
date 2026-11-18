import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {api, bearer, createMember} from './helpers';
import {customer, opening, product, seedSale, shop} from './saleFixtures';

const SALES = '/api/v1/sales';
const list = (token: string, query: Record<string, string | number> = {}) =>
    api.get(SALES).query(query).set(bearer(token));

describe('sales history', () => {
    it('lists the store sales newest first, with returns, methods and filters', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 50);
        const asha = await customer(s.token, `Asha ${randomUUID().slice(0, 6)}`);
        const at = (iso: string) => new Date(iso);
        const old = await seedSale(s, [{product: p, quantity: '1', total: '10.00'}], {
            createdAt: at('2026-11-01T10:00:00Z'),
        });
        const mid = await seedSale(
            s,
            [
                {product: p, quantity: '2', total: '20.00'},
                {product: p, quantity: '1', total: '10.00'},
            ],
            {customerId: asha.id, methods: ['UPI', 'CASH'], createdAt: at('2026-11-10T10:00:00Z')},
        );
        const recent = await seedSale(s, [{product: p, quantity: '1', total: '15.00'}], {
            createdAt: at('2026-11-17T10:00:00Z'),
        });
        await api
            .post(`${SALES}/${mid.id}/returns`)
            .set(bearer(s.token))
            .send({
                lines: [{saleLineId: mid.lines[0].id, quantity: 1, disposition: 'RESTOCK'}],
                reason: 'Changed mind',
                refundMethod: 'CASH',
                idempotencyKey: randomUUID(),
            })
            .expect(201);

        const all = await list(s.token).expect(200);
        expect(all.body.data).toMatchObject({total: 3, page: 1, pageSize: 50});
        expect(all.body.data.items.map((i: {id: string}) => i.id)).toEqual([
            recent.id,
            mid.id,
            old.id,
        ]);
        expect(all.body.data.items[1]).toEqual({
            id: mid.id,
            invoiceNo: mid.invoiceNo,
            createdAt: '2026-11-10T10:00:00.000Z',
            customer: {id: asha.id, name: asha.name},
            cashier: {id: s.userId, fullname: 'Test Owner'},
            lineCount: 2,
            total: '30.00',
            returnedTotal: '10.00',
            methods: ['CASH', 'UPI'],
        });

        const ids = async (query: Record<string, string | number>) =>
            (await list(s.token, query).expect(200)).body.data.items.map((i: {id: string}) => i.id);
        expect(await ids({q: asha.name.toLowerCase()})).toEqual([mid.id]);
        expect(await ids({q: asha.phoneNumber.slice(-6)})).toEqual([mid.id]);
        expect(await ids({q: recent.invoiceNo.slice(-8)})).toEqual([recent.id]);
        expect(await ids({from: '2026-11-05T00:00:00Z', to: '2026-11-15T00:00:00Z'})).toEqual([
            mid.id,
        ]);
        expect(await ids({from: '2026-11-10T10:00:00Z'})).toEqual([recent.id, mid.id]);
        const page2 = await list(s.token, {page: 2, pageSize: 2}).expect(200);
        expect(page2.body.data).toMatchObject({total: 3, page: 2, pageSize: 2});
        expect(page2.body.data.items.map((i: {id: string}) => i.id)).toEqual([old.id]);
        await list(s.token, {pageSize: 500}).expect(400);
        await list(s.token, {from: 'not a date'}).expect(400);
    });

    it('keeps other businesses out, and needs sales.view', async () => {
        const s = await shop();
        const p = await product(s.token);
        await seedSale(s, [{product: p, quantity: '1', total: '10.00'}]);
        const stranger = await shop();
        expect((await list(stranger.token).expect(200)).body.data.total).toBe(0);

        const cashier = await createMember(s.token, 'CASHIER');
        expect((await list(cashier.token).expect(200)).body.data.total).toBe(1);
        const staff = await createMember(s.token, 'STAFF');
        await list(staff.token).expect(403);
    });
});
