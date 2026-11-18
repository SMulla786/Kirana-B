import {z} from 'zod';
import {Prisma} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {customerValidation} from '@validations/index';
import {applyCustomerEntry, lockCustomerBalance, nextDocumentNo} from './billing';
import {
    customerRefSelect,
    entryInclude,
    istDayOf,
    istMidnight,
    serializeEntry,
} from './customerLedger';

// Phase 5 (A-031): the customer statement, credit invoice dues and collections.

type Decimal = Prisma.Decimal;
type Db = Prisma.TransactionClient;
type LedgerQuery = z.infer<typeof customerValidation.ledgerQuerySchema>;
type CollectInput = z.infer<typeof customerValidation.collectPaymentSchema>;
type Ctx = {kiranaId: string; storeId: string; userId: string};

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 86_400_000;
const sum = <T>(rows: T[], f: (r: T) => Decimal) => rows.reduce((a, r) => a.add(f(r)), ZERO);
/** A `@db.Date` column comes back as UTC midnight of that day. */
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

async function findCustomer(db: Db, kiranaId: string, id: string) {
    const customer = await db.client.findFirst({where: {id, kiranaId}, select: customerRefSelect});
    if (!customer) throw new ApiError(404, 'Customer not found');
    return customer;
}

/**
 * The customer's credit invoices (sales with a CREDIT payment), oldest first, with what each still
 * owes: max(0, credit part - returns refunded to the account - allocations of unreversed collections).
 */
async function creditInvoices(db: Db, kiranaId: string, customerId: string, saleIds?: string[]) {
    const rows = await db.sale.findMany({
        where: {
            kiranaId,
            customerId,
            id: saleIds && {in: saleIds},
            payments: {some: {method: 'CREDIT'}},
        },
        orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
        select: {
            id: true,
            invoiceNo: true,
            createdAt: true,
            total: true,
            payments: {where: {method: 'CREDIT'}, select: {amount: true}},
            returns: {where: {refundMethod: 'CREDIT'}, select: {refundTotal: true}},
            // A collection whose PAYMENT entry was reversed no longer pays anything off.
            allocations: {
                where: {payment: {ledgerEntries: {none: {reversedBy: {isNot: null}}}}},
                select: {amount: true},
            },
        },
    });
    return rows.map((s) => {
        const creditAmount = sum(s.payments, (p) => p.amount);
        const returnedToAccount = sum(s.returns, (r) => r.refundTotal);
        const allocated = sum(s.allocations, (a) => a.amount);
        return {
            saleId: s.id,
            invoiceNo: s.invoiceNo,
            createdAt: s.createdAt,
            total: s.total,
            creditAmount,
            returnedToAccount,
            allocated,
            due: Prisma.Decimal.max(ZERO, creditAmount.sub(returnedToAccount).sub(allocated)),
        };
    });
}

const paymentInclude = {
    customer: {select: customerRefSelect},
    createdBy: {select: {id: true, fullname: true}},
    allocations: {
        select: {saleId: true, amount: true, sale: {select: {invoiceNo: true}}},
        orderBy: [{sale: {createdAt: 'asc'}}, {saleId: 'asc'}],
    },
    ledgerEntries: {
        where: {type: 'PAYMENT'},
        select: {
            id: true,
            balanceAfter: true,
            reversedBy: {select: {id: true, reason: true, createdAt: true}},
        },
    },
} satisfies Prisma.CustomerPaymentInclude;
type PaymentRow = Prisma.CustomerPaymentGetPayload<{include: typeof paymentInclude}>;

const serializePayment = (p: PaymentRow) => {
    const [entry] = p.ledgerEntries; // a collection has exactly one PAYMENT entry
    return {
        id: p.id,
        receiptNo: p.receiptNo,
        financialYear: p.financialYear,
        customer: p.customer,
        method: p.method,
        amount: p.amount.toFixed(2),
        reference: p.reference,
        receivedOn: dateOnly(p.receivedOn),
        note: p.note,
        status: p.status,
        allocations: p.allocations.map((a) => ({
            saleId: a.saleId,
            invoiceNo: a.sale.invoiceNo,
            amount: a.amount.toFixed(2),
        })),
        unallocated: p.amount.sub(sum(p.allocations, (a) => a.amount)).toFixed(2),
        ledgerEntryId: entry.id,
        balanceAfter: entry.balanceAfter.toFixed(2),
        reversal: entry.reversedBy && {
            entryId: entry.reversedBy.id,
            reason: entry.reversedBy.reason,
            createdAt: entry.reversedBy.createdAt,
        },
        createdBy: p.createdBy,
        createdAt: p.createdAt,
    };
};

