import {z} from 'zod';
import {Prisma} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {toBaseQuantity} from '@utils/units';
import {saleValidation} from '@validations/index';
import {applyMovement, StockContext} from './stock.service';
import {applyCustomerEntry, applyRoundOff, nextDocumentNo, round2} from './billing';
import {returnInclude, serializeReturn} from './sale.service';

type Decimal = Prisma.Decimal;
type SaleQuery = z.infer<typeof saleValidation.saleQuerySchema>;
type ReturnInput = z.infer<typeof saleValidation.createReturnSchema>;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** Start of the IST calendar day holding `at`; a plain YYYY-MM-DD parses into that day. */
const istDay = (at: Date) =>
    new Date(Math.floor((at.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS);

const AMOUNTS = ['taxableValue', 'cgst', 'sgst', 'amount'] as const;
type Amounts = Record<(typeof AMOUNTS)[number], Decimal>;
const pickAmounts = (f: (k: keyof Amounts) => Decimal) =>
    Object.fromEntries(AMOUNTS.map((k) => [k, f(k)])) as Amounts;

class SaleReturnService {
    /**
     * Sales of the session store, newest first. `q` matches the invoice number or the customer;
     * `from` and `to` are whole IST days, both inclusive.
     */
    async list(ctx: Pick<StockContext, 'kiranaId' | 'storeId'>, query: SaleQuery) {
        const q = query.q;
        const where: Prisma.SaleWhereInput = {
            kiranaId: ctx.kiranaId,
            storeId: ctx.storeId,
            createdAt: {
                gte: query.from && istDay(query.from),
                lt: query.to && new Date(istDay(query.to).getTime() + DAY_MS),
            },
            ...(q
                ? {
                      OR: [
                          {invoiceNo: {contains: q, mode: 'insensitive'}},
                          {customer: {name: {contains: q, mode: 'insensitive'}}},
                          {customer: {phoneNumber: {contains: q}}},
                      ],
                  }
                : {}),
        };
        const [total, rows] = await prisma.$transaction([
            prisma.sale.count({where}),
            prisma.sale.findMany({
                where,
                orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
                select: {
                    id: true,
                    invoiceNo: true,
                    createdAt: true,
                    total: true,
                    customer: {select: {id: true, name: true}},
                    cashier: {select: {id: true, fullname: true}},
                    _count: {select: {lines: true}},
                    payments: {select: {method: true}},
                    returns: {select: {refundTotal: true}},
                },
            }),
        ]);
        return {
            items: rows.map((s) => ({
                id: s.id,
                invoiceNo: s.invoiceNo,
                createdAt: s.createdAt,
                customer: s.customer,
                cashier: s.cashier,
                lineCount: s._count.lines,
                total: s.total.toFixed(2),
                returnedTotal: s.returns.reduce((a, r) => a.add(r.refundTotal), D(0)).toFixed(2),
                methods: [...new Set(s.payments.map((p) => p.method))].sort(),
            })),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    /**
     * Records a return against one sale in one transaction: credit note number, stock back in (or in
     * and written off), refund and any account credit. The sale and its lines are never changed.
     * Returns `created: false` when the idempotencyKey was already used: a retry, not a new return.
     */
    async create(ctx: StockContext, saleId: string, input: ReturnInput) {
        const replay = async () => {
            const prior = await prisma.saleReturn.findUnique({
                where: {
                    kiranaId_idempotencyKey: {
                        kiranaId: ctx.kiranaId,
                        idempotencyKey: input.idempotencyKey,
                    },
                },
                include: returnInclude,
            });
            if (!prior) return null;
            if (prior.saleId !== saleId) {
                throw new ApiError(409, 'This idempotency key was already used for another return');
            }
            return {saleReturn: serializeReturn(prior), created: false};
        };
        const earlier = await replay();
        if (earlier) return earlier;
        try {
            const row = await prisma.$transaction((tx) => this.record(tx, ctx, saleId, input));
            return {saleReturn: serializeReturn(row), created: true};
        } catch (e) {
            // Two in-flight retries with one key: the loser rolled back; replay the winner's return.
            const winner = await replay();
            if (winner) return winner;
            throw e;
        }
    }

    private async record(
        tx: Prisma.TransactionClient,
        ctx: StockContext,
        saleId: string,
        input: ReturnInput,
    ) {
        // The row lock makes concurrent returns of one sale run one at a time, so "left" is exact.
        const locked = await tx.$queryRaw<{id: string}[]>`
            SELECT "id" FROM "Sale"
            WHERE "id" = ${saleId} AND "kiranaId" = ${ctx.kiranaId} AND "storeId" = ${ctx.storeId}
            FOR UPDATE`;
        if (!locked.length) throw new ApiError(404, 'Sale not found');
        const sale = await tx.sale.findUniqueOrThrow({
            where: {id: saleId},
            select: {
                customerId: true,
                kirana: {select: {roundOff: true}},
                lines: {
                    include: {
                        product: {select: {baseUnit: true}},
                        returnLines: {
                            select: {
                                quantity: true,
                                taxableValue: true,
                                cgst: true,
                                sgst: true,
                                amount: true,
                            },
                        },
                    },
                },
            },
        });
        if (input.refundMethod === 'CREDIT' && !sale.customerId) {
            throw new ApiError(
                400,
                'A refund to the customer account needs a sale with a customer',
            );
        }

        // Already returned per line, kept current as this request's lines are applied in order.
        const done = new Map(
            sale.lines.map((sl) => {
                const sum = (k: keyof Amounts | 'quantity') =>
                    sl.returnLines.reduce((a, r) => a.add(r[k]), D(0));
                return [sl.id, {quantity: sum('quantity'), ...pickAmounts(sum)}];
            }),
        );
        const byId = new Map(sale.lines.map((sl) => [sl.id, sl]));

        const lines = input.lines.map((l, i) => {
            const fail = (status: number, message: string): never => {
                throw new ApiError(status, message, [{field: `lines.${i}`, message}]);
            };
            const sl = byId.get(l.saleLineId) ?? fail(404, 'Sale line not found');
            const before = done.get(sl.id)!;
            const left = sl.quantity.sub(before.quantity);
            if (l.quantity.gt(left)) {
                return fail(
                    409,
                    `Only ${left.toFixed(3)} ${sl.unit} of "${sl.productName}" is left to return`,
                );
            }
            // The sale's factor, not today's pack size, so a returned carton restocks what was sold.
            const baseQuantity = toBaseQuantity(l.quantity, sl.factor, sl.product.baseUnit);
            // The return that empties the line takes the exact remainder, so a full return refunds
            // exactly what was billed; a partial one is proportional, never more than is left.
            const empties = l.quantity.eq(left);
            const part = (whole: Decimal, already: Decimal) =>
                empties
                    ? whole.sub(already)
                    : Prisma.Decimal.min(
                          round2(whole.mul(l.quantity).div(sl.quantity)),
                          whole.sub(already),
                      );
            const amounts: Amounts = {
                taxableValue: part(sl.taxableValue, before.taxableValue),
                cgst: part(sl.cgst, before.cgst),
                sgst: part(sl.sgst, before.sgst),
                amount: part(sl.total, before.amount),
            };
            done.set(sl.id, {
                quantity: before.quantity.add(l.quantity),
                ...pickAmounts((k) => before[k].add(amounts[k])),
            });
            return {input: l, saleLine: sl, baseQuantity, amounts};
        });

        const {total: refundTotal, roundOff} = applyRoundOff(
            sale.kirana.roundOff,
            lines.reduce((a, l) => a.add(l.amounts.amount), D(0)),
        );
        const now = new Date();
        const doc = await nextDocumentNo(tx, {
            kiranaId: ctx.kiranaId,
            storeId: ctx.storeId,
            kind: 'CREDIT_NOTE',
            prefix: 'CN',
            at: now,
        });

        // Stock in productId order, as the sale does, so concurrent sales and returns can't deadlock.
        const moved = new Map<(typeof lines)[number], {restock: string; damage: string | null}>();
        const byProduct = [...lines].sort((a, b) =>
            a.saleLine.productId.localeCompare(b.saleLine.productId),
        );
        for (const l of byProduct) {
            const move = {
                productId: l.saleLine.productId,
                quantity: l.baseQuantity,
                unit: l.saleLine.product.baseUnit,
                reference: doc.number,
            };
            const restock = await applyMovement(tx, ctx, {...move, type: 'SALE_RETURN'});
            const damage =
                l.input.disposition === 'DAMAGED'
                    ? await applyMovement(tx, ctx, {
                          ...move,
                          type: 'DAMAGE',
                          reason: `Returned damaged: ${input.reason}`,
                      })
                    : null;
            moved.set(l, {restock: restock.id, damage: damage?.id ?? null});
        }
        const created = lines.map((l) => ({
            saleLineId: l.saleLine.id,
            quantity: l.input.quantity,
            disposition: l.input.disposition,
            ...l.amounts,
            restockMovementId: moved.get(l)!.restock,
            damageMovementId: moved.get(l)!.damage,
        }));

        const row = await tx.saleReturn.create({
            data: {
                kiranaId: ctx.kiranaId,
                storeId: ctx.storeId,
                saleId,
                creditNoteNo: doc.number,
                financialYear: doc.financialYear,
                sequence: doc.sequence,
                reason: input.reason,
                refundMethod: input.refundMethod,
                refundTotal,
                roundOff,
                createdById: ctx.userId,
                idempotencyKey: input.idempotencyKey,
                createdAt: now,
                lines: {create: created},
            },
            include: returnInclude,
        });
        if (input.refundMethod === 'CREDIT') {
            await applyCustomerEntry(tx, {
                kiranaId: ctx.kiranaId,
                customerId: sale.customerId!,
                actorId: ctx.userId,
                type: 'RETURN_CREDIT',
                amount: refundTotal.neg(),
                saleId,
                saleReturnId: row.id,
            });
        }
        return row;
    }
}

export default new SaleReturnService();
