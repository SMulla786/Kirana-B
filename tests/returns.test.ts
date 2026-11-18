import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {api, bearer, createMember, prisma} from './helpers';
import {customer, opening, product, seedSale, shop, stockOf} from './saleFixtures';

type Body = Record<string, unknown>;

const giveBack = (token: string, saleId: string, body: Body) =>
    api
        .post(`/api/v1/sales/${saleId}/returns`)
        .set(bearer(token))
        .send({
            reason: 'Changed mind',
            refundMethod: 'CASH',
            idempotencyKey: randomUUID(),
            ...body,
        });
const line = (saleLineId: string, quantity: number | string, disposition = 'RESTOCK') => ({
    saleLineId,
    quantity,
    disposition,
});
const snapshot = (id: string) =>
    prisma.sale.findUniqueOrThrow({where: {id}, include: {lines: true, payments: true}});

describe('sales returns', () => {
    it('returns part then the rest of a line: proportional, then the exact remainder', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        // 100.00 for 3, tax included: a third does not divide evenly.
        const sale = await seedSale(s, [
            {
                product: p,
                quantity: '3',
                total: '100.00',
                taxableValue: '89.29',
                cgst: '5.36',
                sgst: '5.35',
            },
        ]);
        const sl = sale.lines[0];
        const before = await snapshot(sale.id);

        const first = await giveBack(s.token, sale.id, {lines: [line(sl.id, 1)]}).expect(201);
        expect(first.body.data).toMatchObject({
            saleId: sale.id,
            creditNoteNo: expect.stringMatching(/^CN\/\d\d-\d\d\/00001$/),
            refundMethod: 'CASH',
            refundTotal: '33.00', // NEAREST_1 is the business default
            roundOff: '-0.33',
            createdBy: {id: s.userId, fullname: 'Test Owner'},
            lines: [
                {
                    saleLineId: sl.id,
                    productName: p.name,
                    unit: 'PIECE',
                    quantity: '1.000',
                    disposition: 'RESTOCK',
                    taxableValue: '29.76',
                    cgst: '1.79',
                    sgst: '1.78',
                    amount: '33.33',
                    restockMovementId: expect.any(String),
                    damageMovementId: null,
                },
            ],
        });
        expect(await stockOf(s, p.id)).toBe('11.000');

        const rest = await giveBack(s.token, sale.id, {
            lines: [line(sl.id, 2, 'DAMAGED')],
            reason: 'Seal broken',
        }).expect(201);
        const cn = rest.body.data.creditNoteNo as string;
        expect(cn).toMatch(/\/00002$/);
        expect(rest.body.data).toMatchObject({refundTotal: '67.00', roundOff: '0.33'});
        const [r] = rest.body.data.lines;
        expect(r).toMatchObject({
            taxableValue: '59.53',
            cgst: '3.57',
            sgst: '3.57',
            amount: '66.67',
        });
        // Back in, then written off: the ledger shows both, and the shelf count is unchanged.
        const moves = await prisma.stockMovement.findMany({
            where: {reference: cn, productId: p.id},
            orderBy: {createdAt: 'asc'},
        });
        expect(moves.map((m) => [m.id, m.type, m.quantity.toFixed(3), m.reason])).toEqual([
            [r.restockMovementId, 'SALE_RETURN', '2.000', null],
            [r.damageMovementId, 'DAMAGE', '-2.000', 'Returned damaged: Seal broken'],
        ]);
        expect(await stockOf(s, p.id)).toBe('11.000');

        await giveBack(s.token, sale.id, {lines: [line(sl.id, 1)]}).expect(409);
        expect(await snapshot(sale.id)).toEqual(before); // the sale is never changed
    });

    it('never returns more than was sold, also across one request and concurrent requests', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const sale = await seedSale(s, [{product: p, quantity: '3', total: '30.00'}]);
        const sl = sale.lines[0].id;

        const over = await giveBack(s.token, sale.id, {lines: [line(sl, 4)]}).expect(409);
        expect(over.body.message).toContain('Only 3.000 PIECE');
        const split = await giveBack(s.token, sale.id, {
            lines: [line(sl, 2), line(sl, 2, 'DAMAGED')],
        }).expect(409);
        expect(split.body.errors).toEqual([expect.objectContaining({field: 'lines.1'})]);

        const both = await Promise.all([
            giveBack(s.token, sale.id, {lines: [line(sl, 2)]}),
            giveBack(s.token, sale.id, {lines: [line(sl, 2)]}),
        ]);
        expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
        // The winner took 2 (20.00); the last one takes the exact remainder.
        const last = await giveBack(s.token, sale.id, {lines: [line(sl, 1, 'DAMAGED')]}).expect(
            201,
        );
        expect(last.body.data.lines[0].amount).toBe('10.00');
        expect(await prisma.saleReturn.count({where: {saleId: sale.id}})).toBe(2);
        expect(await stockOf(s, p.id)).toBe('12.000');
    });

    it('splits one line across dispositions in one request, the last entry taking the remainder', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const sale = await seedSale(s, [{product: p, quantity: '3', total: '10.00'}]);
        const sl = sale.lines[0].id;
        const res = await giveBack(s.token, sale.id, {
            lines: [line(sl, 1), line(sl, 2, 'DAMAGED')],
        }).expect(201);
        expect(res.body.data.lines.map((l: Body) => l.amount)).toEqual(['3.33', '6.67']);
        expect(res.body.data.refundTotal).toBe('10.00');
        expect(await stockOf(s, p.id)).toBe('11.000');
    });

    it("restocks with the sale's pack size and unit factor, not today's", async () => {
        const s = await shop();
        const p = await product(s.token, {units: [{unit: 'CARTON', factor: 10}]});
        await opening(s.token, p.id, 5);
        const sale = await seedSale(s, [
            {product: p, unit: 'CARTON', factor: '12', quantity: '2', total: '240.00'},
        ]);
        const res = await giveBack(s.token, sale.id, {lines: [line(sale.lines[0].id, 1)]}).expect(
            201,
        );
        expect(res.body.data.lines[0]).toMatchObject({unit: 'CARTON', amount: '120.00'});
        expect(await stockOf(s, p.id)).toBe('17.000');

        const loose = await product(s.token, {baseUnit: 'GRAM', sellingPrice: '45.00'});
        await opening(s.token, loose.id, 1000);
        const kg = await seedSale(s, [
            {product: loose, unit: 'KILOGRAM', factor: '1000', quantity: '1.5', total: '67.50'},
        ]);
        await giveBack(s.token, kg.id, {lines: [line(kg.lines[0].id, '0.75')]}).expect(201);
        expect(await stockOf(s, loose.id)).toBe('1750.000');
    });

    it('credits the customer account on a CREDIT refund, and needs a customer for it', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const c = await customer(s.token);
        const sale = await seedSale(s, [{product: p, quantity: '1', total: '50.00'}], {
            customerId: c.id,
        });
        const res = await giveBack(s.token, sale.id, {
            lines: [line(sale.lines[0].id, 1)],
            refundMethod: 'CREDIT',
        }).expect(201);
        const entries = await prisma.customerLedgerEntry.findMany({where: {customerId: c.id}});
        expect(
            entries.map((e) => [e.type, e.amount.toFixed(2), e.balanceAfter.toFixed(2)]),
        ).toEqual([['RETURN_CREDIT', '-50.00', '-50.00']]);
        expect(entries[0]).toMatchObject({saleId: sale.id, saleReturnId: res.body.data.id});
        const balance = await prisma.customerBalance.findUniqueOrThrow({where: {customerId: c.id}});
        expect(balance.balance.toFixed(2)).toBe('-50.00');

        const walkIn = await seedSale(s, [{product: p, quantity: '1', total: '50.00'}]);
        await giveBack(s.token, walkIn.id, {
            lines: [line(walkIn.lines[0].id, 1)],
            refundMethod: 'CREDIT',
        }).expect(400);
        expect(await prisma.saleReturn.count({where: {saleId: walkIn.id}})).toBe(0);
    });

    it('replays a retried idempotencyKey, also when two retries race', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const sale = await seedSale(s, [{product: p, quantity: '5', total: '50.00'}]);
        const body = {lines: [line(sale.lines[0].id, 1)], idempotencyKey: randomUUID()};

        const first = await giveBack(s.token, sale.id, body).expect(201);
        const again = await giveBack(s.token, sale.id, body).expect(200);
        expect(again.body.data).toEqual(first.body.data);

        const raced = {...body, idempotencyKey: randomUUID()};
        const both = await Promise.all([
            giveBack(s.token, sale.id, raced),
            giveBack(s.token, sale.id, raced),
        ]);
        expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(both[0].body.data.id).toBe(both[1].body.data.id);
        expect(await prisma.saleReturn.count({where: {saleId: sale.id}})).toBe(2);
        expect(await stockOf(s, p.id)).toBe('12.000');

        const other = await seedSale(s, [{product: p, quantity: '1', total: '10.00'}]);
        await giveBack(s.token, other.id, {...body, lines: [line(other.lines[0].id, 1)]}).expect(
            409,
        );
    });

    it('rejects bad quantities and unknown lines without writing', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const sale = await seedSale(s, [{product: p, quantity: '3', total: '30.00'}]);
        const sl = sale.lines[0].id;
        await giveBack(s.token, sale.id, {lines: [line(sl, '1.5')]}).expect(400); // a count unit
        await giveBack(s.token, sale.id, {lines: [line(sl, 0)]}).expect(400);
        await giveBack(s.token, sale.id, {lines: [line(randomUUID(), 1)]}).expect(404);
        await giveBack(s.token, sale.id, {lines: [line(sl, 1)], refundMethod: 'CHEQUE'}).expect(
            400,
        );
        expect(await prisma.saleReturn.count({where: {saleId: sale.id}})).toBe(0);
        expect(await stockOf(s, p.id)).toBe('10.000');
    });

    it('needs sales.return, and keeps another business out', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 10);
        const sale = await seedSale(s, [{product: p, quantity: '3', total: '30.00'}]);
        const body = {lines: [line(sale.lines[0].id, 1)]};
        const cashier = await createMember(s.token, 'CASHIER');
        await giveBack(cashier.token, sale.id, body).expect(403);

        const stranger = await shop();
        await giveBack(stranger.token, sale.id, body).expect(404);
        await giveBack(s.token, randomUUID(), body).expect(404);
        expect(await prisma.saleReturn.count({where: {saleId: sale.id}})).toBe(0);
    });

    it('takes a damaged return even when the sale had taken stock below zero', async () => {
        const s = await shop();
        const p = await product(s.token); // no opening stock: the sale goes negative (allowed)
        const sold = await api
            .post('/api/v1/pos/sales')
            .set(bearer(s.token))
            .send({
                lines: [{productId: p.id, unit: 'PIECE', quantity: 2}],
                payments: [{method: 'CASH', amount: '20.00'}],
                idempotencyKey: randomUUID(),
            })
            .expect(201);
        expect(await stockOf(s, p.id)).toBe('-2.000');
        const sl = sold.body.data.lines[0].id as string;
        await giveBack(s.token, sold.body.data.id, {lines: [line(sl, 1, 'DAMAGED')]}).expect(201);
        // Back in, then written off: net zero, so it must not trip "Insufficient stock".
        expect(await stockOf(s, p.id)).toBe('-2.000');
    });
});
