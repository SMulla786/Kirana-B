import {randomUUID} from 'node:crypto';
import {MembershipRole} from '@prisma/client';
import {describe, expect, it} from 'vitest';
import {api, bearer, createMember, createOwner, uniqueName} from './helpers';

const CAT = '/api/v1/catalog';
const MOV = '/api/v1/stock/movements';

type Body = Record<string, unknown>;

const createProduct = async (token: string, overrides: Body = {}, status = 201) => {
    const res = await api
        .post(`${CAT}/products`)
        .set(bearer(token))
        .send({name: uniqueName('prod'), baseUnit: 'PIECE', ...overrides})
        .expect(status);
    return res.body.data as Body & {id: string};
};

const move = (token: string, body: Body) =>
    api
        .post(MOV)
        .set(bearer(token))
        .send({type: 'OPENING', ...body});

const stockOf = async (token: string, id: string) => {
    const res = await api.get(`${CAT}/products/${id}`).set(bearer(token)).expect(200);
    return (res.body.data.stock as {quantity: string}).quantity;
};

describe('catalogue products', () => {
    it('creates, reads, updates and searches by name, alias, SKU and barcode', async () => {
        const {token} = await createOwner();
        const tag = uniqueName('tag');
        const sku = uniqueName('sku');
        const code = uniqueName('bc');
        const alias = uniqueName('alias');
        const p = await createProduct(token, {
            name: `Soap ${tag}`,
            sku,
            barcodes: [{code}],
            aliases: [alias],
            sellingPrice: 45,
            mrp: '50',
        });
        expect(p).toMatchObject({
            sku,
            status: 'ACTIVE',
            baseUnit: 'PIECE',
            sellingPrice: '45.00',
            mrp: '50.00',
            aliases: [alias],
        });

        for (const q of [tag, alias, sku, code]) {
            const res = await api.get(`${CAT}/products`).query({q}).set(bearer(token)).expect(200);
            expect(res.body.data.items.map((i: {id: string}) => i.id)).toEqual([p.id]);
            expect(res.body.data.total).toBe(1);
        }

        const upd = await api
            .patch(`${CAT}/products/${p.id}`)
            .set(bearer(token))
            .send({name: `Soap2 ${tag}`, aliases: []})
            .expect(200);
        expect(upd.body.data).toMatchObject({name: `Soap2 ${tag}`, aliases: []});
    });

    it('archives and unarchives via PATCH status; lookup ignores archived', async () => {
        const {token} = await createOwner();
        const code = uniqueName('bc');
        const p = await createProduct(token, {barcodes: [{code}]});
        const ids = async (status?: string) => {
            const res = await api
                .get(`${CAT}/products`)
                .query({q: p.name as string, ...(status ? {status} : {})})
                .set(bearer(token))
                .expect(200);
            return res.body.data.items.map((i: {id: string}) => i.id);
        };

        await api
            .patch(`${CAT}/products/${p.id}`)
            .set(bearer(token))
            .send({status: 'ARCHIVED'})
            .expect(200);
        expect(await ids()).toEqual([]);
        expect(await ids('ARCHIVED')).toEqual([p.id]);
        expect(await ids('ALL')).toEqual([p.id]);
        await api.get(`${CAT}/lookup`).query({code}).set(bearer(token)).expect(404);

        await api
            .patch(`${CAT}/products/${p.id}`)
            .set(bearer(token))
            .send({status: 'ACTIVE'})
            .expect(200);
        expect(await ids()).toEqual([p.id]);
        const look = await api.get(`${CAT}/lookup`).query({code}).set(bearer(token)).expect(200);
        expect(look.body.data.product.id).toBe(p.id);
    });

    it('keeps products, prices, stock and lookup inside the tenant', async () => {
        const [A, B] = [await createOwner(), await createOwner()];
        const code = uniqueName('bc');
        const p = await createProduct(B.token, {barcodes: [{code}], sellingPrice: 10, mrp: 12});
        await move(B.token, {productId: p.id, quantity: 7}).expect(201);

        for (const id of [p.id, randomUUID()]) {
            await api.get(`${CAT}/products/${id}`).set(bearer(A.token)).expect(404);
            await api
                .patch(`${CAT}/products/${id}`)
                .set(bearer(A.token))
                .send({name: 'hijack'})
                .expect(404);
            await api.get(`${CAT}/products/${id}/prices`).set(bearer(A.token)).expect(404);
            await api.get(MOV).query({productId: id}).set(bearer(A.token)).expect(404);
        }
        await api.get(`${CAT}/lookup`).query({code}).set(bearer(A.token)).expect(404);
        await api.get(`${CAT}/lookup`).query({code: p.id}).set(bearer(A.token)).expect(404);
        await api.get(`${CAT}/lookup`).query({code: randomUUID()}).set(bearer(A.token)).expect(404);

        // B's barcode is free for A
        await createProduct(A.token, {barcodes: [{code}]});
    });

    it('rejects duplicate barcode, SKU and name with 409 details', async () => {
        const {token} = await createOwner();
        const sku = uniqueName('sku');
        const code = uniqueName('bc');
        const p = await createProduct(token, {sku, barcodes: [{code}]});
        const expected = {
            productId: p.id,
            productName: p.name,
            status: 'ACTIVE',
        };

        const cases: [Body, string][] = [
            [{barcodes: [{code}]}, 'barcode'],
            [{sku}, 'sku'],
            [{name: p.name}, 'name'],
        ];
        for (const [extra, field] of cases) {
            const res = await api
                .post(`${CAT}/products`)
                .set(bearer(token))
                .send({name: uniqueName('dup'), baseUnit: 'PIECE', ...extra})
                .expect(409);
            expect(res.body.errors[0]).toMatchObject({field, ...expected});
        }
    });

    it('rejects a barcode repeated inside one payload with 400', async () => {
        const {token} = await createOwner();
        const code = uniqueName('bc');
        await createProduct(token, {barcodes: [{code}, {code}]}, 400);
    });
});

