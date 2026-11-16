import {z} from 'zod';
import {Prisma} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {toBaseQuantity} from '@utils/units';
import {posValidation} from '@validations/index';
import {productInclude, serializeProduct} from './catalog.service';

type Decimal = Prisma.Decimal;
type HoldInput = z.infer<typeof posValidation.holdBillSchema>;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (d: Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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
    discount: string;
    priceOverridden: boolean; // stored price differed from the catalogue price at hold time
};

const lineAmounts = (l: StoredLine) => {
    const gross = round2(D(l.quantity).mul(l.unitPrice));
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
    /** A draft only: it never touches stock, orders, wallets or revenue. */
    async hold(ctx: PosContext, input: HoldInput) {
        const ids = [...new Set(input.lines.map((l) => l.productId))];
        const products = await prisma.kiranaMaterial.findMany({
            where: {id: {in: ids}, kiranaId: ctx.kiranaId, status: 'ACTIVE'},
            include: {units: {select: {unit: true, factor: true}}},
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        if (ids.some((id) => !byId.has(id))) throw new ApiError(404, 'Product not found');
        if (input.customerId) {
            const c = await prisma.client.findFirst({
                where: {id: input.customerId, kiranaId: ctx.kiranaId},
                select: {id: true},
            });
            if (!c) throw new ApiError(404, 'Customer not found');
        }

        const lines = input.lines.map((l, i): StoredLine => {
            const fail = (status: number, message: string): never => {
                throw new ApiError(status, message, [{field: `lines.${i}`, message}]);
            };
            const p = byId.get(l.productId)!;
            const factors = new Map<string, Decimal>([
                [p.baseUnit, D(1)],
                ...p.units.map((u): [string, Decimal] => [u.unit, u.factor]),
            ]);
            const factor = factors.get(l.unit);
            if (!factor) return fail(400, `${l.unit} is not one of this product's units`);
            toBaseQuantity(l.quantity, factor, p.baseUnit); // throws 400 on bad precision/fraction

            // sellingPrice is per sales unit, so scale it to the chosen unit through the base unit.
            const catalogue =
                p.sellingPrice === null
                    ? null
                    : round2(p.sellingPrice.mul(factor).div(factors.get(p.salesUnit)!));
            const overridden = !!l.unitPrice && !(catalogue && l.unitPrice.equals(catalogue));
            if (overridden) {
                if (!ctx.canOverridePrice) return fail(403, 'You cannot change the price');
            } else if (!l.unitPrice && !catalogue) {
                return fail(400, `"${p.name}" has no price; enter one`);
            }
            const unitPrice = l.unitPrice ?? catalogue!;
            const discount = l.discount ?? D(0);
            if (discount.gt(0) && !ctx.canDiscount) return fail(403, 'You cannot give a discount');
            if (discount.gt(round2(l.quantity.mul(unitPrice)))) {
                return fail(400, 'Discount cannot exceed the line amount');
            }
            return {
                productId: p.id,
                productName: p.name,
                unit: l.unit,
                factor: factor.toString(),
                quantity: l.quantity.toFixed(3),
                unitPrice: unitPrice.toFixed(2),
                discount: discount.toFixed(2),
                priceOverridden: overridden,
            };
        });

        const row = await prisma.heldBill.create({
            data: {
                kiranaId: ctx.kiranaId,
                storeId: ctx.storeId,
                createdById: ctx.userId,
                customerId: input.customerId ?? null,
                note: input.note || null,
                lines,
            },
            include,
        });
        return serialize(row, ctx);
    }

    async list(ctx: Pick<PosContext, 'kiranaId' | 'storeId'>) {
        const rows = await prisma.heldBill.findMany({
            where: {kiranaId: ctx.kiranaId, storeId: ctx.storeId},
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

    /** Loads the draft and deletes it atomically, so two tills cannot both recall it. */
    recall(ctx: Pick<PosContext, 'kiranaId' | 'storeId' | 'canSeeCost'>, id: string) {
        const where = {id, kiranaId: ctx.kiranaId, storeId: ctx.storeId};
        return prisma.$transaction(async (tx) => {
            const row = await tx.heldBill.findFirst({where, include});
            const {count} = await tx.heldBill.deleteMany({where});
            if (!row || count === 0) throw new ApiError(404, 'Held bill not found');
            return serialize(row, ctx);
        });
    }
}

export default new HeldBillService();
