import {CustomerEntryType, DocumentKind, Prisma, RoundOffRule} from '@prisma/client';

type Decimal = Prisma.Decimal;
const IST_OFFSET_MS = 330 * 60_000;

export const round2 = (d: Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Indian financial year (April-March) of an instant, in IST: "2026-27". */
export function financialYearOf(at: Date): string {
    const ist = new Date(at.getTime() + IST_OFFSET_MS);
    const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * The next gapless document number for a store, kind and financial year, e.g. INV/26-27/00001.
 * The counter row stays locked until the caller's transaction ends, so numbers are sequential, and a
 * rolled-back sale or return gives its number back.
 */
export async function nextDocumentNo(
    tx: Prisma.TransactionClient,
    doc: {kiranaId: string; storeId: string; kind: DocumentKind; prefix: string; at: Date},
) {
    const financialYear = financialYearOf(doc.at);
    const [row] = await tx.$queryRaw<{next: number}[]>`
        INSERT INTO "DocumentSeries" ("id", "kiranaId", "storeId", "kind", "financialYear", "next")
        VALUES (gen_random_uuid()::text, ${doc.kiranaId}, ${doc.storeId},
                ${doc.kind}::"DocumentKind", ${financialYear}, 2)
        ON CONFLICT ("storeId", "kind", "financialYear")
        DO UPDATE SET "next" = "DocumentSeries"."next" + 1
        RETURNING "next"`;
    const sequence = row.next - 1;
    const short = `${financialYear.slice(2, 4)}-${financialYear.slice(5)}`;
    return {
        number: `${doc.prefix}/${short}/${String(sequence).padStart(5, '0')}`,
        financialYear,
        sequence,
    };
}

/** The payable amount under the business's round-off rule, and the signed round-off line. */
export function applyRoundOff(rule: RoundOffRule, amount: Decimal) {
    const total =
        rule === 'NEAREST_1'
            ? amount.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            : round2(amount);
    return {total, roundOff: total.sub(amount)};
}

/**
 * Appends one customer-account entry inside `tx` and moves the running balance by the same amount
 * (signed: + the customer owes more). The balance upsert takes the row lock first, as applyMovement does.
 */
export async function applyCustomerEntry(
    tx: Prisma.TransactionClient,
    entry: {
        kiranaId: string;
        customerId: string;
        actorId: string;
        type: CustomerEntryType;
        amount: Decimal;
        saleId?: string;
        saleReturnId?: string;
    },
) {
    const balance = await tx.customerBalance.upsert({
        where: {customerId: entry.customerId},
        create: {kiranaId: entry.kiranaId, customerId: entry.customerId, balance: entry.amount},
        update: {balance: {increment: entry.amount}},
        select: {balance: true},
    });
    return tx.customerLedgerEntry.create({
        data: {
            kiranaId: entry.kiranaId,
            customerId: entry.customerId,
            actorId: entry.actorId,
            type: entry.type,
            amount: entry.amount,
            balanceAfter: balance.balance,
            saleId: entry.saleId ?? null,
            saleReturnId: entry.saleReturnId ?? null,
        },
    });
}
