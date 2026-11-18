import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {financialYearOf} from '../src/services/kirana/billing';
import {api, bearer, createMember, createOwner, prisma, uniqueName, uniquePhone} from './helpers';

type Body = Record<string, unknown>;
const SALES = '/api/v1/pos/sales';
const GSTIN = '27AAPFU0939F1ZV';

const product = async (token: string, overrides: Body = {}) => {
    const res = await api
        .post('/api/v1/catalog/products')
        .set(bearer(token))
        .send({name: uniqueName('prod'), baseUnit: 'PIECE', sellingPrice: '45.00', ...overrides})
        .expect(201);
    return res.body.data as {id: string};
};
const opening = (token: string, productId: string, quantity: number) =>
    api
        .post('/api/v1/stock/movements')
        .set(bearer(token))
        .send({productId, type: 'OPENING', quantity})
        .expect(201);
const customer = async (token: string) =>
    (
        await api
            .post('/api/v1/customers')
            .set(bearer(token))
            .send({name: uniqueName('cust'), phoneNumber: uniquePhone()})
            .expect(201)
    ).body.data as {id: string};
const settings = (token: string, body: Body) =>
    api.patch('/api/v1/business').set(bearer(token)).send(body);
const checkout = (token: string, body: Body) =>
    api.post('/api/v1/pos/checkout').set(bearer(token)).send(body);
const sell = (token: string, body: Body) =>
    api
        .post(SALES)
        .set(bearer(token))
        .send({idempotencyKey: randomUUID(), ...body});
const cash = (amount: string, tendered?: string) => ({
    method: 'CASH',
    amount,
    ...(tendered ? {tendered} : {}),
});
const line = (productId: string, quantity: number | string = 1, extra: Body = {}) => ({
    productId,
    unit: 'PIECE',
    quantity,
    ...extra,
});
const balance = async (productId: string) =>
    Number((await prisma.stockBalance.findFirst({where: {productId}}))?.quantity ?? 0);
const short = () => {
    const fy = financialYearOf(new Date());
    return `${fy.slice(2, 4)}-${fy.slice(5)}`;
};

