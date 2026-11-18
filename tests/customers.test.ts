import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {api, bearer, createMember, createOwner, prisma, uniqueName, uniquePhone} from './helpers';

const URL = '/api/v1/customers';
type Body = Record<string, unknown>;

const add = (token: string, body: Body) => api.post(URL).set(bearer(token)).send(body);
const adjust = (token: string, id: string, body: Body) =>
    api
        .post(`${URL}/${id}/adjustments`)
        .set(bearer(token))
        .send({type: 'ADJUSTMENT', reason: 'Old book', idempotencyKey: randomUUID(), ...body});

describe('customers', () => {
    it('creates, searches by name or phone, and shares a phone only when asked', async () => {
        const {token} = await createOwner();
        const name = uniqueName('Cust');
        const phoneNumber = uniquePhone();
        const created = await add(token, {name, phoneNumber, tags: ['Regular']}).expect(201);
        const summary = {
            id: expect.any(String),
            name,
            phoneNumber,
            tags: ['Regular'],
            isActive: true,
            outstanding: '0.00',
            creditLimit: null,
            available: null,
            lastActivityAt: null,
        };
        expect(created.body.data).toEqual({
            ...summary,
            address: '',
            notes: null,
            createdAt: expect.any(String),
        });
        const {id} = created.body.data;

        for (const q of [name.toLowerCase(), phoneNumber.slice(2, 8)]) {
            const res = await api.get(`${URL}?q=${q}`).set(bearer(token)).expect(200);
            expect(res.body.data).toEqual({
                items: [{...summary, id}],
                total: 1,
                page: 1,
                pageSize: 50,
            });
        }
        // A family phone: another name needs sharedPhone; the same name never.
        const clash = await add(token, {name: 'Other', phoneNumber}).expect(409);
        expect(clash.body.errors[0].customers).toEqual([{id, name}]);
        await add(token, {name: 'Other', phoneNumber, sharedPhone: true}).expect(201);
        await add(token, {name: name.toUpperCase(), phoneNumber, sharedPhone: true}).expect(409);
        await add(token, {name: 'Bad', phoneNumber: '123'}).expect(400);

        const both = await api.get(`${URL}?q=${phoneNumber}`).set(bearer(token)).expect(200);
        expect(both.body.data.items.map((c: Body) => c.name)).toEqual([name, 'Other']);
    });

    it('edits and archives, keeping the credit limit to customers.credit', async () => {
        const owner = await createOwner();
        const cashier = await createMember(owner.token, 'CASHIER');
        const c = (await add(owner.token, {name: 'Asha', phoneNumber: uniquePhone()}).expect(201))
            .body.data;
        const patch = (token: string, body: Body) =>
            api.patch(`${URL}/${c.id}`).set(bearer(token)).send(body);

        await add(cashier.token, {
            name: 'X',
            phoneNumber: uniquePhone(),
            creditLimit: '500',
        }).expect(403);
        await patch(cashier.token, {creditLimit: '500'}).expect(403);
        const named = await patch(cashier.token, {name: 'Asha Patil', notes: 'Pays Sundays'});
        expect(named.status).toBe(200);
        expect(named.body.data).toMatchObject({name: 'Asha Patil', notes: 'Pays Sundays'});

        const limited = await patch(owner.token, {creditLimit: '500.00', tags: ['Monthly']});
        expect(limited.body.data).toMatchObject({
            creditLimit: '500.00',
            available: '500.00',
            tags: ['Monthly'],
        });
        // Sending the unchanged limit back is fine for a cashier (a whole-form save).
        await patch(cashier.token, {creditLimit: '500', address: 'Lane 2'}).expect(200);

        await patch(owner.token, {isActive: false}).expect(200);
        const active = await api.get(`${URL}?q=Asha%20Patil`).set(bearer(owner.token)).expect(200);
        expect(active.body.data.total).toBe(0);
        const archived = await api
            .get(`${URL}?q=Asha%20Patil&status=archived`)
            .set(bearer(owner.token))
            .expect(200);
        expect(archived.body.data.items[0]).toMatchObject({id: c.id, isActive: false});
        await patch(owner.token, {}).expect(400);
    });

    it('filters by tag and dues, and sorts by outstanding', async () => {
        const {token} = await createOwner();
        for (const [name, owes, tags] of [
            ['Anil', '50', ['Monthly']],
            ['Bina', '0', ['Monthly']],
            ['Chetan', '200', []],
        ] as const) {
            const c = (
                await add(token, {name, phoneNumber: uniquePhone(), tags: [...tags]}).expect(201)
            ).body.data;
            if (owes !== '0') await adjust(token, c.id, {amount: owes}).expect(201);
        }
        const get = async (qs: string) =>
            (await api.get(`${URL}?${qs}`).set(bearer(token)).expect(200)).body.data;

        expect((await get('tag=Monthly')).items.map((c: Body) => c.name)).toEqual(['Anil', 'Bina']);
        expect((await get('due=true')).items.map((c: Body) => c.name)).toEqual(['Anil', 'Chetan']);
        const byOwed = await get('sort=outstanding&pageSize=2');
        expect(byOwed.items.map((c: Body) => [c.name, c.outstanding])).toEqual([
            ['Chetan', '200.00'],
            ['Anil', '50.00'],
        ]);
        expect(byOwed.total).toBe(3);
        expect((await get('sort=outstanding&pageSize=2&page=2')).items[0].name).toBe('Bina');
        expect((await get('sort=recent')).items[0].name).toBe('Chetan');
        await api.get(`${URL}?sort=balance`).set(bearer(token)).expect(400);
    });

    it('is isolated per business and gated by role', async () => {
        const a = await createOwner();
        const b = await createOwner();
        const phoneNumber = uniquePhone();
        const name = uniqueName('Iso');
        const c = (await add(a.token, {name, phoneNumber}).expect(201)).body.data;
        const res = await api.get(`${URL}?q=${name}`).set(bearer(b.token)).expect(200);
        expect(res.body.data.items).toEqual([]);
        await api.get(`${URL}/${c.id}`).set(bearer(b.token)).expect(404);
        await api.patch(`${URL}/${c.id}`).set(bearer(b.token)).send({name: 'x'}).expect(404);
        await adjust(b.token, c.id, {amount: '10'}).expect(404);
        // The same phone is free in another business.
        await add(b.token, {name, phoneNumber}).expect(201);

        const accountant = await createMember(a.token, 'ACCOUNTANT');
        await api.get(`${URL}/${c.id}`).set(bearer(accountant.token)).expect(200);
        await add(accountant.token, {name: 'y', phoneNumber: uniquePhone()}).expect(403);
        const staff = await createMember(a.token, 'STAFF');
        await api.get(URL).set(bearer(staff.token)).expect(403);
        const cashier = await createMember(a.token, 'CASHIER');
        await adjust(cashier.token, c.id, {amount: '10'}).expect(403);
    });
});

