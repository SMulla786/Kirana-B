import {describe, expect, it} from 'vitest';
import {api, bearer, createOwner, prisma, uniqueName} from './helpers';

const CAT = '/api/v1/catalog';

describe('tenancy isolation', () => {
    it('keeps tenants apart', async () => {
        const [A, B] = [await createOwner(), await createOwner()];
        const cat = await api
            .post(`${CAT}/categories`)
            .set(bearer(B.token))
            .send({name: uniqueName('cat')})
            .expect(201);
        const catId = cat.body.data.id as string;
        const prod = await api
            .post(`${CAT}/products`)
            .set(bearer(B.token))
            .send({
                name: uniqueName('prod'),
                unit: 'KG',
                categoryId: catId,
                barcode: uniqueName('bc'),
            })
            .expect(201);
        const prodId = prod.body.data.id as string;

        for (const url of [`${CAT}/categories/${catId}`, `${CAT}/products/${prodId}`]) {
            await api.get(url).set(bearer(A.token)).expect(404);
            await api.patch(url).set(bearer(A.token)).send({name: 'hijack'}).expect(404);
            await api.delete(url).set(bearer(A.token)).expect(404);
        }

        const cats = await api.get(`${CAT}/categories`).set(bearer(A.token)).expect(200);
        const prods = await api.get(`${CAT}/products`).set(bearer(A.token)).expect(200);
        expect(JSON.stringify(cats.body.data)).not.toContain(catId);
        expect(JSON.stringify(prods.body.data)).not.toContain(prodId);

        await api
            .post(`${CAT}/products`)
            .set(bearer(A.token))
            .send({name: uniqueName('p'), unit: 'KG', categoryId: catId, barcode: uniqueName('bc')})
            .expect(404);
        await api
            .post(`${CAT}/categories`)
            .set(bearer(A.token))
            .send({name: uniqueName('c'), kiranaId: B.kiranaId})
            .expect(400);

        const bCat = await api.get(`${CAT}/categories/${catId}`).set(bearer(B.token)).expect(200);
        const bProd = await api.get(`${CAT}/products/${prodId}`).set(bearer(B.token)).expect(200);
        expect(bCat.body.data).toMatchObject({id: catId, name: cat.body.data.name});
        expect(bProd.body.data).toMatchObject({id: prodId, name: prod.body.data.name});
    });

    it('scopes /business and members to the caller tenant', async () => {
        const [A, B] = [await createOwner(), await createOwner()];
        const res = await api.get('/api/v1/business').set(bearer(A.token)).expect(200);
        expect(res.body.data.id).toBe(A.kiranaId);
        await api.patch('/api/v1/business').set(bearer(A.token)).send({id: B.kiranaId}).expect(400);
        const m = await prisma.membership.findFirstOrThrow({where: {kiranaId: B.kiranaId}});
        await api
            .patch(`/api/v1/business/members/${m.id}`)
            .set(bearer(A.token))
            .send({isActive: false})
            .expect(404);
    });
});
