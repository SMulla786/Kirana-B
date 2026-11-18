import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {Prisma} from '@prisma/client';
import {api, bearer, prisma} from './helpers';
import {creditSale, customer, opening, postEntry, product, shop} from './saleFixtures';

type Entry = {id: string; type: string; amount: string; balanceAfter: string} & Record<
    string,
    unknown
>;
const statement = async (token: string, customerId: string, query: Record<string, string> = {}) =>
    (
        await api
            .get(`/api/v1/customers/${customerId}/ledger`)
            .query(query)
            .set(bearer(token))
            .expect(200)
    ).body.data;

/** The ledger must agree with itself: Σ amounts = the cached balance = the last balanceAfter. */
const reconcile = async (customerId: string) => {
    const entries = await prisma.customerLedgerEntry.findMany({
        where: {customerId},
        orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
    });
    let running = new Prisma.Decimal(0);
    for (const e of entries) {
        running = running.add(e.amount);
        expect(e.balanceAfter.toFixed(2)).toBe(running.toFixed(2)); // each entry moves it by its amount
    }
    const {balance} = await prisma.customerBalance.findUniqueOrThrow({where: {customerId}});
    expect(balance.toFixed(2)).toBe(running.toFixed(2));
    return balance.toFixed(2);
};

describe('customer statement', () => {
    it('opens with the balance before `from`, totals the whole range and pages oldest first', async () => {
        const s = await shop();
        const c = await customer(s.token);
        // [type, amount, when]: IST days, with entries either side of midnight.
        const plan = [
            ['OPENING_BALANCE', '100.00', '2026-10-31T18:00:00Z'], // 31 Oct 23:30 IST
            ['ADJUSTMENT', '50.00', '2026-10-31T19:00:00Z'], // 1 Nov 00:30 IST
            ['ADJUSTMENT', '-30.00', '2026-11-05T10:00:00Z'],
            ['ADJUSTMENT', '20.00', '2026-11-10T10:00:00Z'],
            ['ADJUSTMENT', '-40.00', '2026-11-15T18:29:59Z'], // 15 Nov 23:59:59 IST
            ['ADJUSTMENT', '5.00', '2026-11-15T18:30:00Z'], // 16 Nov 00:00 IST
        ] as const;
        const ids: string[] = [];
        for (const [type, amount, at] of plan) {
            const e = await postEntry(s, c.id, {type, amount, reason: 'Old book'});
            await prisma.customerLedgerEntry.update({
                where: {id: e.id},
                data: {createdAt: new Date(at)},
            });
            ids.push(e.id);
        }
        expect(await reconcile(c.id)).toBe('105.00');

        const all = await statement(s.token, c.id);
        expect(all).toMatchObject({
            customer: {id: c.id, name: c.name, phoneNumber: c.phoneNumber},
            from: null,
            to: null,
            openingBalance: '0.00',
            debitTotal: '175.00',
            creditTotal: '70.00',
            closingBalance: '105.00',
            total: 6,
            page: 1,
            pageSize: 100,
        });
        expect(all.entries.map((e: Entry) => [e.id, e.balanceAfter])).toEqual(
            ids.map((id, i) => [
                id,
                ['100.00', '150.00', '120.00', '140.00', '100.00', '105.00'][i],
            ]),
        );
        expect(all.entries[2]).toMatchObject({
            type: 'ADJUSTMENT',
            amount: '-30.00',
            debit: '0.00',
            credit: '30.00',
            reason: 'Old book',
            actor: {id: s.userId, fullname: 'Test Owner'},
            sale: null,
            payment: null,
            reverses: null,
            reversedBy: null,
        });

        // 1-15 Nov: opens with 31 Oct's balance; totals cover both pages.
        const range = {from: '2026-11-01', to: '2026-11-15', pageSize: '2'};
        const p1 = await statement(s.token, c.id, range);
        const p2 = await statement(s.token, c.id, {...range, page: '2'});
        for (const page of [p1, p2]) {
            expect(page).toMatchObject({
                from: '2026-11-01',
                to: '2026-11-15',
                openingBalance: all.entries[0].balanceAfter, // the last balanceAfter before `from`
                debitTotal: '70.00',
                creditTotal: '70.00',
                closingBalance: all.entries[4].balanceAfter,
                total: 4,
                pageSize: 2,
            });
        }
        expect([...p1.entries, ...p2.entries].map((e: Entry) => e.id)).toEqual(ids.slice(1, 5));

        const late = await statement(s.token, c.id, {from: '2026-11-16'});
        expect(late).toMatchObject({openingBalance: '100.00', closingBalance: '105.00', total: 1});
        const early = await statement(s.token, c.id, {to: '2026-10-31'});
        expect(early).toMatchObject({openingBalance: '0.00', closingBalance: '100.00', total: 1});
        const none = await statement(s.token, c.id, {from: '2026-12-01'});
        expect(none).toMatchObject({openingBalance: '105.00', closingBalance: '105.00', total: 0});

        const ledger = `/api/v1/customers/${c.id}/ledger`;
        for (const query of [{from: '2026-02-30'}, {to: '2026-13-01'}, {pageSize: '501'}]) {
            await api.get(ledger).query(query).set(bearer(s.token)).expect(400);
        }
        await api.get(`/api/v1/customers/${randomUUID()}/ledger`).set(bearer(s.token)).expect(404);
    });

    it('reconciles a whole udhaar story: credit sales, a return, collections, an adjustment and a reversal', async () => {
        const s = await shop();
        const p = await product(s.token);
        await opening(s.token, p.id, 50);
        const c = await customer(s.token);
        const pay = (amount: string) =>
            api
                .post(`/api/v1/customers/${c.id}/payments`)
                .set(bearer(s.token))
                .send({amount, method: 'CASH', idempotencyKey: randomUUID()})
                .expect(201);

        const inv1 = await creditSale(s, c.id, p.id, 3); // +30.00
        await creditSale(s, c.id, p.id, 4, 15); // +25.00
        const ret = await api
            .post(`/api/v1/sales/${inv1.id}/returns`)
            .set(bearer(s.token))
            .send({
                lines: [{saleLineId: inv1.lines[0].id, quantity: 1, disposition: 'RESTOCK'}],
                reason: 'Changed mind',
                refundMethod: 'CREDIT',
                idempotencyKey: randomUUID(),
            })
            .expect(201); // -10.00
        const first = await pay('20.00');
        await postEntry(s, c.id, {type: 'ADJUSTMENT', amount: '3.50', reason: 'Bag charge'});
        const second = await pay('10.00');
        const rev = await postEntry(s, c.id, {
            type: 'REVERSAL',
            amount: '10.00',
            reason: 'Entered twice',
            reversesId: second.body.data.ledgerEntryId,
        });

        // 30 + 25 - 10 - 20 + 3.50 - 10 + 10
        expect(await reconcile(c.id)).toBe('28.50');
        const st = await statement(s.token, c.id);
        expect(st).toMatchObject({
            openingBalance: '0.00',
            debitTotal: '68.50',
            creditTotal: '40.00',
            closingBalance: '28.50',
        });
        expect(st.entries.map((e: Entry) => [e.type, e.amount, e.balanceAfter])).toEqual([
            ['CREDIT_SALE', '30.00', '30.00'],
            ['CREDIT_SALE', '25.00', '55.00'],
            ['RETURN_CREDIT', '-10.00', '45.00'],
            ['PAYMENT', '-20.00', '25.00'],
            ['ADJUSTMENT', '3.50', '28.50'],
            ['PAYMENT', '-10.00', '18.50'],
            ['REVERSAL', '10.00', '28.50'],
        ]);
        const [sale, , back, paid, , undone, reversal] = st.entries;
        expect(sale.sale).toEqual({id: inv1.id, invoiceNo: inv1.invoiceNo});
        expect(back.saleReturn).toEqual({
            id: ret.body.data.id,
            creditNoteNo: ret.body.data.creditNoteNo,
            saleId: inv1.id,
        });
        expect(paid.payment).toMatchObject({
            id: first.body.data.id,
            receiptNo: first.body.data.receiptNo,
            method: 'CASH',
        });
        expect(undone.reversedBy).toMatchObject({id: rev.id, reason: 'Entered twice'});
        expect(reversal.reverses).toEqual({id: undone.id, type: 'PAYMENT'});
    });
});
