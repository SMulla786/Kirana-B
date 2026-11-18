import {z} from 'zod';
import {GstScheme, Prisma, RoundOffRule} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {saleValidation} from '@validations/index';
import {applyCustomerEntry, applyRoundOff, nextDocumentNo} from './billing';
import {priceLines, taxLine, TaxedLine} from './pricing';
import {applyMovement} from './stock.service';

type Decimal = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const sum = (xs: Decimal[]) => xs.reduce((a, b) => a.add(b), D(0));
type CheckoutInput = z.infer<typeof saleValidation.checkoutSchema>;
type CompleteInput = z.infer<typeof saleValidation.completeSaleSchema>;

/** Who is checking out: tenant and store from the session, plus what they may do. */
export type SaleContext = {
    kiranaId: string;
    storeId: string;
    userId: string;
    canSeeCost: boolean;
    canDiscount: boolean;
    canOverridePrice: boolean;
    canCredit: boolean;
};

type Business = {
    name: string;
    address: string;
    City: string;
    gstin: string | null;
    gstScheme: GstScheme;
    roundOff: RoundOffRule;
    invoicePrefix: string;
};

const businessOf = (kiranaId: string): Promise<Business> =>
    prisma.kirana.findUniqueOrThrow({
        where: {id: kiranaId},
        select: {
            name: true,
            address: true,
            City: true,
            gstin: true,
            gstScheme: true,
            roundOff: true,
            invoicePrefix: true,
        },
    });

async function assertCustomer(kiranaId: string, customerId: string | null | undefined) {
    if (!customerId) return;
    const c = await prisma.client.findFirst({
        where: {id: customerId, kiranaId},
        select: {id: true},
    });
    if (!c) throw new ApiError(404, 'Customer not found');
}

/** Prices and taxes the cart on the server, then totals it under the business's round-off rule. */
async function buildBill(ctx: SaleContext, input: CheckoutInput, business: Business) {
    const lines = (await priceLines(ctx, input.lines)).map((l) => taxLine(business.gstScheme, l));
    const {total, roundOff} = applyRoundOff(business.roundOff, sum(lines.map((l) => l.total)));
    return {
        lines,
        subtotal: sum(lines.map((l) => l.gross)),
        discountTotal: sum(lines.map((l) => l.discount)),
        taxableTotal: sum(lines.map((l) => l.taxableValue)),
        cgstTotal: sum(lines.map((l) => l.cgst)),
        sgstTotal: sum(lines.map((l) => l.sgst)),
        roundOff,
        total,
    };
}
type Bill = Awaited<ReturnType<typeof buildBill>>;

const lineOut = (l: TaxedLine) => ({
    productId: l.product.id,
    productName: l.product.name,
    unit: l.unit,
    factor: l.factor.toString(),
    quantity: l.quantity.toFixed(3),
    unitPrice: l.unitPrice.toFixed(2),
    gross: l.gross.toFixed(2),
    discount: l.discount.toFixed(2),
    priceOverridden: l.priceOverridden,
    gstRate: l.gstRate.toFixed(2),
    taxableValue: l.taxableValue.toFixed(2),
    cgst: l.cgst.toFixed(2),
    sgst: l.sgst.toFixed(2),
    total: l.total.toFixed(2),
});

const totalsOut = (t: Omit<Bill, 'lines'>) => ({
    subtotal: t.subtotal.toFixed(2),
    discountTotal: t.discountTotal.toFixed(2),
    taxableTotal: t.taxableTotal.toFixed(2),
    cgstTotal: t.cgstTotal.toFixed(2),
    sgstTotal: t.sgstTotal.toFixed(2),
    roundOff: t.roundOff.toFixed(2),
    total: t.total.toFixed(2),
});

/**
 * Checks the tender against the payable total: the allocations must add up exactly; only cash may be
 * over-tendered (the rest is change); credit needs a customer and pos.credit.
 */
function checkPayments(ctx: SaleContext, input: CompleteInput, total: Decimal) {
    let paid = D(0);
    let change = D(0);
    let credit = D(0);
    input.payments.forEach((p, i) => {
        const fail = (status: number, message: string): never => {
            throw new ApiError(status, message, [{field: `payments.${i}`, message}]);
        };
        if (p.tendered !== undefined) {
            if (p.method !== 'CASH') fail(400, 'Only a cash payment has a tendered amount');
            if (p.tendered.lt(p.amount)) fail(400, 'Cash tendered is less than the amount');
            change = change.add(p.tendered.sub(p.amount));
        }
        if (p.method === 'CREDIT') {
            if (!input.customerId) fail(400, 'Credit needs a customer on the bill');
            if (!ctx.canCredit) fail(403, 'You cannot sell on credit');
            credit = credit.add(p.amount);
        }
        paid = paid.add(p.amount);
    });
    if (!paid.equals(total)) {
        const message = `Payments must add up to ${total.toFixed(2)} (got ${paid.toFixed(2)})`;
        throw new ApiError(400, message, [
            {field: 'payments', message, payable: total.toFixed(2), paid: paid.toFixed(2)},
        ]);
    }
    return {change, credit};
}