class CustomerLedgerService {
    /**
     * The statement for whole IST days `from`..`to` (both inclusive, both optional): the balance
     * before `from`, this page of entries oldest first, totals over the whole range and the closing
     * balance.
     */
    async ledger(kiranaId: string, customerId: string, query: LedgerQuery) {
        const customer = await findCustomer(prisma, kiranaId, customerId);
        const of = {kiranaId, customerId};
        const start = query.from ? istMidnight(query.from) : undefined;
        const end = query.to ? new Date(istMidnight(query.to).getTime() + DAY_MS) : undefined;
        const where = {...of, createdAt: {gte: start, lt: end}};
        const total = (amount: Prisma.DecimalFilter<'CustomerLedgerEntry'>) =>
            prisma.customerLedgerEntry.aggregate({where: {...where, amount}, _sum: {amount: true}});
        // One snapshot, so the opening balance, the totals and the page agree.
        const [before, debit, credit, count, rows] = await prisma.$transaction(
            [
                prisma.customerLedgerEntry.aggregate({
                    // Without `from` nothing comes before the statement.
                    where: {...of, createdAt: {lt: start ?? new Date(0)}},
                    _sum: {amount: true},
                }),
                total({gt: 0}),
                total({lt: 0}),
                prisma.customerLedgerEntry.count({where}),
                prisma.customerLedgerEntry.findMany({
                    where,
                    orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
                    skip: (query.page - 1) * query.pageSize,
                    take: query.pageSize,
                    include: entryInclude,
                }),
            ],
            {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead},
        );
        const openingBalance = before._sum.amount ?? ZERO;
        const debitTotal = debit._sum.amount ?? ZERO;
        const creditTotal = (credit._sum.amount ?? ZERO).neg();
        return {
            customer,
            from: query.from ?? null,
            to: query.to ?? null,
            openingBalance: openingBalance.toFixed(2),
            debitTotal: debitTotal.toFixed(2),
            creditTotal: creditTotal.toFixed(2),
            closingBalance: openingBalance.add(debitTotal).sub(creditTotal).toFixed(2),
            entries: rows.map(serializeEntry),
            total: count,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    /** Credit invoices, oldest first: `due` only those still owing, `all` every one. */
    async invoices(kiranaId: string, customerId: string, status: 'due' | 'all') {
        await findCustomer(prisma, kiranaId, customerId);
        const rows = await creditInvoices(prisma, kiranaId, customerId);
        return rows
            .filter((r) => status === 'all' || r.due.gt(0))
            .map((r) => ({
                saleId: r.saleId,
                invoiceNo: r.invoiceNo,
                createdAt: r.createdAt,
                total: r.total.toFixed(2),
                creditAmount: r.creditAmount.toFixed(2),
                returnedToAccount: r.returnedToAccount.toFixed(2),
                allocated: r.allocated.toFixed(2),
                due: r.due.toFixed(2),
            }));
    }

    /** A collection receipt, for reprint. */
    async payment(kiranaId: string, customerId: string, paymentId: string) {
        const row = await prisma.customerPayment.findFirst({
            where: {id: paymentId, kiranaId, customerId},
            include: paymentInclude,
        });
        if (!row) throw new ApiError(404, 'Payment not found');
        return serializePayment(row);
    }

    /**
     * Records a collection in one transaction: a receipt number, the payment with its allocations and
     * one PAYMENT ledger entry. Returns `created: false` when the idempotencyKey was already used.
     */
    async collect(ctx: Ctx, customerId: string, input: CollectInput) {
        const replay = async () => {
            const prior = await prisma.customerPayment.findUnique({
                where: {
                    kiranaId_idempotencyKey: {
                        kiranaId: ctx.kiranaId,
                        idempotencyKey: input.idempotencyKey,
                    },
                },
                include: paymentInclude,
            });
            if (!prior) return null;
            if (prior.customerId !== customerId) {
                throw new ApiError(
                    409,
                    'This idempotency key was already used for another customer',
                );
            }
            return {payment: serializePayment(prior), created: false};
        };
        const earlier = await replay();
        if (earlier) return earlier;

        const now = new Date();
        const today = istDayOf(now);
        const receivedOn = input.receivedOn ?? today;
        if (receivedOn > today) {
            const message = 'The day received cannot be in the future';
            throw new ApiError(400, message, [{field: 'receivedOn', message}]);
        }
        try {
            const row = await prisma.$transaction(
                (tx) => this.record(tx, ctx, customerId, input, now, receivedOn),
                {timeout: 30_000},
            );
            return {payment: serializePayment(row), created: true};
        } catch (e) {
            // Two in-flight retries with one key: the loser rolled back; replay the winner's payment.
            const winner = await replay();
            if (winner) return winner;
            throw e;
        }
    }

    private async record(
        tx: Db,
        ctx: Ctx,
        customerId: string,
        input: CollectInput,
        now: Date,
        receivedOn: string,
    ) {
        await findCustomer(tx, ctx.kiranaId, customerId); // an archived customer can still pay
        // Lock order (A-031): document series, sale rows by id, customer balance.
        const doc = await nextDocumentNo(tx, {
            kiranaId: ctx.kiranaId,
            storeId: ctx.storeId,
            kind: 'PAYMENT_RECEIPT',
            prefix: 'RCPT',
            at: now,
        });
        const saleIds = input.allocations.map((a) => a.saleId);
        if (saleIds.length) {
            // A return refunded to the account locks its sale too, so dues can't move under us.
            await tx.$queryRaw`
                SELECT "id" FROM "Sale"
                WHERE "id" IN (${Prisma.join(saleIds)})
                  AND "kiranaId" = ${ctx.kiranaId} AND "customerId" = ${customerId}
                ORDER BY "id"
                FOR UPDATE`;
        }
        await lockCustomerBalance(tx, ctx.kiranaId, customerId);

        const dues = new Map(
            (await creditInvoices(tx, ctx.kiranaId, customerId, saleIds)).map((r) => [r.saleId, r]),
        );
        input.allocations.forEach((a, i) => {
            const fail = (status: number, message: string): never => {
                throw new ApiError(status, message, [{field: `allocations.${i}`, message}]);
            };
            const invoice =
                dues.get(a.saleId) ?? fail(404, 'No such credit invoice for this customer');
            if (a.amount.gt(invoice.due)) {
                fail(409, `Only ${invoice.due.toFixed(2)} is due on ${invoice.invoiceNo}`);
            }
        });

        const payment = await tx.customerPayment.create({
            data: {
                kiranaId: ctx.kiranaId,
                storeId: ctx.storeId,
                customerId,
                receiptNo: doc.number,
                financialYear: doc.financialYear,
                sequence: doc.sequence,
                method: input.method,
                amount: input.amount,
                reference: input.reference ?? null,
                receivedOn: new Date(`${receivedOn}T00:00:00Z`),
                note: input.note ?? null,
                idempotencyKey: input.idempotencyKey,
                createdById: ctx.userId,
                createdAt: now,
                allocations: {
                    create: input.allocations.map((a) => ({saleId: a.saleId, amount: a.amount})),
                },
            },
        });
        // Unallocated money stays on account: the balance may go below zero (an advance).
        await applyCustomerEntry(tx, {
            kiranaId: ctx.kiranaId,
            customerId,
            actorId: ctx.userId,
            type: 'PAYMENT',
            amount: input.amount.neg(),
            paymentId: payment.id,
        });
        return tx.customerPayment.findUniqueOrThrow({
            where: {id: payment.id},
            include: paymentInclude,
        });
    }
}

export default new CustomerLedgerService();