describe('catalogue units and stock quantities', () => {
    it('handles a carton over a piece base', async () => {
        const {token} = await createOwner();
        const code = uniqueName('bc');
        const p = await createProduct(token, {
            units: [{unit: 'CARTON', factor: 24}],
            barcodes: [{code, unit: 'CARTON'}],
        });
        const look = await api.get(`${CAT}/lookup`).query({code}).set(bearer(token)).expect(200);
        expect(look.body.data).toMatchObject({unit: 'CARTON', factor: '24'});

        await move(token, {productId: p.id, quantity: 0.5, unit: 'CARTON'}).expect(201);
        expect(await stockOf(token, p.id)).toBe('12.000');
    });

    it('rejects a fractional count-unit movement on a piece base', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token, {units: [{unit: 'BOX', factor: 5}]});
        await move(token, {productId: p.id, quantity: 0.3, unit: 'BOX'}).expect(400);
        await move(token, {productId: p.id, quantity: 2, unit: 'BOX'}).expect(201);
        expect(await stockOf(token, p.id)).toBe('10.000');
    });

    it('validates weight unit factors', async () => {
        const {token} = await createOwner();
        await createProduct(token, {baseUnit: 'GRAM', units: [{unit: 'KILOGRAM', factor: 1000}]});
        await createProduct(
            token,
            {baseUnit: 'GRAM', units: [{unit: 'KILOGRAM', factor: 999}]},
            400,
        );
        await createProduct(
            token,
            {baseUnit: 'PIECE', units: [{unit: 'KILOGRAM', factor: 1}]},
            400,
        );
    });

    it('converts loose weights and rejects sub-gram precision', async () => {
        const {token} = await createOwner();
        const loose = await createProduct(token, {
            baseUnit: 'GRAM',
            units: [{unit: 'KILOGRAM', factor: 1000}],
        });
        await move(token, {productId: loose.id, quantity: 1.25, unit: 'KILOGRAM'}).expect(201);
        expect(await stockOf(token, loose.id)).toBe('1250.000');

        const kg = await createProduct(token, {baseUnit: 'KILOGRAM'});
        await move(token, {productId: kg.id, quantity: 0.0001, unit: 'KILOGRAM'}).expect(400);
    });

    it('guards baseUnit and salesUnit changes on PATCH', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token, {
            units: [{unit: 'BOX', factor: 5}],
            sellingPrice: 10,
            mrp: 12,
        });
        const patch = (body: Body) =>
            api.patch(`${CAT}/products/${p.id}`).set(bearer(token)).send(body);
        await patch({baseUnit: 'GRAM'}).expect(400);
        await patch({salesUnit: 'BOX'}).expect(400);
        await patch({salesUnit: 'BOX', sellingPrice: 50, mrp: 60}).expect(200);
    });

    it('stores implied fixed metric units used as sales, purchase or barcode units', async () => {
        const {token} = await createOwner();
        const factors = (p: Body) =>
            Object.fromEntries(
                (p.units as {unit: string; factor: string}[]).map((u) => [u.unit, u.factor]),
            );
        const p = await createProduct(token, {baseUnit: 'GRAM', salesUnit: 'KILOGRAM'});
        expect(factors(p)).toEqual({GRAM: '1', KILOGRAM: '1000'});

        const code = uniqueName('bc');
        const q = await createProduct(token, {
            baseUnit: 'MILLILITRE',
            barcodes: [{code, unit: 'LITRE'}],
        });
        expect(factors(q)).toEqual({MILLILITRE: '1', LITRE: '1000'});
        const hit = await api.get(`${CAT}/lookup?code=${code}`).set(bearer(token)).expect(200);
        expect(hit.body.data).toMatchObject({unit: 'LITRE', factor: '1000'});

        const r = await createProduct(token, {baseUnit: 'GRAM'});
        const patched = await api
            .patch(`${CAT}/products/${r.id}`)
            .set(bearer(token))
            .send({purchaseUnit: 'KILOGRAM', purchaseCost: 40})
            .expect(200);
        expect(factors(patched.body.data)).toEqual({GRAM: '1', KILOGRAM: '1000'});
        // Pack and cross-dimension units still need an explicit, valid factor.
        await createProduct(token, {baseUnit: 'GRAM', salesUnit: 'PACKET'}, 400);
        await createProduct(token, {baseUnit: 'GRAM', salesUnit: 'LITRE'}, 400);
    });
});

