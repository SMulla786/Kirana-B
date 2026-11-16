import {describe, expect, it} from 'vitest';
import {api, bearer, createOwner, uniqueName} from './helpers';

const CAT = '/api/v1/catalog';

type Row = Record<string, string>;

const productTotal = async (token: string) => {
    const res = await api
        .get(`${CAT}/products?status=ALL&pageSize=100`)
        .set(bearer(token))
        .expect(200);
    return res.body.data.total as number;
};

const importRows = (token: string, rows: Row[], dryRun: boolean) =>
    api.post(`${CAT}/import`).set(bearer(token)).send({rows, dryRun});

const goodRow = (overrides: Row = {}): Row => ({
    name: uniqueName('item'),
    baseUnit: 'PIECE',
    sellingPrice: '10',
    mrp: '12',
    ...overrides,
});

describe('catalogue import', () => {
    // Rows: 1 good, 2 bad unit, 3+4 same barcode, 5 existing product name.
    const badRows = async (token: string) => {
        const existing = uniqueName('existing');
        await api
            .post(`${CAT}/products`)
            .set(bearer(token))
            .send({name: existing, baseUnit: 'PIECE'})
            .expect(201);
        const bc = uniqueName('bc');
        return [
            goodRow(),
            goodRow({baseUnit: 'BUCKET'}),
            goodRow({barcodes: bc}),
            goodRow({barcodes: bc}),
            goodRow({name: existing}),
        ];
    };

    it('dry run reports only bad rows and writes nothing', async () => {
        const {token} = await createOwner();
        const rows = await badRows(token);
        const before = await productTotal(token);
        const res = await importRows(token, rows, true).expect(200);
        expect(res.body.data.valid).toBe(false);
        const reported = res.body.data.rows as {row: number; errors: {field: string}[]}[];
        const nums = reported.map((r) => r.row);
        expect(nums).toEqual(expect.arrayContaining([2, 5]));
        expect(nums).not.toContain(1);
        expect(nums.some((n) => n === 3 || n === 4)).toBe(true);
        expect(reported.find((r) => r.row === 2)?.errors[0].field).toBe('baseUnit');
        for (const r of reported) expect(r.errors.length).toBeGreaterThan(0);
        expect(await productTotal(token)).toBe(before);
    });

    it('commit with bad rows returns 422 and writes nothing', async () => {
        const {token} = await createOwner();
        const rows = await badRows(token);
        const before = await productTotal(token);
        const res = await importRows(token, rows, false).expect(422);
        const errors = res.body.errors as {row: number; field: string; message: string}[];
        expect(errors.length).toBeGreaterThan(0);
        for (const e of errors) {
            expect(e).toMatchObject({
                row: expect.any(Number),
                field: expect.any(String),
                message: expect.any(String),
            });
        }
        expect(await productTotal(token)).toBe(before);
    });

    it('commits good rows with new category/brand, unit aliases and opening stock', async () => {
        const {token} = await createOwner();
        const category = uniqueName('cat');
        const brand = uniqueName('brand');
        const a = goodRow({baseUnit: 'kg', category, brand, openingStock: '12.5'});
        const b = goodRow({baseUnit: 'pcs', category, brand, openingStock: '7'});
        const before = await productTotal(token);

        const done = await importRows(token, [a, b], false).expect(201);
        expect(done.body.data.valid).toBe(true);
        expect(JSON.stringify(done.body.data.newCategories)).toContain(category);
        expect(JSON.stringify(done.body.data.newBrands)).toContain(brand);
        expect(await productTotal(token)).toBe(before + 2);

        const cats = await api.get(`${CAT}/categories`).set(bearer(token)).expect(200);
        const brands = await api.get(`${CAT}/brands`).set(bearer(token)).expect(200);
        expect(JSON.stringify(cats.body.data)).toContain(category);
        expect(JSON.stringify(brands.body.data)).toContain(brand);

        const expected: [Row, string, string][] = [
            [a, 'KILOGRAM', '12.500'],
            [b, 'PIECE', '7.000'],
        ];
        for (const [row, unit, qty] of expected) {
            const found = await api
                .get(`${CAT}/products?q=${row.name}`)
                .set(bearer(token))
                .expect(200);
            const p = found.body.data.items[0];
            expect(p.baseUnit).toBe(unit);
            const mv = await api
                .get(`/api/v1/stock/movements?productId=${p.id}`)
                .set(bearer(token))
                .expect(200);
            expect(mv.body.data.items).toHaveLength(1);
            expect(mv.body.data.items[0]).toMatchObject({type: 'OPENING', quantity: qty});
        }
    });

    it('good dry run is valid and creates nothing', async () => {
        const {token} = await createOwner();
        const category = uniqueName('cat');
        const before = await productTotal(token);
        const res = await importRows(token, [goodRow({category}), goodRow({category})], true);
        expect(res.status).toBe(200);
        expect(res.body.data.valid).toBe(true);
        expect(await productTotal(token)).toBe(before);
        const cats = await api.get(`${CAT}/categories`).set(bearer(token)).expect(200);
        expect(JSON.stringify(cats.body.data)).not.toContain(category);
    });
});
