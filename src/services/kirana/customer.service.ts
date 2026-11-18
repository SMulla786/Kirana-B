import httpStatus from 'http-status';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {ApiError} from '@utils/index';
import {customerValidation} from '@validations/index';
import prisma from '../../client';
import {applyCustomerEntry, lockCustomerBalance} from './billing';
import {entryInclude, REVERSIBLE_TYPES, serializeEntry} from './customerLedger';

// Phase 5 (A-031): customers, their credit position, opening balances, adjustments and reversals.

type Decimal = Prisma.Decimal;
type Query = z.infer<typeof customerValidation.customerQuerySchema>;
type CreateInput = z.infer<typeof customerValidation.createCustomerSchema>;
type UpdateInput = z.infer<typeof customerValidation.updateCustomerSchema>;
type AdjustInput = z.infer<typeof customerValidation.adjustmentSchema>;
type ReverseInput = z.infer<typeof customerValidation.reverseEntrySchema>;
export type CustomerContext = {kiranaId: string; userId: string; canSetCreditLimit: boolean};

const ZERO = new Prisma.Decimal(0);
// As complete() and collect(): Prisma's 5 s default fails writes under load (P2028).
const TX = {timeout: 30_000};
const fail = (status: number, message: string, field?: string): never => {
    throw new ApiError(status, message, field ? [{field, message}] : undefined);
};

const customerSelect = {
    id: true,
    name: true,
    phoneNumber: true,
    address: true,
    notes: true,
    tags: true,
    isActive: true,
    creditLimit: true,
    createdAt: true,
    balance: {select: {balance: true}},
} satisfies Prisma.clientSelect;
type CustomerRow = Prisma.clientGetPayload<{select: typeof customerSelect}>;

/** Outstanding, limit and what is left of it. Without a balance row the customer owes nothing. */
export const creditOf = (outstanding: Decimal, creditLimit: Decimal | null) => ({
    outstanding: outstanding.toFixed(2),
    creditLimit: creditLimit?.toFixed(2) ?? null,
    available: creditLimit ? creditLimit.sub(outstanding).toFixed(2) : null,
});

/** Latest ledger entry per customer, in one grouped query (a nested take would read every entry). */
async function lastActivity(kiranaId: string, ids: string[]) {
    const rows = await prisma.customerLedgerEntry.groupBy({
        by: ['customerId'],
        where: {kiranaId, customerId: {in: ids}},
        _max: {createdAt: true},
    });
    return new Map(rows.map((r) => [r.customerId, r._max.createdAt]));
}

const summary = (c: CustomerRow, last: Map<string, Date | null>) => ({
    id: c.id,
    name: c.name,
    phoneNumber: c.phoneNumber,
    tags: c.tags,
    isActive: c.isActive,
    ...creditOf(c.balance?.balance ?? ZERO, c.creditLimit),
    lastActivityAt: last.get(c.id) ?? null,
});
const profile = (c: CustomerRow, last: Map<string, Date | null>) => ({
    ...summary(c, last),
    address: c.address,
    notes: c.notes,
    createdAt: c.createdAt,
});

/**
 * A family may share one phone: the same name on a phone is refused, and a second name on a phone in
 * use needs `sharedPhone`. Runs under a per-phone advisory lock, so two racing adds can't both pass.
 */
async function checkPhone(
    tx: Prisma.TransactionClient,
    kiranaId: string,
    input: {name: string; phoneNumber: string; sharedPhone?: boolean},
    selfId?: string,
) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${kiranaId}:${input.phoneNumber}`}))`;
    const onPhone = await tx.client.findMany({
        where: {kiranaId, phoneNumber: input.phoneNumber, ...(selfId ? {id: {not: selfId}} : {})},
        select: {id: true, name: true},
        orderBy: {createdAt: 'asc'},
    });
    const clash = (message: string) =>
        new ApiError(httpStatus.CONFLICT, message, [
            {field: 'phoneNumber', message, customers: onPhone},
        ]);
    const name = input.name.trim().toLowerCase();
    if (onPhone.some((c) => c.name.trim().toLowerCase() === name)) {
        throw clash('A customer with this name already uses this phone');
    }
    if (onPhone.length && !input.sharedPhone) {
        throw clash('This phone belongs to another customer; confirm it is a shared phone');
    }
}