export const returnInclude = {
    createdBy: {select: {id: true, fullname: true}},
    lines: {include: {saleLine: {select: {productName: true, unit: true}}}},
} satisfies Prisma.SaleReturnInclude;
type ReturnRow = Prisma.SaleReturnGetPayload<{include: typeof returnInclude}>;

export const saleInclude = {
    customer: {select: {id: true, name: true, phoneNumber: true}},
    cashier: {select: {id: true, fullname: true}},
    lines: {orderBy: {lineNo: 'asc'}, include: {returnLines: {select: {quantity: true}}}},
    payments: {orderBy: [{createdAt: 'asc'}, {id: 'asc'}]},
    returns: {orderBy: {createdAt: 'asc'}, include: returnInclude},
} satisfies Prisma.SaleInclude;
export type SaleRow = Prisma.SaleGetPayload<{include: typeof saleInclude}>;

export const serializeReturn = (r: ReturnRow) => ({
    id: r.id,
    saleId: r.saleId,
    creditNoteNo: r.creditNoteNo,
    createdAt: r.createdAt,
    reason: r.reason,
    refundMethod: r.refundMethod,
    refundTotal: r.refundTotal.toFixed(2),
    roundOff: r.roundOff.toFixed(2),
    createdBy: r.createdBy,
    lines: r.lines.map((x) => ({
        id: x.id,
        saleLineId: x.saleLineId,
        productName: x.saleLine.productName,
        unit: x.saleLine.unit,
        quantity: x.quantity.toFixed(3),
        disposition: x.disposition,
        taxableValue: x.taxableValue.toFixed(2),
        cgst: x.cgst.toFixed(2),
        sgst: x.sgst.toFixed(2),
        amount: x.amount.toFixed(2),
        restockMovementId: x.restockMovementId,
        damageMovementId: x.damageMovementId,
    })),
});

/** The invoice as billed, with everything returned against it so far. */
export const serializeSale = (s: SaleRow) => ({
    id: s.id,
    invoiceNo: s.invoiceNo,
    financialYear: s.financialYear,
    createdAt: s.createdAt,
    gstScheme: s.gstScheme,
    seller: {name: s.sellerName, address: s.sellerAddress, gstin: s.sellerGstin},
    customer: s.customer,
    cashier: s.cashier,
    note: s.note,
    lines: s.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        productId: l.productId,
        productName: l.productName,
        sku: l.sku,
        hsnCode: l.hsnCode,
        unit: l.unit,
        factor: l.factor.toString(),
        quantity: l.quantity.toFixed(3),
        unitPrice: l.unitPrice.toFixed(2),
        gross: l.gross.toFixed(2),
        discount: l.discount.toFixed(2),
        priceOverridden: l.priceOverridden,
        priceIncludesTax: l.priceIncludesTax,
        gstRate: l.gstRate.toFixed(2),
        taxableValue: l.taxableValue.toFixed(2),
        cgst: l.cgst.toFixed(2),
        sgst: l.sgst.toFixed(2),
        total: l.total.toFixed(2),
        stockMovementId: l.stockMovementId,
        returnedQuantity: sum(l.returnLines.map((r) => r.quantity)).toFixed(3),
    })),
    payments: s.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount.toFixed(2),
        tendered: p.tendered?.toFixed(2) ?? null,
        reference: p.reference,
        status: p.status,
    })),
    ...totalsOut(s),
    changeDue: s.changeDue.toFixed(2),
    returnedTotal: sum(s.returns.map((r) => r.refundTotal)).toFixed(2),
    returns: s.returns.map(serializeReturn),
});

class SaleService {
    /** The checkout review: server prices, tax, round-off and payable. Writes nothing. */
    async preview(ctx: SaleContext, input: CheckoutInput) {
        const business = await businessOf(ctx.kiranaId);
        await assertCustomer(ctx.kiranaId, input.customerId);
        const bill = await buildBill(ctx, input, business);
        return {
            gstScheme: business.gstScheme,
            roundOffRule: business.roundOff,
            lines: bill.lines.map(lineOut),
            ...totalsOut(bill),
        };
    }

