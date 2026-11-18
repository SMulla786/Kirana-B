import {describe, expect, it} from 'vitest';
import {api, bearer, createMember, createOwner, prisma, uniqueName, uniquePhone} from './helpers';

const HELD = '/api/v1/pos/held';

type Body = Record<string, unknown>;

const createProduct = async (token: string, overrides: Body = {}) => {
    const res = await api
        .post('/api/v1/catalog/products')
        .set(bearer(token))
        .send({name: uniqueName('prod'), baseUnit: 'PIECE', sellingPrice: '45.00', ...overrides})
        .expect(201);
    return res.body.data as {id: string; name: string};
};

const hold = (token: string, body: Body) => api.post(HELD).set(bearer(token)).send(body);
const recall = (token: string, id: string, claimKey = 'till-A-key') =>
    api.post(`${HELD}/${id}/recall`).set(bearer(token)).send({claimKey});
const confirm = (token: string, id: string, claimKey = 'till-A-key') =>
    api.delete(`${HELD}/${id}`).query({claimKey}).set(bearer(token));
const line = (productId: string, extra: Body = {}) => ({
    productId,
    unit: 'PIECE',
    quantity: 2,
    ...extra,
});

describe('held bills', () => {
    it('holds, lists, claims and confirms; another till gets 404 while claimed', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        const customer = await api
            .post('/api/v1/customers')
            .set(bearer(token))
            .send({name: 'Asha', phoneNumber: uniquePhone()})
            .expect(201);
        const held = await hold(token, {
            customerId: customer.body.data.id,
            note: 'back soon',
            lines: [line(p.id)],
        }).expect(201);
        expect(held.body.data).toMatchObject({
            note: 'back soon',
            customer: {name: 'Asha'},
            subtotal: '90.00',
            discountTotal: '0.00',
            total: '90.00',
            lines: [
                {
                    productName: p.name,
                    unit: 'PIECE',
                    factor: '1',
                    quantity: '2.000',
                    unitPrice: '45.00',
                    discount: '0.00',
                    lineTotal: '90.00',
                },
            ],
        });
        const id = held.body.data.id as string;

        const list = await api.get(HELD).set(bearer(token)).expect(200);
        expect(list.body.data).toEqual([
            expect.objectContaining({
                id,
                note: 'back soon',
                customer: {id: customer.body.data.id, name: 'Asha'},
                lineCount: 1,
                total: '90.00',
                createdBy: {id: expect.any(String), fullname: 'Test Owner'},
            }),
        ]);

        const recalled = await recall(token, id).expect(200);
        expect(recalled.body.data).toEqual(held.body.data);
        // A lost response is retried with the same key; another till is refused and can't see it.
        await recall(token, id).expect(200);
        await recall(token, id, 'till-B-key').expect(404);
        expect((await api.get(HELD).set(bearer(token))).body.data).toEqual([]);
        await confirm(token, id).expect(204);
        await confirm(token, id).expect(204);
        await recall(token, id).expect(404);
        await recall(token, id, 'short').expect(400);
    });

    it('lets another till take a lapsed claim, and tells the first till on confirm', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        const {id} = (await hold(token, {lines: [line(p.id)]}).expect(201)).body.data;
        await recall(token, id).expect(200);
        // The first till vanished: its claim is older than the 2 min TTL.
        await prisma.heldBill.update({
            where: {id},
            data: {claimedAt: new Date(Date.now() - 3 * 60_000)},
        });
        expect((await api.get(HELD).set(bearer(token))).body.data).toHaveLength(1);
        await recall(token, id, 'till-B-key').expect(200);
        await confirm(token, id).expect(409);
        await confirm(token, id, 'till-B-key').expect(204);
        // Till A's DELETE arrives late, after B confirmed: still 409, never a silent 204.
        await confirm(token, id).expect(409);
        await confirm(token, id, 'till-B-key').expect(204);
        await recall(token, id).expect(404);
        expect((await api.get(HELD).set(bearer(token))).body.data).toEqual([]);
    });

    it('returns the first bill when a hold is retried with the same idempotencyKey', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        const body = {idempotencyKey: uniqueName('hold'), lines: [line(p.id)]};
        const first = await hold(token, body).expect(201);
        const again = await hold(token, body).expect(200);
        expect(again.body.data.id).toBe(first.body.data.id);
        expect((await api.get(HELD).set(bearer(token))).body.data).toHaveLength(1);

        // Two in-flight retries with one key: one creates, the other replays it.
        const race = {idempotencyKey: uniqueName('race'), lines: [line(p.id)]};
        const both = await Promise.all([hold(token, race), hold(token, race)]);
        expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(both[0].body.data.id).toBe(both[1].body.data.id);
    });

    it('never builds the gross from a rounded unit price', async () => {
        const owner = await createOwner();
        const cashier = await createMember(owner.token, 'CASHIER');
        // ₹45 per kg on a gram base: 750 g is ₹33.75, whichever unit the cashier picks.
        const p = await createProduct(owner.token, {
            baseUnit: 'GRAM',
            salesUnit: 'KILOGRAM',
            sellingPrice: '45.00',
        });
        const inGrams = await hold(cashier.token, {
            lines: [{productId: p.id, unit: 'GRAM', quantity: 750}],
        }).expect(201);
        const inKg = await hold(cashier.token, {
            lines: [{productId: p.id, unit: 'KILOGRAM', quantity: '0.75'}],
        }).expect(201);
        for (const res of [inGrams, inKg]) {
            expect(res.body.data).toMatchObject({subtotal: '33.75', total: '33.75'});
        }
        // The rounded per-gram price is display only, and sending it back is not an override.
        expect(inGrams.body.data.lines[0]).toMatchObject({unitPrice: '0.05', gross: '33.75'});
        const echoed = await hold(cashier.token, {
            lines: [{productId: p.id, unit: 'GRAM', quantity: 750, unitPrice: '0.05'}],
        }).expect(201);
        expect(echoed.body.data.lines[0]).toMatchObject({gross: '33.75', priceOverridden: false});
        await hold(owner.token, {
            lines: [{productId: p.id, unit: 'GRAM', quantity: 750, discount: '33.76'}],
        }).expect(400);
    });

    it('snapshots the server price per unit; a different client price needs permission', async () => {
        const owner = await createOwner();
        const cashier = await createMember(owner.token, 'CASHIER');
        const p = await createProduct(owner.token, {units: [{unit: 'PACKET', factor: 12}]});

        const res = await hold(cashier.token, {
            lines: [line(p.id, {unit: 'PACKET', quantity: 2})],
        }).expect(201);
        expect(res.body.data.lines[0]).toMatchObject({unitPrice: '540.00', lineTotal: '1080.00'});

        // The catalogue price may be sent back unchanged; a different one needs the permission.
        await hold(cashier.token, {lines: [line(p.id, {unitPrice: '45.00'})]}).expect(201);
        await hold(cashier.token, {lines: [line(p.id, {unitPrice: '40.00'})]}).expect(403);
    });

    it('prices from the sales unit, and flags overrides and archived products', async () => {
        const owner = await createOwner();
        const cashier = await createMember(owner.token, 'CASHIER');
        // sellingPrice is per sales unit: 240.00 per CARTON of 24 pieces.
        const p = await createProduct(owner.token, {
            units: [{unit: 'CARTON', factor: 24}],
            salesUnit: 'CARTON',
            sellingPrice: '240.00',
            mrp: '250.00',
            purchaseCost: '200.00',
        });
        const piece = await hold(cashier.token, {lines: [line(p.id, {quantity: 3})]}).expect(201);
        expect(piece.body.data.lines[0]).toMatchObject({unitPrice: '10.00', lineTotal: '30.00'});
        expect(piece.body.data.lines[0].priceOverridden).toBe(false);
        // The cashier sees the product without its cost.
        expect(piece.body.data.lines[0].product).toMatchObject({id: p.id, sellingPrice: '240.00'});
        expect(piece.body.data.lines[0].product).not.toHaveProperty('purchaseCost');
        await hold(cashier.token, {lines: [line(p.id, {unitPrice: '10.00'})]}).expect(201);
        await hold(cashier.token, {lines: [line(p.id, {unitPrice: '9.00'})]}).expect(403);
        const carton = await hold(cashier.token, {
            lines: [line(p.id, {unit: 'CARTON', quantity: 1})],
        }).expect(201);
        expect(carton.body.data.lines[0].unitPrice).toBe('240.00');

        const over = await hold(owner.token, {lines: [line(p.id, {unitPrice: '9.00'})]}).expect(
            201,
        );
        expect(over.body.data.lines[0]).toMatchObject({priceOverridden: true, unitPrice: '9.00'});
        expect(over.body.data.lines[0].product).toHaveProperty('purchaseCost', '200.00');

        await api
            .patch('/api/v1/catalog/products/' + p.id)
            .set(bearer(owner.token))
            .send({status: 'ARCHIVED'})
            .expect(200);
        const recalled = await recall(owner.token, over.body.data.id).expect(200);
        expect(recalled.body.data.lines[0]).toMatchObject({product: null, priceOverridden: true});
    });

    it('lets only roles with the permission discount or override the price', async () => {
        const owner = await createOwner();
        const cashier = await createMember(owner.token, 'CASHIER');
        const manager = await createMember(owner.token, 'MANAGER');
        const p = await createProduct(owner.token);

        await hold(cashier.token, {lines: [line(p.id, {discount: '5.00'})]}).expect(403);
        await hold(cashier.token, {lines: [line(p.id, {unitPrice: '30.00'})]}).expect(403);
        await hold(cashier.token, {lines: [line(p.id, {discount: '0'})]}).expect(201);

        const res = await hold(manager.token, {
            lines: [line(p.id, {unitPrice: '30.00', discount: '5.00'})],
        }).expect(201);
        expect(res.body.data).toMatchObject({
            subtotal: '60.00',
            discountTotal: '5.00',
            total: '55.00',
        });
        await hold(manager.token, {lines: [line(p.id, {discount: '90.01'})]}).expect(400);
    });

    it('rejects bad units, fractional counts, missing prices and bad line counts', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        const noPrice = await createProduct(token, {sellingPrice: null});

        await hold(token, {lines: [line(p.id, {unit: 'KILOGRAM'})]}).expect(400);
        await hold(token, {lines: [line(p.id, {unit: 'PACKET'})]}).expect(400);
        await hold(token, {lines: [line(p.id, {quantity: 1.5})]}).expect(400);
        await hold(token, {lines: [line(noPrice.id)]}).expect(400);
        await hold(token, {lines: [line(noPrice.id, {unitPrice: '10.00'})]}).expect(201);
        await hold(token, {lines: []}).expect(400);
        await hold(token, {lines: Array.from({length: 201}, () => line(p.id))}).expect(400);
        await hold(token, {lines: [line(p.id)], extra: 1}).expect(400);
        await hold(token, {lines: Array.from({length: 200}, () => line(p.id))}).expect(201);
    });

    it('computes exact decimal totals with half-up rounding', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token, {baseUnit: 'KILOGRAM', sellingPrice: '99.99'});
        const res = await hold(token, {
            lines: [
                {productId: p.id, unit: 'KILOGRAM', quantity: '0.333', discount: '1.25'},
                {productId: p.id, unit: 'KILOGRAM', quantity: '0.005'},
            ],
        }).expect(201);
        // 0.333 x 99.99 = 33.29667 -> 33.30; 0.005 x 99.99 = 0.49995 -> 0.50
        expect(res.body.data.lines.map((l: {lineTotal: string}) => l.lineTotal)).toEqual([
            '32.05',
            '0.50',
        ]);
        expect(res.body.data).toMatchObject({
            subtotal: '33.80',
            discountTotal: '1.25',
            total: '32.55',
        });
        await hold(token, {
            lines: [{productId: p.id, unit: 'KILOGRAM', quantity: '0.3333'}],
        }).expect(400);
    });

    it('weighs in kg on a gram base without a stored kg unit row', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token, {baseUnit: 'GRAM', sellingPrice: '0.12'});
        const res = await hold(token, {
            lines: [{productId: p.id, unit: 'KILOGRAM', quantity: '1.25'}],
        }).expect(201);
        expect(res.body.data.lines[0]).toMatchObject({
            factor: '1000',
            unitPrice: '120.00',
            lineTotal: '150.00',
        });
        await hold(token, {lines: [{productId: p.id, unit: 'PIECE', quantity: 1}]}).expect(400);
    });

    it('never touches stock, orders or wallets', async () => {
        const {token, kiranaId} = await createOwner();
        const p = await createProduct(token);
        await api
            .post('/api/v1/stock/movements')
            .set(bearer(token))
            .send({productId: p.id, type: 'OPENING', quantity: 10})
            .expect(201);
        const customer = await prisma.client.create({
            data: {name: 'W', address: '', phoneNumber: uniquePhone(), kiranaId},
        });
        await prisma.clientWallet.create({data: {clientId: customer.id, amount: 100}});

        const snapshot = async () => ({
            moves: await prisma.stockMovement.count({where: {product: {kiranaId}}}),
            balances: await prisma.stockBalance.findMany({where: {productId: p.id}}),
            orders: await prisma.order.count({where: {kiranaId}}),
            wallet: await prisma.clientWallet.findUnique({where: {clientId: customer.id}}),
            history: await prisma.clientWalletHistory.count({where: {clientId: customer.id}}),
        });
        const before = await snapshot();
        const res = await hold(token, {customerId: customer.id, lines: [line(p.id)]}).expect(201);
        await recall(token, res.body.data.id).expect(200);
        await confirm(token, res.body.data.id).expect(204);
        await hold(token, {customerId: customer.id, lines: [line(p.id)]}).expect(201);
        expect(await snapshot()).toEqual(before);

        const prod = await api.get(`/api/v1/catalog/products/${p.id}`).set(bearer(token));
        expect(prod.body.data.stock.quantity).toBe('10.000');
    });

    it('keeps one business out of the held bills, products and customers of another', async () => {
        const a = await createOwner();
        const b = await createOwner();
        const p = await createProduct(a.token);
        const pb = await createProduct(b.token);
        const customer = await api
            .post('/api/v1/customers')
            .set(bearer(a.token))
            .send({name: 'Mine', phoneNumber: uniquePhone()})
            .expect(201);
        const held = await hold(a.token, {lines: [line(p.id)]}).expect(201);

        expect((await api.get(HELD).set(bearer(b.token)).expect(200)).body.data).toEqual([]);
        await recall(b.token, held.body.data.id).expect(404);
        await confirm(b.token, held.body.data.id).expect(204); // nothing of B's to delete
        expect(await prisma.heldBill.count({where: {id: held.body.data.id}})).toBe(1);
        await hold(b.token, {lines: [line(p.id)]}).expect(404);
        await hold(b.token, {customerId: customer.body.data.id, lines: [line(pb.id)]}).expect(404);
        // Still there for its owner.
        await recall(a.token, held.body.data.id).expect(200);
    });

    it('needs pos.use', async () => {
        const owner = await createOwner();
        const staff = await createMember(owner.token, 'STAFF');
        await api.get(HELD).set(bearer(staff.token)).expect(403);
    });
});