async function customerOf(kiranaId: string, id: string) {
    const c = await prisma.client.findFirst({where: {id, kiranaId}, select: customerSelect});
    if (!c) throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
    return c;
}

/** A replay of `key` for this customer, or null. The same key on another request is a conflict. */
async function replayEntry(kiranaId: string, customerId: string, key: string, type: string) {
    const prior = await prisma.customerLedgerEntry.findUnique({
        where: {kiranaId_idempotencyKey: {kiranaId, idempotencyKey: key}},
        include: entryInclude,
    });
    if (!prior) return null;
    if (prior.customerId !== customerId || prior.type !== type) {
        fail(httpStatus.CONFLICT, 'This idempotencyKey was used for a different request');
    }
    return serializeEntry(prior);
}

class CustomerService {
    async list(kiranaId: string, q: Query) {
        const where: Prisma.clientWhereInput = {
            kiranaId,
            ...(q.status === 'all' ? {} : {isActive: q.status === 'active'}),
            ...(q.tag ? {tags: {has: q.tag}} : {}),
            ...(q.due ? {balance: {balance: {gt: 0}}} : {}),
            ...(q.q
                ? {
                      OR: [
                          {name: {contains: q.q, mode: 'insensitive'}},
                          {phoneNumber: {contains: q.q}},
                      ],
                  }
                : {}),
        };
        // Every customer gets a balance row when added (and the migration backfills older ones), so
        // sorting through it never meets a missing row. Its updatedAt moves with each ledger entry.
        const orderBy: Prisma.clientOrderByWithRelationInput[] =
            q.sort === 'outstanding'
                ? [{balance: {balance: 'desc'}}, {name: 'asc'}, {id: 'asc'}]
                : q.sort === 'recent'
                  ? [{balance: {updatedAt: 'desc'}}, {name: 'asc'}, {id: 'asc'}]
                  : [{name: 'asc'}, {id: 'asc'}];
        const [rows, total] = await prisma.$transaction([
            prisma.client.findMany({
                where,
                select: customerSelect,
                orderBy,
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize,
            }),
            prisma.client.count({where}),
        ]);
        const last = await lastActivity(
            kiranaId,
            rows.map((r) => r.id),
        );
        return {
            items: rows.map((r) => summary(r, last)),
            total,
            page: q.page,
            pageSize: q.pageSize,
        };
    }

    async get(kiranaId: string, id: string) {
        const c = await customerOf(kiranaId, id);
        return profile(c, await lastActivity(kiranaId, [id]));
    }

    async create(ctx: CustomerContext, input: CreateInput) {
        if (input.creditLimit != null && !ctx.canSetCreditLimit) {
            fail(httpStatus.FORBIDDEN, 'You cannot set a credit limit', 'creditLimit');
        }
        const id = await prisma.$transaction(async (tx) => {
            await checkPhone(tx, ctx.kiranaId, input);
            const c = await tx.client.create({
                data: {
                    kiranaId: ctx.kiranaId,
                    name: input.name,
                    phoneNumber: input.phoneNumber,
                    address: input.address ?? '',
                    notes: input.notes ?? null,
                    tags: input.tags ?? [],
                    creditLimit: input.creditLimit ?? null,
                    balance: {create: {kiranaId: ctx.kiranaId}},
                },
                select: {id: true},
            });
            return c.id;
        }, TX);
        return this.get(ctx.kiranaId, id);
    }

    async update(ctx: CustomerContext, id: string, input: UpdateInput) {
        const now = await customerOf(ctx.kiranaId, id);
        const {sharedPhone, ...data} = input;
        if (data.creditLimit !== undefined && !ctx.canSetCreditLimit) {
            const same =
                (data.creditLimit === null && now.creditLimit === null) ||
                (data.creditLimit !== null && now.creditLimit?.equals(data.creditLimit));
            if (!same)
                fail(httpStatus.FORBIDDEN, 'You cannot change the credit limit', 'creditLimit');
        }
        await prisma.$transaction(async (tx) => {
            const name = data.name ?? now.name;
            const phoneNumber = data.phoneNumber ?? now.phoneNumber;
            if (name !== now.name || phoneNumber !== now.phoneNumber) {
                // Sharing was accepted when the customer joined this phone; only a move asks again.
                const shared = phoneNumber === now.phoneNumber || sharedPhone;
                await checkPhone(tx, ctx.kiranaId, {name, phoneNumber, sharedPhone: shared}, id);
            }
            await tx.client.update({where: {id}, data});
        }, TX);
        return this.get(ctx.kiranaId, id);
    }