    /**
     * Completes a sale in one transaction: invoice number, sale, line snapshots, payments, a SALE
     * movement per line and any credit entry all commit together or not at all. A repeated
     * idempotencyKey returns the first sale (`created: false`), including two in-flight retries.
     */
    async complete(ctx: SaleContext, input: CompleteInput) {
        const replay = async () => {
            const prior = await prisma.sale.findUnique({
                where: {
                    kiranaId_idempotencyKey: {
                        kiranaId: ctx.kiranaId,
                        idempotencyKey: input.idempotencyKey,
                    },
                },
                include: saleInclude,
            });
            return prior && {sale: serializeSale(prior), created: false};
        };
        const earlier = await replay();
        if (earlier) return earlier;

        const business = await businessOf(ctx.kiranaId);
        await assertCustomer(ctx.kiranaId, input.customerId);
        const bill = await buildBill(ctx, input, business);
        const {change, credit} = checkPayments(ctx, input, bill.total);
        const stockCtx = {
            kiranaId: ctx.kiranaId,
            storeId: ctx.storeId,
            userId: ctx.userId,
            canSeeCost: ctx.canSeeCost,
        };

        let saleId: string;
        try {
            saleId = await prisma.$transaction(
                async (tx) => {
                    const at = new Date();
                    // Taken first: the series row lock orders all sales of a store.
                    const doc = await nextDocumentNo(tx, {
                        kiranaId: ctx.kiranaId,
                        storeId: ctx.storeId,
                        kind: 'INVOICE',
                        prefix: business.invoicePrefix,
                        at,
                    });
                    const sale = await tx.sale.create({
                        data: {
                            kiranaId: ctx.kiranaId,
                            storeId: ctx.storeId,
                            invoiceNo: doc.number,
                            financialYear: doc.financialYear,
                            sequence: doc.sequence,
                            customerId: input.customerId ?? null,
                            cashierId: ctx.userId,
                            gstScheme: business.gstScheme,
                            sellerName: business.name,
                            sellerAddress:
                                [business.address, business.City].filter(Boolean).join(', ') ||
                                null,
                            sellerGstin: business.gstin,
                            subtotal: bill.subtotal,
                            discountTotal: bill.discountTotal,
                            taxableTotal: bill.taxableTotal,
                            cgstTotal: bill.cgstTotal,
                            sgstTotal: bill.sgstTotal,
                            roundOff: bill.roundOff,
                            total: bill.total,
                            changeDue: change,
                            note: input.note || null,
                            idempotencyKey: input.idempotencyKey,
                            createdAt: at,
                            payments: {
                                create: input.payments.map((p) => ({
                                    method: p.method,
                                    amount: p.amount,
                                    tendered: p.tendered ?? null,
                                    reference: p.reference || null,
                                })),
                            },
                        },
                        select: {id: true},
                    });
                    // Stock rows are locked in product order, so a sale and a return never deadlock.
                    const ordered = bill.lines
                        .map((l, i) => ({l, lineNo: i + 1}))
                        .sort((a, b) => a.l.product.id.localeCompare(b.l.product.id));
                    for (const {l, lineNo} of ordered) {
                        const movement = await applyMovement(tx, stockCtx, {
                            productId: l.product.id,
                            type: 'SALE',
                            quantity: l.quantity,
                            unit: l.unit,
                            reference: doc.number,
                        });
                        await tx.saleLine.create({
                            data: {
                                saleId: sale.id,
                                lineNo,
                                productId: l.product.id,
                                productName: l.product.name,
                                sku: l.product.sku,
                                hsnCode: l.product.hsnCode,
                                unit: l.unit,
                                factor: l.factor,
                                quantity: l.quantity,
                                unitPrice: l.unitPrice,
                                gross: l.gross,
                                discount: l.discount,
                                priceOverridden: l.priceOverridden,
                                priceIncludesTax: l.product.priceIncludesTax,
                                gstRate: l.gstRate,
                                taxableValue: l.taxableValue,
                                cgst: l.cgst,
                                sgst: l.sgst,
                                total: l.total,
                                stockMovementId: movement.id,
                            },
                        });
                    }
                    if (credit.gt(0)) {
                        await applyCustomerEntry(tx, {
                            kiranaId: ctx.kiranaId,
                            customerId: input.customerId!,
                            actorId: ctx.userId,
                            type: 'CREDIT_SALE',
                            amount: credit,
                            saleId: sale.id,
                        });
                    }
                    return sale.id;
                },
                {timeout: 30_000},
            );
        } catch (e) {
            // Two in-flight retries with one key: the loser rolled back; replay the winner.
            const winner = await replay();
            if (winner) return winner;
            throw e;
        }
        return {sale: await this.get(ctx, saleId), created: true};
    }

    async get(ctx: Pick<SaleContext, 'kiranaId' | 'storeId'>, id: string) {
        const row = await prisma.sale.findFirst({
            where: {id, kiranaId: ctx.kiranaId, storeId: ctx.storeId},
            include: saleInclude,
        });
        if (!row) throw new ApiError(404, 'Sale not found');
        return serializeSale(row);
    }
}

export default new SaleService();
