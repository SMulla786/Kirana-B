import {randomUUID} from 'node:crypto';
import {CustomerEntryType, PaymentMethod, Prisma, UnitCode} from '@prisma/client';
import {applyCustomerEntry} from '@services/kirana/billing';
import {api, bearer, createOwner, prisma, uniqueName, uniquePhone} from './helpers';

/** An owner with the ids the sale rows need. */
export const shop = async () => {
    const owner = await createOwner();
    const {id: userId} = await prisma.user.findUniqueOrThrow({
        where: {username: owner.payload.username},
        select: {id: true},
    });
    return {...owner, userId, storeId: owner.me.store.id};
};
export type Shop = Awaited<ReturnType<typeof shop>>;

export const product = async (token: string, body: Record<string, unknown> = {}) => {
    const res = await api
        .post('/api/v1/catalog/products')
        .set(bearer(token))
        .send({name: uniqueName('prod'), baseUnit: 'PIECE', sellingPrice: '10.00', ...body})
        .expect(201);
    return res.body.data as {id: string; name: string};
};

export const opening = (token: string, productId: string, quantity: number) =>
    api
        .post('/api/v1/stock/movements')
        .set(bearer(token))
        .send({productId, type: 'OPENING', quantity})
        .expect(201);

export const customer = async (token: string, name = uniqueName('cust')) => {
    const phoneNumber = uniquePhone();
    const res = await api
        .post('/api/v1/customers')
        .set(bearer(token))
        .send({name, phoneNumber})
        .expect(201);
    return {id: res.body.data.id as string, name, phoneNumber};
};

export const stockOf = async (s: Shop, productId: string) =>
    (
        await prisma.stockBalance.findUniqueOrThrow({
            where: {storeId_productId: {storeId: s.storeId, productId}},
        })
    ).quantity.toFixed(3);

type SeedLine = {
    product: {id: string; name: string};
    quantity: string;
    total: string;
    unit?: UnitCode;
    factor?: string;
    taxableValue?: string;
    cgst?: string;
    sgst?: string;
};

/**
 * A completed sale written straight to the tables, as POST /pos/sales would leave it (minus the SALE
 * movement), so return tests can set exact tax splits and timestamps.
 */
export const seedSale = (
    s: Shop,
    lines: SeedLine[],
    opts: {customerId?: string; methods?: PaymentMethod[]; createdAt?: Date} = {},
) => {
    const sum = (k: 'total' | 'taxableValue' | 'cgst' | 'sgst') =>
        lines.reduce(
            (a, l) => a.add(l[k] ?? (k === 'taxableValue' ? l.total : '0')),
            new Prisma.Decimal(0),
        );
    const total = sum('total');
    const methods = opts.methods ?? ['CASH'];
    return prisma.sale.create({
        data: {
            kiranaId: s.kiranaId,
            storeId: s.storeId,
            invoiceNo: `INV/26-27/${randomUUID().slice(0, 8)}`,
            financialYear: '2026-27',
            sequence: 1,
            customerId: opts.customerId ?? null,
            cashierId: s.userId,
            gstScheme: 'REGULAR',
            sellerName: 'Test shop',
            subtotal: total,
            discountTotal: 0,
            taxableTotal: sum('taxableValue'),
            cgstTotal: sum('cgst'),
            sgstTotal: sum('sgst'),
            roundOff: 0,
            total,
            changeDue: 0,
            idempotencyKey: randomUUID(),
            ...(opts.createdAt ? {createdAt: opts.createdAt} : {}),
            lines: {
                create: lines.map((l, i) => ({
                    lineNo: i + 1,
                    productId: l.product.id,
                    productName: l.product.name,
                    unit: l.unit ?? 'PIECE',
                    factor: l.factor ?? '1',
                    quantity: l.quantity,
                    unitPrice: '0',
                    gross: l.total,
                    discount: 0,
                    priceOverridden: false,
                    priceIncludesTax: true,
                    gstRate: l.cgst ? '12.00' : '0',
                    taxableValue: l.taxableValue ?? l.total,
                    cgst: l.cgst ?? '0',
                    sgst: l.sgst ?? '0',
                    total: l.total,
                })),
            },
            payments: {
                create: methods.map((method, i) => ({
                    method,
                    amount: i === 0 ? total.sub(methods.length - 1) : 1,
                })),
            },
        },
        include: {lines: {orderBy: {lineNo: 'asc'}}},
    });
};

/** A real POS sale of `quantity` x 10.00 to a customer: `cash` paid now, the rest on credit. */
export const creditSale = async (
    s: Shop,
    customerId: string,
    productId: string,
    quantity: number,
    cash = 0,
) => {
    const total = quantity * 10;
    const payments = [{method: 'CREDIT', amount: (total - cash).toFixed(2)}];
    if (cash) payments.push({method: 'CASH', amount: cash.toFixed(2)});
    const res = await api
        .post('/api/v1/pos/sales')
        .set(bearer(s.token))
        .send({
            customerId,
            lines: [{productId, unit: 'PIECE', quantity}],
            payments,
            idempotencyKey: randomUUID(),
        })
        .expect(201);
    return res.body.data as {id: string; invoiceNo: string; lines: {id: string}[]};
};

/**
 * Posts one ledger entry straight through applyCustomerEntry, as the adjustment and reversal endpoints
 * do (A-031), for tests that need an entry those endpoints don't make here.
 */
export const postEntry = (
    s: Shop,
    customerId: string,
    entry: {type: CustomerEntryType; amount: string; reason?: string; reversesId?: string},
) =>
    prisma.$transaction((tx) =>
        applyCustomerEntry(tx, {
            kiranaId: s.kiranaId,
            customerId,
            actorId: s.userId,
            ...entry,
            amount: new Prisma.Decimal(entry.amount),
        }),
    );
