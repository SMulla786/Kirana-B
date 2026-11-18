import {Prisma} from '@prisma/client';

// Shared by the customer services (Phase 5, A-031): how a ledger entry is read and shown.

const ZERO = new Prisma.Decimal(0);
const IST_OFFSET_MS = 330 * 60_000;

/** The IST calendar day (YYYY-MM-DD) of an instant. */
export const istDayOf = (at: Date) =>
    new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Midnight IST at the start of a YYYY-MM-DD day. IST has no DST, so the next day is +24 h. */
export const istMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`);

/** A `@db.Date` column comes back as UTC midnight of that day. */
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export const customerRefSelect = {id: true, name: true, phoneNumber: true} as const;

export const entryInclude = {
    actor: {select: {id: true, fullname: true}},
    sale: {select: {id: true, invoiceNo: true}},
    saleReturn: {select: {id: true, creditNoteNo: true, saleId: true}},
    payment: {
        select: {id: true, receiptNo: true, method: true, reference: true, receivedOn: true},
    },
    reverses: {select: {id: true, type: true}},
    reversedBy: {select: {id: true, reason: true, createdAt: true}},
} satisfies Prisma.CustomerLedgerEntryInclude;
export type EntryRow = Prisma.CustomerLedgerEntryGetPayload<{include: typeof entryInclude}>;

/** One statement line: signed amount, debit/credit columns and the running balance after it. */
export const serializeEntry = (e: EntryRow) => ({
    id: e.id,
    type: e.type,
    createdAt: e.createdAt,
    amount: e.amount.toFixed(2),
    debit: (e.amount.gt(0) ? e.amount : ZERO).toFixed(2),
    credit: (e.amount.lt(0) ? e.amount.neg() : ZERO).toFixed(2),
    balanceAfter: e.balanceAfter.toFixed(2),
    reason: e.reason,
    actor: e.actor,
    sale: e.sale,
    saleReturn: e.saleReturn,
    payment: e.payment && {...e.payment, receivedOn: dateOnly(e.payment.receivedOn)},
    reverses: e.reverses,
    reversedBy: e.reversedBy,
});

/** Entry types a REVERSAL may cancel. A credit sale or return credit is corrected by a sales return. */
export const REVERSIBLE_TYPES = ['OPENING_BALANCE', 'PAYMENT', 'ADJUSTMENT'] as const;
