import {describe, expect, it} from 'vitest';
import {api, bearer, createOwner, uniqueName, uniquePhone} from './helpers';

const URL = '/api/v1/customers';

describe('customers', () => {
    it('creates, searches by name or phone, and rejects a duplicate phone', async () => {
        const {token} = await createOwner();
        const name = uniqueName('Cust');
        const phoneNumber = uniquePhone();
        const created = await api
            .post(URL)
            .set(bearer(token))
            .send({name, phoneNumber})
            .expect(201);
        expect(created.body.data).toEqual({id: expect.any(String), name, phoneNumber});

        for (const q of [name.toLowerCase(), phoneNumber.slice(2, 8)]) {
            const res = await api.get(`${URL}?q=${q}`).set(bearer(token)).expect(200);
            expect(res.body.data).toEqual([created.body.data]);
        }
        await api.post(URL).set(bearer(token)).send({name: 'Other', phoneNumber}).expect(409);
        await api.post(URL).set(bearer(token)).send({name: 'Bad', phoneNumber: '123'}).expect(400);
    });

    it('is isolated per business', async () => {
        const a = await createOwner();
        const b = await createOwner();
        const phoneNumber = uniquePhone();
        const name = uniqueName('Iso');
        await api.post(URL).set(bearer(a.token)).send({name, phoneNumber}).expect(201);
        const res = await api.get(`${URL}?q=${name}`).set(bearer(b.token)).expect(200);
        expect(res.body.data).toEqual([]);
        // The same phone is free in another business.
        await api.post(URL).set(bearer(b.token)).send({name, phoneNumber}).expect(201);
    });
});
