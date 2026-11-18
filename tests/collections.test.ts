import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {istDayOf} from '@services/kirana/customerLedger';
import {api, bearer, createMember, prisma} from './helpers';
import {creditSale, customer, opening, postEntry, product, shop} from './saleFixtures';

type Body = Record<string, unknown>;
const CUSTOMERS = '/api/v1/customers';

const collect = (token: string, customerId: string, body: Body) =>
    api
        .post(`${CUSTOMERS}/${customerId}/payments`)
        .set(bearer(token))
        .send({method: 'CASH', idempotencyKey: randomUUID(), ...body});
const read = (token: string, path: string) => api.get(`${CUSTOMERS}/${path}`).set(bearer(token));
const due = async (token: string, customerId: string, status = 'due') =>
    (await read(token, `${customerId}/invoices?status=${status}`).expect(200)).body.data;
const balanceOf = async (customerId: string) =>
    (await prisma.customerBalance.findUniqueOrThrow({where: {customerId}})).balance.toFixed(2);
const paymentsOf = (customerId: string) => prisma.customerPayment.count({where: {customerId}});

/** A shop with stock and one customer. */
const setup = async () => {
    const s = await shop();
    const p = await product(s.token);
    await opening(s.token, p.id, 100);
    const c = await customer(s.token);
    return {s, p, c, sell: (q: number, cash = 0) => creditSale(s, c.id, p.id, q, cash)};
};

