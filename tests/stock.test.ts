import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {api, bearer, createOwner, prisma, uniqueName} from './helpers';

const CAT = '/api/v1/catalog';
const STOCK = '/api/v1/stock/movements';

type Movement = {
    type: string;
    reason: string | null;
    reference: string | null;
    productId: string;
    createdAt: string;
    actor: {id: string; fullname: string};
};

const createProduct = async (token: string, overrides: Record<string, unknown> = {}) => {
    const res = await api
        .post(`${CAT}/products`)
        .set(bearer(token))
        .send({name: uniqueName('prod'), baseUnit: 'PIECE', ...overrides})
        .expect(201);
    return res.body.data as {id: string; name: string};
};

const move = (token: string, body: Record<string, unknown>) =>
    api.post(STOCK).set(bearer(token)).send(body);

const list = async (token: string, productId: string) => {
    const res = await api.get(`${STOCK}?productId=${productId}`).set(bearer(token)).expect(200);
    return res.body.data as {total: number; items: Movement[]};
};

const dbTotal = async (productId: string) => {
    const rows = await prisma.$queryRaw<{total: string}[]>`
        SELECT COALESCE(SUM(quantity), 0)::text AS total FROM "StockMovement"
        WHERE "productId"::text = ${productId}`;
    return Number(rows[0].total);
};

describe('stock ledger', () => {
    it('keeps a running balance and signed quantities', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        const steps: [Record<string, unknown>, string, string][] = [
            [{type: 'OPENING', quantity: 10}, '10.000', '10.000'],
            [{type: 'DAMAGE', quantity: 2, reason: 'dropped'}, '-2.000', '8.000'],
            [{type: 'ADJUSTMENT', quantity: -3, reason: 'recount'}, '-3.000', '5.000'],
            [{type: 'ADJUSTMENT', quantity: 5, reason: 'found stock'}, '5.000', '10.000'],
        ];
        for (const [body, qty, after] of steps) {
            const res = await move(token, {productId: p.id, ...body}).expect(201);
            expect(res.body.data).toMatchObject({quantity: qty, balanceAfter: after});
        }
        const prod = await api.get(`${CAT}/products/${p.id}`).set(bearer(token)).expect(200);
        expect(prod.body.data.stock.quantity).toBe('10.000');
    });

    it('reconciles StockBalance with the sum of movements', async () => {
        const {token, kiranaId} = await createOwner();
        for (const qty of [7, 12]) {
            const p = await createProduct(token);
            await move(token, {productId: p.id, type: 'OPENING', quantity: qty}).expect(201);
            await move(token, {
                productId: p.id,
                type: 'EXPIRY',
                quantity: 1,
                reason: 'old',
            }).expect(201);
        }
        const rows = await prisma.$queryRaw<{bal: string; sum: string}[]>`
            SELECT b.quantity::text AS bal,
                COALESCE((SELECT SUM(m.quantity) FROM "StockMovement" m
                    WHERE m."productId" = b."productId" AND m."storeId" = b."storeId"), 0)::text AS sum
            FROM "StockBalance" b WHERE b."kiranaId"::text = ${kiranaId}`;
        expect(rows.length).toBeGreaterThanOrEqual(2);
        for (const r of rows) expect(Number(r.bal)).toBe(Number(r.sum));
    });

    it('rejects a second OPENING and over-stock outbound without writing', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        await move(token, {productId: p.id, type: 'OPENING', quantity: 5}).expect(201);
        await move(token, {productId: p.id, type: 'OPENING', quantity: 5}).expect(409);
        await move(token, {productId: p.id, type: 'DAMAGE', quantity: 999, reason: 'x'}).expect(
            409,
        );
        expect(await dbTotal(p.id)).toBe(5);
        expect((await list(token, p.id)).total).toBe(1);
    });

    it('requires a reason for DAMAGE, EXPIRY and ADJUSTMENT', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        await move(token, {productId: p.id, type: 'OPENING', quantity: 10}).expect(201);
        for (const [type, quantity] of [
            ['DAMAGE', 1],
            ['EXPIRY', 1],
            ['ADJUSTMENT', -1],
        ] as const) {
            await move(token, {productId: p.id, type, quantity}).expect(400);
        }
        expect(await dbTotal(p.id)).toBe(10);
    });

    it('is idempotent on idempotencyKey', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token);
        const body = {productId: p.id, type: 'OPENING', quantity: 4, idempotencyKey: randomUUID()};
        const first = await move(token, body);
        const second = await move(token, body);
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body.data.id).toBe(first.body.data.id);
        expect((await list(token, p.id)).total).toBe(1);
        expect(await dbTotal(p.id)).toBe(4);
    });

    it('records actor, type, reason, reference and createdAt', async () => {
        const owner = await createOwner();
        const p = await createProduct(owner.token);
        await move(owner.token, {productId: p.id, type: 'OPENING', quantity: 6}).expect(201);
        const reference = uniqueName('ref');
        await move(owner.token, {
            productId: p.id,
            type: 'DAMAGE',
            quantity: 1,
            reason: 'leaked',
            reference,
        }).expect(201);
        const {items} = await list(owner.token, p.id);
        const dmg = items.find((m) => m.type === 'DAMAGE');
        expect(dmg).toMatchObject({reason: 'leaked', reference, productId: p.id});
        expect(dmg?.actor).toMatchObject({fullname: owner.payload.fullname});
        expect(typeof dmg?.actor.id).toBe('string');
        expect(Number.isNaN(Date.parse(dmg?.createdAt ?? ''))).toBe(false);
    });

    it('scopes movements to the tenant', async () => {
        const [A, B] = [await createOwner(), await createOwner()];
        const p = await createProduct(B.token);
        await move(B.token, {productId: p.id, type: 'OPENING', quantity: 3}).expect(201);
        await move(A.token, {productId: p.id, type: 'OPENING', quantity: 3}).expect(404);
        const all = await api.get(STOCK).set(bearer(A.token)).expect(200);
        expect(JSON.stringify(all.body.data)).not.toContain(p.id);
        expect(await dbTotal(p.id)).toBe(3);
    });
});
