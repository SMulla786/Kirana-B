import {z} from 'zod';
import {Prisma} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {posValidation} from '@validations/index';
import {productInclude, serializeProduct} from './catalog.service';
import {round2} from './billing';
import {priceLines} from './pricing';

type HoldInput = z.infer<typeof posValidation.holdBillSchema>;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Who is holding: tenant and store from the session, plus what they may do. */
export type PosContext = {
    kiranaId: string;
    storeId: string;
    userId: string;
    canDiscount: boolean;
    canOverridePrice: boolean;
    canSeeCost: boolean;
};

/** The draft snapshot kept in HeldBill.lines. Decimals are stored as exact strings. */
type StoredLine = {
    productId: string;
    productName: string;
    unit: string;
    factor: string;
    quantity: string;
    unitPrice: string;
    gross?: string; // exact line amount; absent on drafts held before it existed
    discount: string;
    priceOverridden: boolean; // stored price differed from the catalogue price at hold time
};

/** A recall claim older than this lapses, so a bill whose till vanished shows up again. */
export const CLAIM_TTL_MS = 120_000;
const unclaimed = () => [{claimedAt: null}, {claimedAt: {lt: new Date(Date.now() - CLAIM_TTL_MS)}}];

const lineAmounts = (l: StoredLine) => {
    const gross = l.gross ? D(l.gross) : round2(D(l.quantity).mul(l.unitPrice));
    return {gross, discount: D(l.discount), lineTotal: gross.sub(l.discount)};
};

const totals = (lines: StoredLine[]) => {
    let subtotal = D(0);
    let discountTotal = D(0);
    for (const l of lines) {
        const a = lineAmounts(l);
        subtotal = subtotal.add(a.gross);
        discountTotal = discountTotal.add(a.discount);
    }
    return {subtotal, discountTotal, total: subtotal.sub(discountTotal)};
};

const include = {
    customer: {select: {id: true, name: true, phoneNumber: true}},
    createdBy: {select: {id: true, fullname: true}},
} satisfies Prisma.HeldBillInclude;
type Row = Prisma.HeldBillGetPayload<{include: typeof include}>;

const serialize = async (
    row: Row,
    ctx: Pick<PosContext, 'kiranaId' | 'storeId' | 'canSeeCost'>,
) => {
    const lines = row.lines as StoredLine[];
    const t = totals(lines);
    // The current catalogue, not a snapshot; null once a product is archived or gone.
    const products = await prisma.kiranaMaterial.findMany({
        where: {
            id: {in: [...new Set(lines.map((l) => l.productId))]},
            kiranaId: ctx.kiranaId,
            status: 'ACTIVE',
        },
        include: productInclude(ctx.storeId),
    });
    const byId = new Map(products.map((p) => [p.id, serializeProduct(p, ctx.canSeeCost)]));
    return {
        id: row.id,
        note: row.note,
        customer: row.customer,
        lines: lines.map((l) => ({
            ...l,
            product: byId.get(l.productId) ?? null,
            quantity: D(l.quantity).toFixed(3),
            unitPrice: D(l.unitPrice).toFixed(2),
            gross: lineAmounts(l).gross.toFixed(2),
            discount: D(l.discount).toFixed(2),
            lineTotal: lineAmounts(l).lineTotal.toFixed(2),
        })),
        subtotal: t.subtotal.toFixed(2),
        discountTotal: t.discountTotal.toFixed(2),
        total: t.total.toFixed(2),
        createdBy: row.createdBy,
        createdAt: row.createdAt,
    };
};