describe('customer collections', () => {
    it('sets a collection against credit invoices, keeps the rest on account, never past what is due', async () => {
        const {s, p, c, sell} = await setup();
        const inv1 = await sell(3); // 30.00 on credit
        const inv2 = await sell(4, 15); // 40.00: 15.00 cash, 25.00 on credit
        const invoice = (inv: {id: string; invoiceNo: string}, rest: Body) => ({
            saleId: inv.id,
            invoiceNo: inv.invoiceNo,
            createdAt: expect.any(String),
            returnedToAccount: '0.00',
            allocated: '0.00',
            ...rest,
        });
        expect(await due(s.token, c.id)).toEqual([
            invoice(inv1, {total: '30.00', creditAmount: '30.00', due: '30.00'}),
            invoice(inv2, {total: '40.00', creditAmount: '25.00', due: '25.00'}),
        ]);

        // One piece of inv1 comes back to the account.
        await api
            .post(`/api/v1/sales/${inv1.id}/returns`)
            .set(bearer(s.token))
            .send({
                lines: [{saleLineId: inv1.lines[0].id, quantity: 1, disposition: 'RESTOCK'}],
                reason: 'Changed mind',
                refundMethod: 'CREDIT',
                idempotencyKey: randomUUID(),
            })
            .expect(201);
        expect(await balanceOf(c.id)).toBe('45.00');

        const today = istDayOf(new Date());
        const first = await collect(s.token, c.id, {
            amount: '50.00',
            allocations: [
                {saleId: inv2.id, amount: '10.00'},
                {saleId: inv1.id, amount: '20.00'},
            ],
        }).expect(201);
        expect(first.body.data).toMatchObject({
            receiptNo: expect.stringMatching(/^RCPT\/\d\d-\d\d\/00001$/),
            customer: {id: c.id, name: c.name, phoneNumber: c.phoneNumber},
            method: 'CASH',
            amount: '50.00',
            reference: null,
            receivedOn: today,
            status: 'RECORDED',
            allocations: [
                {saleId: inv1.id, invoiceNo: inv1.invoiceNo, amount: '20.00'},
                {saleId: inv2.id, invoiceNo: inv2.invoiceNo, amount: '10.00'},
            ],
            unallocated: '20.00',
            balanceAfter: '-5.00', // 20.00 more than owed: an advance on account
            reversal: null,
            createdBy: {id: s.userId, fullname: 'Test Owner'},
        });
        const reprint = await read(s.token, `${c.id}/payments/${first.body.data.id}`).expect(200);
        expect(reprint.body.data).toEqual(first.body.data);

        expect(await due(s.token, c.id)).toEqual([
            invoice(inv2, {
                total: '40.00',
                creditAmount: '25.00',
                allocated: '10.00',
                due: '15.00',
            }),
        ]);
        expect(await due(s.token, c.id, 'all')).toEqual([
            invoice(inv1, {
                total: '30.00',
                creditAmount: '30.00',
                returnedToAccount: '10.00',
                allocated: '20.00',
                due: '0.00',
            }),
            invoice(inv2, {
                total: '40.00',
                creditAmount: '25.00',
                allocated: '10.00',
                due: '15.00',
            }),
        ]);

        // Refused without writing anything.
        const over = await collect(s.token, c.id, {
            amount: '20.00',
            allocations: [{saleId: inv2.id, amount: '15.01'}],
        }).expect(409);
        expect(over.body.errors).toEqual([
            {field: 'allocations.0', message: `Only 15.00 is due on ${inv2.invoiceNo}`},
        ]);
        const other = await customer(s.token);
        const theirs = await creditSale(s, other.id, p.id, 1);
        const paidInCash = await api
            .post('/api/v1/pos/sales')
            .set(bearer(s.token))
            .send({
                customerId: c.id,
                lines: [{productId: p.id, unit: 'PIECE', quantity: 1}],
                payments: [{method: 'CASH', amount: '10.00'}],
                idempotencyKey: randomUUID(),
            })
            .expect(201);
        for (const saleId of [theirs.id, paidInCash.body.data.id, randomUUID()]) {
            const res = await collect(s.token, c.id, {
                amount: '5.00',
                allocations: [{saleId, amount: '5.00'}],
            }).expect(404);
            expect(res.body.errors).toEqual([expect.objectContaining({field: 'allocations.0'})]);
        }
        const tomorrow = istDayOf(new Date(Date.now() + 86_400_000));
        for (const bad of [
            {receivedOn: tomorrow},
            {receivedOn: '2026-02-30'},
            {method: 'CREDIT'},
            {amount: '0.00'},
            {amount: '1.234'},
            {allocations: [{saleId: inv2.id, amount: 'x'}]},
            {allocations: [{saleId: inv2.id, amount: '5.01'}]}, // more than the amount
        ]) {
            await collect(s.token, c.id, {amount: '5.00', ...bad}).expect(400);
        }
        expect(await paymentsOf(c.id)).toBe(1);
        expect(await balanceOf(c.id)).toBe('-5.00');

        const second = await collect(s.token, c.id, {
            amount: '15.00',
            method: 'UPI',
            reference: 'UPI-4411',
            receivedOn: '2025-01-15',
            allocations: [{saleId: inv2.id, amount: '15.00'}],
        }).expect(201);
        expect(second.body.data).toMatchObject({
            receiptNo: expect.stringMatching(/\/00002$/),
            method: 'UPI',
            reference: 'UPI-4411',
            receivedOn: '2025-01-15',
            unallocated: '0.00',
            balanceAfter: '-20.00',
        });
        expect(await due(s.token, c.id)).toEqual([]);
    });

    it('replays a retried key and never credits twice, also when requests race', async () => {
        const {s, c, sell} = await setup();
        const inv = await sell(3);
        const alloc = (amount: string) => ({amount, allocations: [{saleId: inv.id, amount}]});

        const body = {...alloc('10.00'), idempotencyKey: randomUUID()};
        const first = await collect(s.token, c.id, body).expect(201);
        const again = await collect(s.token, c.id, body).expect(200);
        expect(again.body.data).toEqual(first.body.data);

        const raced = {...alloc('5.00'), idempotencyKey: randomUUID()};
        const both = await Promise.all([
            collect(s.token, c.id, raced),
            collect(s.token, c.id, raced),
        ]);
        expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(both[0].body.data.id).toBe(both[1].body.data.id);

        // Two different collections for the last 15.00: only one can take it.
        const rivals = await Promise.all([
            collect(s.token, c.id, alloc('15.00')),
            collect(s.token, c.id, alloc('15.00')),
        ]);
        expect(rivals.map((r) => r.status).sort()).toEqual([201, 409]);

        expect(await paymentsOf(c.id)).toBe(3);
        expect(await balanceOf(c.id)).toBe('0.00');
        expect(await due(s.token, c.id)).toEqual([]);

        const other = await customer(s.token);
        await collect(s.token, other.id, body).expect(409);
        expect(await paymentsOf(other.id)).toBe(0);
    });

    it('puts a reversed collection back on its invoice, and shows the reversal on the receipt', async () => {
        const {s, c, sell} = await setup();
        const inv = await sell(3);
        const paid = await collect(s.token, c.id, {
            amount: '30.00',
            allocations: [{saleId: inv.id, amount: '30.00'}],
        }).expect(201);
        expect(await due(s.token, c.id)).toEqual([]);

        const reversal = await postEntry(s, c.id, {
            type: 'REVERSAL',
            amount: '30.00',
            reason: 'Cheque bounced',
            reversesId: paid.body.data.ledgerEntryId,
        });
        expect(await due(s.token, c.id)).toEqual([
            expect.objectContaining({saleId: inv.id, allocated: '0.00', due: '30.00'}),
        ]);
        const receipt = await read(s.token, `${c.id}/payments/${paid.body.data.id}`).expect(200);
        expect(receipt.body.data).toMatchObject({
            balanceAfter: '0.00', // as it was right after the collection
            reversal: {
                entryId: reversal.id,
                reason: 'Cheque bounced',
                createdAt: reversal.createdAt.toISOString(),
            },
        });
        await collect(s.token, c.id, {
            amount: '30.00',
            allocations: [{saleId: inv.id, amount: '30.00'}],
        }).expect(201);
        expect(await balanceOf(c.id)).toBe('0.00');
    });

    it('keeps other businesses out and follows the roles', async () => {
        const {s, c, sell} = await setup();
        await sell(2);
        const paid = await collect(s.token, c.id, {amount: '5.00'}).expect(201);
        const reads = [
            `${c.id}/ledger`,
            `${c.id}/invoices`,
            `${c.id}/payments/${paid.body.data.id}`,
        ];

        const stranger = await shop();
        for (const path of reads) await read(stranger.token, path).expect(404);
        await collect(stranger.token, c.id, {amount: '5.00'}).expect(404);
        const other = await customer(s.token);
        await read(s.token, `${other.id}/payments/${paid.body.data.id}`).expect(404);
        await read(s.token, `${c.id}/payments/${randomUUID()}`).expect(404);
        await read(s.token, 'not-an-id/ledger').expect(400);
        expect(await paymentsOf(c.id)).toBe(1);

        const accountant = await createMember(s.token, 'ACCOUNTANT');
        for (const path of reads) await read(accountant.token, path).expect(200);
        await collect(accountant.token, c.id, {amount: '5.00'}).expect(403);
        const staff = await createMember(s.token, 'STAFF');
        await read(staff.token, reads[0]).expect(403);
        await collect(staff.token, c.id, {amount: '5.00'}).expect(403);
        const cashier = await createMember(s.token, 'CASHIER');
        await collect(cashier.token, c.id, {amount: '5.00'}).expect(201);

        // An archived customer takes no new bills but can still pay.
        await prisma.client.update({where: {id: c.id}, data: {isActive: false}});
        await collect(s.token, c.id, {amount: '5.00'}).expect(201);
        expect(await balanceOf(c.id)).toBe('5.00');
    });
});