describe('catalogue price history', () => {
    it('appends a price row and leaves old rows and movement cost untouched', async () => {
        const {token} = await createOwner();
        const p = await createProduct(token, {sellingPrice: 10, mrp: 12, purchaseCost: 7});
        await move(token, {productId: p.id, quantity: 5, unitCost: 7}).expect(201);
        const prices = async () => {
            const res = await api
                .get(`${CAT}/products/${p.id}/prices`)
                .set(bearer(token))
                .expect(200);
            return res.body.data as {sellingPrice: string}[];
        };
        const movements = async () => {
            const res = await api.get(MOV).query({productId: p.id}).set(bearer(token)).expect(200);
            return res.body.data.items as {unitCost: string}[];
        };
        const before = await prices();
        const costBefore = (await movements())[0].unitCost;

        await api
            .patch(`${CAT}/products/${p.id}`)
            .set(bearer(token))
            .send({sellingPrice: 15})
            .expect(200);

        const after = await prices();
        expect(after).toHaveLength(before.length + 1);
        expect(after[0].sellingPrice).toBe('15.00');
        expect(after.slice(1)).toEqual(before);
        expect((await movements())[0].unitCost).toBe(costBefore);
    });
});

describe('catalogue permissions', () => {
    it('hides cost from cashiers and blocks their writes', async () => {
        const owner = await createOwner();
        const cashier = await createMember(owner.token, MembershipRole.CASHIER);
        const code = uniqueName('bc');
        const p = await createProduct(owner.token, {
            barcodes: [{code}],
            sellingPrice: 10,
            mrp: 12,
            purchaseCost: 7,
        });
        const asOwner = await api
            .get(`${CAT}/products/${p.id}`)
            .set(bearer(owner.token))
            .expect(200);
        expect(asOwner.body.data.purchaseCost).toBe('7.00');

        const list = await api.get(`${CAT}/products`).set(bearer(cashier.token)).expect(200);
        expect(list.body.data.items.length).toBeGreaterThan(0);
        for (const item of list.body.data.items) expect(item).not.toHaveProperty('purchaseCost');
        const one = await api.get(`${CAT}/products/${p.id}`).set(bearer(cashier.token)).expect(200);
        expect(one.body.data).not.toHaveProperty('purchaseCost');
        const look = await api.get(`${CAT}/lookup`).query({code}).set(bearer(cashier.token));
        expect(look.status).toBe(200);
        expect(look.body.data.product).not.toHaveProperty('purchaseCost');

        await api
            .post(`${CAT}/products`)
            .set(bearer(cashier.token))
            .send({name: uniqueName('p'), baseUnit: 'PIECE'})
            .expect(403);
        await move(cashier.token, {productId: p.id, quantity: 1}).expect(403);
    });

    it('lets an inventory manager move stock and see cost', async () => {
        const owner = await createOwner();
        const im = await createMember(owner.token, MembershipRole.INVENTORY_MANAGER);
        const p = await createProduct(owner.token, {purchaseCost: 7});
        await move(im.token, {productId: p.id, quantity: 3}).expect(201);
        const res = await api.get(`${CAT}/products/${p.id}`).set(bearer(im.token)).expect(200);
        expect(res.body.data.purchaseCost).toBe('7.00');
    });
});