class HeldBillService {
    /**
     * A draft only: it never touches stock, orders, wallets or revenue. Returns `created: false` when the
     * idempotencyKey was already used: a retry, not a new bill.
     */
    async hold(ctx: PosContext, input: HoldInput) {
        const replay = async () => {
            if (!input.idempotencyKey) return null;
            const prior = await prisma.heldBill.findFirst({
                where: {kiranaId: ctx.kiranaId, idempotencyKey: input.idempotencyKey},
                include,
            });
            return prior && {bill: await serialize(prior, ctx), created: false};
        };
        const earlier = await replay();
        if (earlier) return earlier;
        const priced = await priceLines(ctx, input.lines);
        if (input.customerId) {
            const c = await prisma.client.findFirst({
                where: {id: input.customerId, kiranaId: ctx.kiranaId},
                select: {id: true},
            });
            if (!c) throw new ApiError(404, 'Customer not found');
        }
        const lines = priced.map(
            (l): StoredLine => ({
                productId: l.product.id,
                productName: l.product.name,
                unit: l.unit,
                factor: l.factor.toString(),
                quantity: l.quantity.toFixed(3),
                unitPrice: l.unitPrice.toFixed(2),
                gross: l.gross.toFixed(2),
                discount: l.discount.toFixed(2),
                priceOverridden: l.priceOverridden,
            }),
        );

        const row = await prisma.heldBill
            .create({
                data: {
                    kiranaId: ctx.kiranaId,
                    storeId: ctx.storeId,
                    createdById: ctx.userId,
                    customerId: input.customerId ?? null,
                    note: input.note || null,
                    lines,
                    idempotencyKey: input.idempotencyKey ?? null,
                },
                include,
            })
            .catch(async (e) => {
                // Two in-flight retries with one key: the loser replays the winner's bill.
                const isDup =
                    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
                const winner = isDup && (await replay());
                if (winner) return winner;
                throw e;
            });
        return 'created' in row ? row : {bill: await serialize(row, ctx), created: true};
    }

    /** Bills another till is loading right now (a live claim) are hidden. */
    async list(ctx: Pick<PosContext, 'kiranaId' | 'storeId'>) {
        const rows = await prisma.heldBill.findMany({
            where: {
                kiranaId: ctx.kiranaId,
                storeId: ctx.storeId,
                recalledAt: null,
                OR: unclaimed(),
            },
            include,
            orderBy: {createdAt: 'desc'},
            take: 200,
        });
        return rows.map((r) => {
            const lines = r.lines as StoredLine[];
            return {
                id: r.id,
                note: r.note,
                customer: r.customer && {id: r.customer.id, name: r.customer.name},
                lineCount: lines.length,
                total: totals(lines).total.toFixed(2),
                createdBy: r.createdBy,
                createdAt: r.createdAt,
            };
        });
    }

    /**
     * Claims the draft for this till, without deleting it, so a lost response can be retried with the
     * same claimKey. One conditional update is atomic, so two tills cannot both claim it.
     */
    async recall(
        ctx: Pick<PosContext, 'kiranaId' | 'storeId' | 'canSeeCost'>,
        id: string,
        claimKey: string,
    ) {
        const where = {id, kiranaId: ctx.kiranaId, storeId: ctx.storeId};
        const {count} = await prisma.heldBill.updateMany({
            where: {...where, recalledAt: null, OR: [...unclaimed(), {claimKey}]},
            data: {claimKey, claimedAt: new Date()},
        });
        if (count === 0) throw new ApiError(404, 'Held bill not found');
        return serialize(await prisma.heldBill.findFirstOrThrow({where, include}), ctx);
    }

    /**
     * The till has the bill in its cart: take the draft off the list for good. It is marked, not
     * deleted, so a late confirm from a till whose claim lapsed still gets 409 after another till
     * has claimed and confirmed it. Repeating a confirm with the same claimKey is a no-op (204).
     */
    // shortcut: recalled drafts are kept forever (small rows); purge old ones if the table grows.
    async confirm(ctx: Pick<PosContext, 'kiranaId' | 'storeId'>, id: string, claimKey: string) {
        const where = {id, kiranaId: ctx.kiranaId, storeId: ctx.storeId};
        await prisma.heldBill.updateMany({
            where: {...where, claimKey, recalledAt: null},
            data: {recalledAt: new Date()},
        });
        const row = await prisma.heldBill.findFirst({where, select: {claimKey: true}});
        if (row && row.claimKey !== claimKey) {
            throw new ApiError(409, 'Another till has recalled this bill');
        }
    }
}

export default new HeldBillService();