    /** OPENING_BALANCE (once, unless reversed) or ADJUSTMENT, posted straight to the ledger. */
    async adjust(ctx: CustomerContext, id: string, input: AdjustInput) {
        await customerOf(ctx.kiranaId, id);
        const replay = () => replayEntry(ctx.kiranaId, id, input.idempotencyKey, input.type);
        const prior = await replay();
        if (prior) return {entry: prior, created: false};
        try {
            const entryId = await prisma.$transaction(async (tx) => {
                await lockCustomerBalance(tx, ctx.kiranaId, id);
                if (input.type === 'OPENING_BALANCE') {
                    const open = await tx.customerLedgerEntry.findFirst({
                        where: {customerId: id, type: 'OPENING_BALANCE', reversedBy: null},
                        select: {id: true},
                    });
                    if (open) fail(httpStatus.CONFLICT, 'An opening balance is already posted');
                }
                const e = await applyCustomerEntry(tx, {
                    kiranaId: ctx.kiranaId,
                    customerId: id,
                    actorId: ctx.userId,
                    type: input.type,
                    amount: input.amount,
                    reason: input.reason,
                    idempotencyKey: input.idempotencyKey,
                });
                return e.id;
            }, TX);
            return {entry: await this.entry(entryId), created: true};
        } catch (e) {
            // Two in-flight retries with one key: the loser rolled back; replay the winner.
            const winner = await replay();
            if (winner) return {entry: winner, created: false};
            throw e;
        }
    }

    /** The exact opposite of one opening balance, adjustment or payment entry, once, with a reason. */
    async reverse(ctx: CustomerContext, id: string, entryId: string, input: ReverseInput) {
        const replay = async () => {
            const prior = await replayEntry(ctx.kiranaId, id, input.idempotencyKey, 'REVERSAL');
            if (prior && prior.reverses?.id !== entryId) {
                fail(httpStatus.CONFLICT, 'This idempotencyKey was used for a different request');
            }
            return prior;
        };
        const prior = await replay();
        if (prior) return {entry: prior, created: false};
        const target = await prisma.customerLedgerEntry.findFirst({
            where: {id: entryId, customerId: id, kiranaId: ctx.kiranaId},
            select: {id: true, type: true, amount: true},
        });
        if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'Ledger entry not found');
        if (!(REVERSIBLE_TYPES as readonly string[]).includes(target.type)) {
            fail(
                httpStatus.CONFLICT,
                target.type === 'REVERSAL'
                    ? 'A reversal cannot be reversed'
                    : 'Correct a sale or return with a sales return',
            );
        }
        try {
            const newId = await prisma.$transaction(async (tx) => {
                await lockCustomerBalance(tx, ctx.kiranaId, id);
                const done = await tx.customerLedgerEntry.findUnique({
                    where: {reversesId: target.id},
                    select: {id: true},
                });
                if (done) fail(httpStatus.CONFLICT, 'This entry is already reversed');
                const e = await applyCustomerEntry(tx, {
                    kiranaId: ctx.kiranaId,
                    customerId: id,
                    actorId: ctx.userId,
                    type: 'REVERSAL',
                    amount: target.amount.neg(),
                    reversesId: target.id,
                    reason: input.reason,
                    idempotencyKey: input.idempotencyKey,
                });
                return e.id;
            }, TX);
            return {entry: await this.entry(newId), created: true};
        } catch (e) {
            const winner = await replay();
            if (winner) return {entry: winner, created: false};
            // A racing reversal with another key won the unique reversesId.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                fail(httpStatus.CONFLICT, 'This entry is already reversed');
            }
            throw e;
        }
    }

    private async entry(id: string) {
        return serializeEntry(
            await prisma.customerLedgerEntry.findUniqueOrThrow({
                where: {id},
                include: entryInclude,
            }),
        );
    }
}

export default new CustomerService();
