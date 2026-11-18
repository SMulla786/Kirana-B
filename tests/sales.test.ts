import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {api, bearer, createMember} from './helpers';
import {customer, opening, product, seedSale, shop, stockOf} from './saleFixtures';

const SALES = '/api/v1/sales';
const list = (token: string, query: Record<string, string | number> = {}) =>
    api.get(SALES).query(query).set(bearer(token));
const giveBack = (token: string, saleId: string, saleLineId: string) =>
    api
        .post(`${SALES}/${saleId}/returns`)
        .set(bearer(token))
        .send({
            lines: [{saleLineId, quantity: 1, disposition: 'RESTOCK'}],
            reason: 'Changed mind',
            refundMethod: 'CASH',
            idempotencyKey: randomUUID(),
        });

describe('sales history', () => {
    it('lists the store sales newest first, with returns, methods and filters', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 50);
        const asha = await customer(s.token, `Asha ${randomUUID().slice(0, 6)}`);
        const at = (iso: string) => ({createdAt: new Date(iso)});
        const one = [{product: p, quantity: '1', total: '10.00'}];
        const old = await seedSale(s, one, at('2026-11-01T10:00:00Z'));
        const mid = await seedSale(
            s,
            [
                {product: p, quantity: '2', total: '20.00'},
                {product: p, quantity: '1', total: '10.00'},
            ],
            {customerId: asha.id, methods: ['UPI', 'CASH'], ...at('2026-11-10T10:00:00Z')},
        );
        const late = await seedSale(s, one, at('2026-11-15T18:00:00Z')); // 23:30 IST on the 15th
        const night = await seedSale(s, one, at('2026-11-17T19:00:00Z')); // 00:30 IST on the 18th
        await giveBack(s.token, mid.id, mid.lines[0].id).expect(201);

        const all = await list(s.token).expect(200);
        expect(all.body.data).toMatchObject({total: 4, page: 1, pageSize: 50});
        const newestFirst = [night.id, late.id, mid.id, old.id];
        expect(all.body.data.items.map((i: {id: string}) => i.id)).toEqual(newestFirst);
        expect(all.body.data.items[2]).toEqual({
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
        expect(await ids({q: night.invoiceNo.slice(-8)})).toEqual([night.id]);
        // Whole IST days, both inclusive.
        expect(await ids({from: '2026-11-05', to: '2026-11-15'})).toEqual([late.id, mid.id]);
        expect(await ids({from: '2026-11-18', to: '2026-11-18'})).toEqual([night.id]);
        expect(await ids({to: '2026-11-17'})).toEqual([late.id, mid.id, old.id]);
        expect(await ids({from: '2026-11-16'})).toEqual([night.id]);

        const page2 = await list(s.token, {page: 2, pageSize: 3}).expect(200);
        expect(page2.body.data).toMatchObject({total: 4, page: 2, pageSize: 3});
        expect(page2.body.data.items.map((i: {id: string}) => i.id)).toEqual([old.id]);
        await list(s.token, {pageSize: 500}).expect(400);
        await list(s.token, {from: '18-11-2026'}).expect(400);
    });

    it('shows a real sale on the invoice detail with what was returned', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const sold = await api
            .post('/api/v1/pos/sales')
            .set(bearer(s.token))
            .send({
                lines: [{productId: p.id, unit: 'PIECE', quantity: 3}],
                payments: [{method: 'CASH', amount: '30.00'}],
                idempotencyKey: randomUUID(),
            })
            .expect(201);
        const sale = sold.body.data;
        expect(await stockOf(s, p.id)).toBe('7.000');

        const ret = await giveBack(s.token, sale.id, sale.lines[0].id).expect(201);
        expect(ret.body.data).toMatchObject({refundTotal: '10.00', lines: [{amount: '10.00'}]});
        expect(await stockOf(s, p.id)).toBe('8.000');

        const detail = await api.get(`${SALES}/${sale.id}`).set(bearer(s.token)).expect(200);
        expect(detail.body.data).toMatchObject({
            id: sale.id,
            invoiceNo: sale.invoiceNo,
            total: '30.00',
            returnedTotal: '10.00',
            lines: [{id: sale.lines[0].id, quantity: '3.000', returnedQuantity: '1.000'}],
            returns: [ret.body.data],
        });
        const stranger = await shop();
        await api.get(`${SALES}/${sale.id}`).set(bearer(stranger.token)).expect(404);
        await api.get(`${SALES}/not-an-id`).set(bearer(s.token)).expect(400);
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