describe('checkout and sales', () => {
    it('completes a cash sale: invoice, snapshot lines, payment, change and SALE movements', async () => {
        const {token} = await createOwner();
        const p = await product(token);
        await opening(token, p.id, 10);
        const res = await sell(token, {
            lines: [line(p.id, 2)],
            payments: [cash('90.00', '100.00')],
        }).expect(201);
        const sale = res.body.data;
        expect(sale.invoiceNo).toBe(`INV/${short()}/00001`);
        expect(sale.gstScheme).toBe('UNREGISTERED');
        expect(sale).toMatchObject({
            subtotal: '90.00',
            total: '90.00',
            roundOff: '0.00',
            changeDue: '10.00',
        });
        expect(sale.lines[0]).toMatchObject({
            quantity: '2.000',
            unitPrice: '45.00',
            gross: '90.00',
            gstRate: '0.00',
            taxableValue: '90.00',
            total: '90.00',
            returnedQuantity: '0.000',
        });
        expect(sale.payments).toEqual([
            expect.objectContaining({
                method: 'CASH',
                amount: '90.00',
                tendered: '100.00',
                status: 'RECORDED',
            }),
        ]);
        expect(await balance(p.id)).toBe(8);
        const movement = await prisma.stockMovement.findUniqueOrThrow({
            where: {id: sale.lines[0].stockMovementId},
        });
        expect(movement).toMatchObject({type: 'SALE', reference: sale.invoiceNo});
        expect(Number(movement.quantity)).toBe(-2);

        const second = await sell(token, {lines: [line(p.id)], payments: [cash('45.00')]}).expect(
            201,
        );
        expect(second.body.data.invoiceNo).toBe(`INV/${short()}/00002`);
    });

    it('prices and rounds on the server: 750 g at ₹45/kg is ₹33.75, payable ₹34', async () => {
        const {token} = await createOwner();
        const p = await product(token, {
            baseUnit: 'GRAM',
            salesUnit: 'KILOGRAM',
            sellingPrice: '45.00',
        });
        const preview = await checkout(token, {
            lines: [{productId: p.id, unit: 'GRAM', quantity: 750}],
        }).expect(200);
        expect(preview.body.data).toMatchObject({
            roundOffRule: 'NEAREST_1',
            subtotal: '33.75',
            roundOff: '0.25',
            total: '34.00',
        });
        await settings(token, {roundOff: 'NONE'}).expect(200);
        const exact = await checkout(token, {
            lines: [{productId: p.id, unit: 'KILOGRAM', quantity: '0.75'}],
        }).expect(200);
        expect(exact.body.data).toMatchObject({total: '33.75', roundOff: '0.00'});
    });

    it('splits GST into CGST + SGST for a REGULAR business, inclusive and exclusive prices', async () => {
        const {token} = await createOwner();
        await settings(token, {gstScheme: 'REGULAR'}).expect(400); // no GSTIN yet
        await settings(token, {gstin: GSTIN, gstScheme: 'REGULAR', roundOff: 'NONE'}).expect(200);
        const inclusive = await product(token, {sellingPrice: '105.00', gstRate: 5});
        const exclusive = await product(token, {
            sellingPrice: '100.00',
            gstRate: 18,
            priceIncludesTax: false,
        });
        const res = await sell(token, {
            lines: [line(inclusive.id), line(exclusive.id, 1, {discount: '10.00'})],
            payments: [cash('211.20')],
        }).expect(201);
        const sale = res.body.data;
        expect(sale.seller).toMatchObject({gstin: GSTIN});
        expect(sale.lines[0]).toMatchObject({
            gstRate: '5.00',
            taxableValue: '100.00',
            cgst: '2.50',
            sgst: '2.50',
            total: '105.00',
        });
        // ₹100 - ₹10 discount = ₹90 taxable; 18% = ₹16.20 on top
        expect(sale.lines[1]).toMatchObject({
            taxableValue: '90.00',
            cgst: '8.10',
            sgst: '8.10',
            total: '106.20',
        });
        expect(sale).toMatchObject({
            taxableTotal: '190.00',
            cgstTotal: '10.60',
            sgstTotal: '10.60',
            discountTotal: '10.00',
            total: '211.20',
        });
    });

    it('charges no tax on a COMPOSITION bill of supply', async () => {
        const {token} = await createOwner();
        await settings(token, {gstin: GSTIN, gstScheme: 'COMPOSITION'}).expect(200);
        const p = await product(token, {sellingPrice: '105.00', gstRate: 5});
        const res = await checkout(token, {lines: [line(p.id)]}).expect(200);
        expect(res.body.data).toMatchObject({
            gstScheme: 'COMPOSITION',
            cgstTotal: '0.00',
            sgstTotal: '0.00',
            total: '105.00',
        });
    });

    it('needs split payments to add up exactly, and tendered only on cash', async () => {
        const {token} = await createOwner();
        const p = await product(token);
        const lines = [line(p.id, 2)];
        const short1 = await sell(token, {lines, payments: [cash('80.00')]}).expect(400);
        expect(short1.body.errors[0]).toMatchObject({payable: '90.00', paid: '80.00'});
        await sell(token, {
            lines,
            payments: [cash('50.00'), {method: 'UPI', amount: '50.00'}],
        }).expect(400);
        await sell(token, {lines, payments: [cash('90.00', '80.00')]}).expect(400);
        await sell(token, {
            lines,
            payments: [{method: 'UPI', amount: '90.00', tendered: '90.00'}],
        }).expect(400);
        const ok = await sell(token, {
            lines,
            payments: [
                cash('40.00', '50.00'),
                {method: 'UPI', amount: '30.00', reference: 'UTR123'},
                {method: 'CARD', amount: '15.00'},
                {method: 'BANK_TRANSFER', amount: '5.00'},
            ],
        }).expect(201);
        expect(ok.body.data.changeDue).toBe('10.00');
        // UPI is only ever recorded by the cashier, never bank-confirmed (O-10).
        expect(ok.body.data.payments.map((x: {status: string}) => x.status)).toEqual([
            'RECORDED',
            'RECORDED',
            'RECORDED',
            'RECORDED',
        ]);
        // A refused sale takes no invoice number and moves no stock.
        expect(await prisma.sale.count({where: {lines: {some: {productId: p.id}}}})).toBe(1);
        expect(ok.body.data.invoiceNo).toBe(`INV/${short()}/00001`);
    });

    it('posts credit to the customer account; credit needs a customer and pos.credit', async () => {
        const owner = await createOwner();
        const p = await product(owner.token);
        const c = await customer(owner.token);
        const lines = [line(p.id, 2)];
        await sell(owner.token, {lines, payments: [{method: 'CREDIT', amount: '90.00'}]}).expect(
            400,
        );
        const cashier = await createMember(owner.token, 'CASHIER');
        await sell(cashier.token, {
            customerId: c.id,
            lines,
            payments: [{method: 'CREDIT', amount: '90.00'}],
        }).expect(403);
        const res = await sell(owner.token, {
            customerId: c.id,
            lines,
            payments: [cash('40.00'), {method: 'CREDIT', amount: '50.00'}],
        }).expect(201);
        const entries = await prisma.customerLedgerEntry.findMany({where: {customerId: c.id}});
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({type: 'CREDIT_SALE', saleId: res.body.data.id});
        expect(Number(entries[0].amount)).toBe(50);
        expect(Number(entries[0].balanceAfter)).toBe(50);
        const bal = await prisma.customerBalance.findUniqueOrThrow({where: {customerId: c.id}});
        expect(Number(bal.balance)).toBe(50);
        expect(res.body.data.customer).toMatchObject({id: c.id});
    });

    it('replays a retried sale, never a second invoice, payment set or stock movement', async () => {
        const {token} = await createOwner();
        const p = await product(token);
        await opening(token, p.id, 10);
        const body = {
            lines: [line(p.id, 2)],
            payments: [cash('90.00')],
            idempotencyKey: randomUUID(),
        };
        const first = await sell(token, body).expect(201);
        const again = await sell(token, body).expect(200);
        expect(again.body.data.id).toBe(first.body.data.id);
        const [a, b] = await Promise.all([
            sell(token, {...body, idempotencyKey: 'concurrent-' + randomUUID()}),
            sell(token, {...body, idempotencyKey: body.idempotencyKey}),
        ]);
        expect(b.status).toBe(200);
        expect(a.status).toBe(201);
        // Two in-flight requests with one new key: one sale, the other replays it.
        const key = randomUUID();
        const [x, y] = await Promise.all([
            sell(token, {...body, idempotencyKey: key}),
            sell(token, {...body, idempotencyKey: key}),
        ]);
        expect([x.status, y.status].sort()).toEqual([200, 201]);
        expect(x.body.data.id).toBe(y.body.data.id);
        expect(
            await prisma.sale.count({
                where: {
                    kiranaId: (
                        await prisma.sale.findUniqueOrThrow({where: {id: first.body.data.id}})
                    ).kiranaId,
                },
            }),
        ).toBe(3);
        expect(await prisma.salePayment.count({where: {saleId: x.body.data.id}})).toBe(1);
        expect(await balance(p.id)).toBe(10 - 2 * 3);
    });

    it('keeps the bill historically stable after the catalogue price changes', async () => {
        const {token} = await createOwner();
        const p = await product(token);
        const res = await sell(token, {lines: [line(p.id)], payments: [cash('45.00')]}).expect(201);
        await api
            .patch(`/api/v1/catalog/products/${p.id}`)
            .set(bearer(token))
            .send({sellingPrice: '99.00', mrp: '120.00'})
            .expect(200);
        const again = await prisma.saleLine.findFirstOrThrow({where: {saleId: res.body.data.id}});
        expect(again.unitPrice.toFixed(2)).toBe('45.00');
        expect(again.total.toFixed(2)).toBe('45.00');
    });

    it('enforces discount/price permissions and keeps tenants apart', async () => {
        const owner = await createOwner();
        const other = await createOwner();
        const p = await product(owner.token);
        const theirs = await customer(other.token);
        const cashier = await createMember(owner.token, 'CASHIER');
        await sell(cashier.token, {
            lines: [line(p.id, 1, {discount: '5.00'})],
            payments: [cash('40.00')],
        }).expect(403);
        await sell(cashier.token, {
            lines: [line(p.id, 1, {unitPrice: '40.00'})],
            payments: [cash('40.00')],
        }).expect(403);
        await sell(other.token, {lines: [line(p.id)], payments: [cash('45.00')]}).expect(404);
        await sell(owner.token, {
            customerId: theirs.id,
            lines: [line(p.id)],
            payments: [cash('45.00')],
        }).expect(404);
        const staff = await createMember(owner.token, 'STAFF');
        await sell(staff.token, {lines: [line(p.id)], payments: [cash('45.00')]}).expect(403);
        await checkout(staff.token, {lines: [line(p.id)]}).expect(403);
    });
});