describe('customer ledger: opening balance, adjustments and reversals', () => {
    const entries = (customerId: string) =>
        prisma.customerLedgerEntry.findMany({
            where: {customerId},
            orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
        });
    const balanceOf = async (customerId: string) =>
        (await prisma.customerBalance.findUniqueOrThrow({where: {customerId}})).balance.toFixed(2);

    it('posts an opening balance once, adjustments either way, and reconciles', async () => {
        const owner = await createOwner();
        const c = (await add(owner.token, {name: 'Old', phoneNumber: uniquePhone()}).expect(201))
            .body.data;
        const open = await adjust(owner.token, c.id, {
            type: 'OPENING_BALANCE',
            amount: '1200.50',
            reason: 'Notebook page 4',
        }).expect(201);
        expect(open.body.data).toMatchObject({
            type: 'OPENING_BALANCE',
            amount: '1200.50',
            debit: '1200.50',
            credit: '0.00',
            balanceAfter: '1200.50',
            reason: 'Notebook page 4',
            actor: {fullname: 'Test Owner'},
            sale: null,
            payment: null,
            reverses: null,
            reversedBy: null,
        });
        await adjust(owner.token, c.id, {type: 'OPENING_BALANCE', amount: '5'}).expect(409);
        const down = await adjust(owner.token, c.id, {amount: '-200.50'}).expect(201);
        expect(down.body.data).toMatchObject({
            debit: '0.00',
            credit: '200.50',
            balanceAfter: '1000.00',
        });

        await adjust(owner.token, c.id, {amount: '0'}).expect(400);
        await adjust(owner.token, c.id, {amount: '1.234'}).expect(400);
        await adjust(owner.token, c.id, {amount: '5', reason: ''}).expect(400);

        const rows = await entries(c.id);
        expect(rows.map((e) => [e.type, e.amount.toFixed(2), e.balanceAfter.toFixed(2)])).toEqual([
            ['OPENING_BALANCE', '1200.50', '1200.50'],
            ['ADJUSTMENT', '-200.50', '1000.00'],
        ]);
        expect(await balanceOf(c.id)).toBe('1000.00');
        const profile = await api.get(`${URL}/${c.id}`).set(bearer(owner.token)).expect(200);
        expect(profile.body.data).toMatchObject({
            outstanding: '1000.00',
            lastActivityAt: expect.any(String),
        });
    });

    it('replays a retried key, also when two retries race, and refuses a reused key', async () => {
        const owner = await createOwner();
        const c = (await add(owner.token, {name: 'Key', phoneNumber: uniquePhone()}).expect(201))
            .body.data;
        const body = {amount: '75', idempotencyKey: randomUUID()};
        const first = await adjust(owner.token, c.id, body).expect(201);
        const again = await adjust(owner.token, c.id, body).expect(200);
        expect(again.body.data).toEqual(first.body.data);

        const raced = {amount: '25', idempotencyKey: randomUUID()};
        const both = await Promise.all([
            adjust(owner.token, c.id, raced),
            adjust(owner.token, c.id, raced),
        ]);
        expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(await balanceOf(c.id)).toBe('100.00');
        expect(await entries(c.id)).toHaveLength(2);

        await adjust(owner.token, c.id, {...body, type: 'OPENING_BALANCE'}).expect(409);
    });

    it('reverses an entry once with an equal and opposite entry', async () => {
        const owner = await createOwner();
        const c = (await add(owner.token, {name: 'Rev', phoneNumber: uniquePhone()}).expect(201))
            .body.data;
        const open = (
            await adjust(owner.token, c.id, {type: 'OPENING_BALANCE', amount: '300'}).expect(201)
        ).body.data;
        const reverse = (entryId: string, body: Body = {}) =>
            api
                .post(`${URL}/${c.id}/ledger/${entryId}/reverse`)
                .set(bearer(owner.token))
                .send({reason: 'Wrong customer', idempotencyKey: randomUUID(), ...body});

        const both = await Promise.all([reverse(open.id), reverse(open.id)]);
        expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
        const rev = both.find((r) => r.status === 201)!.body.data;
        expect(rev).toMatchObject({
            type: 'REVERSAL',
            amount: '-300.00',
            balanceAfter: '0.00',
            reason: 'Wrong customer',
            reverses: {id: open.id, type: 'OPENING_BALANCE'},
        });
        await reverse(rev.id).expect(409); // a reversal is final
        // With the old one cancelled, the right opening balance can go in.
        await adjust(owner.token, c.id, {type: 'OPENING_BALANCE', amount: '250'}).expect(201);
        expect(await balanceOf(c.id)).toBe('250.00');

        await reverse(randomUUID()).expect(404);
        const other = (await add(owner.token, {name: 'O', phoneNumber: uniquePhone()}).expect(201))
            .body.data;
        await api
            .post(`${URL}/${other.id}/ledger/${open.id}/reverse`)
            .set(bearer(owner.token))
            .send({reason: 'x', idempotencyKey: randomUUID()})
            .expect(404);
        const cashier = await createMember(owner.token, 'CASHIER');
        await api
            .post(`${URL}/${c.id}/ledger/${open.id}/reverse`)
            .set(bearer(cashier.token))
            .send({reason: 'x', idempotencyKey: randomUUID()})
            .expect(403);
    });
});
