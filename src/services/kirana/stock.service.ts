import {z} from 'zod';
import {Prisma, StockMovementType, UnitCode} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {resolveFactor, toBaseQuantity} from '@utils/units';
import {catalogValidation} from '@validations/index';

type Decimal = Prisma.Decimal;
type MovementQuery = z.infer<typeof catalogValidation.movementQuerySchema>;

export type StockContext = {kiranaId: string; storeId: string; userId: string; canSeeCost: boolean};

export type MovementInput = {
    productId: string;
    type: StockMovementType;
    /** In `unit`. Positive, except ADJUSTMENT, which is signed and non-zero. */
    quantity: Decimal;
    unit?: UnitCode;
    unitCost?: Decimal | null;
    reason?: string;
    reference?: string;
    idempotencyKey?: string;
    /**
     * Internal only (no API schema exposes it): the write-off leg of a damaged sales return. It follows
     * a SALE_RETURN of the same quantity, so its net effect is zero even when stock was already negative.
     */
    offsetsReturn?: boolean;
};

/** +1 adds stock, -1 removes it, 0 takes the sign from the quantity (ADJUSTMENT). */
const DIRECTION: Record<StockMovementType, 1 | -1 | 0> = {
    OPENING: 1,
    PURCHASE_RECEIPT: 1,
    SALE_RETURN: 1,
    SALE: -1,
    PURCHASE_RETURN: -1,
    DAMAGE: -1,
    EXPIRY: -1,
    ADJUSTMENT: 0,
};
const REASON_REQUIRED = new Set<StockMovementType>(['DAMAGE', 'EXPIRY', 'ADJUSTMENT']);
// The counter must never be blocked by a stock count that is behind reality; every other outbound
// movement must have the stock it removes.
const MAY_GO_NEGATIVE = new Set<StockMovementType>(['SALE']);

const movementInclude = {
    product: {select: {id: true, name: true, baseUnit: true}},
    actor: {select: {id: true, fullname: true}},
} satisfies Prisma.StockMovementInclude;
type MovementRow = Prisma.StockMovementGetPayload<{include: typeof movementInclude}>;

export const serializeMovement = (m: MovementRow, canSeeCost: boolean) => ({
    id: m.id,
    productId: m.productId,
    product: m.product,
    type: m.type,
    quantity: m.quantity.toFixed(3),
    balanceAfter: m.balanceAfter.toFixed(3),
    enteredQuantity: m.enteredQuantity.toFixed(3),
    enteredUnit: m.enteredUnit,
    ...(canSeeCost ? {unitCost: m.unitCost === null ? null : m.unitCost.toFixed(2)} : {}),
    reason: m.reason,
    reference: m.reference,
    actor: m.actor,
    createdAt: m.createdAt,
});

/**
 * Appends one movement inside `tx` and moves the balance by the same amount. The balance upsert
 * takes the row lock first, so concurrent movements for one product and store run one at a time
 * and `balanceAfter` is exact. Any rule failure throws and rolls back both writes.
 */
export const applyMovement = async (
    tx: Prisma.TransactionClient,
    ctx: StockContext,
    input: MovementInput,
) => {
    const product = await tx.kiranaMaterial.findFirst({
        where: {id: input.productId, kiranaId: ctx.kiranaId},
        select: {id: true, baseUnit: true, units: {select: {unit: true, factor: true}}},
    });
    if (!product) throw new ApiError(404, 'Product not found');

    const unit = input.unit ?? product.baseUnit;
    // A stored pack size, else a fixed metric factor (kg on a gram base needs no stored unit).
    const fixedFactor = resolveFactor(product.baseUnit, unit);
    const factor =
        product.units.find((u) => u.unit === unit)?.factor ??
        (typeof fixedFactor === 'string' ? undefined : fixedFactor);
    if (!factor) throw new ApiError(400, `${unit} is not one of this product's units`);

    const direction = DIRECTION[input.type];
    if (direction === 0 ? input.quantity.isZero() : input.quantity.lte(0)) {
        throw new ApiError(
            400,
            direction === 0 ? 'Quantity cannot be 0' : 'Quantity must be greater than 0',
        );
    }
    if (REASON_REQUIRED.has(input.type) && !input.reason) {
        throw new ApiError(400, `A reason is required for ${input.type}`);
    }
    const magnitude = toBaseQuantity(input.quantity.abs(), factor, product.baseUnit);
    const delta =
        direction === 0
            ? input.quantity.isNeg()
                ? magnitude.neg()
                : magnitude
            : magnitude.mul(direction);

    const key = {storeId: ctx.storeId, productId: product.id};
    const balance = await tx.stockBalance.upsert({
        where: {storeId_productId: key},
        create: {...key, kiranaId: ctx.kiranaId, quantity: delta},
        update: {quantity: {increment: delta}},
        select: {quantity: true},
    });
    if (input.type === 'OPENING' && (await tx.stockMovement.count({where: key}))) {
        throw new ApiError(409, 'Opening stock is already recorded. Use an adjustment instead');
    }
    if (
        delta.isNeg() &&
        balance.quantity.isNeg() &&
        !MAY_GO_NEGATIVE.has(input.type) &&
        !input.offsetsReturn
    ) {
        throw new ApiError(409, 'Insufficient stock', [
            {field: 'quantity', available: balance.quantity.minus(delta).toFixed(3)},
        ]);
    }

    return tx.stockMovement.create({
        data: {
            ...key,
            kiranaId: ctx.kiranaId,
            type: input.type,
            quantity: delta,
            balanceAfter: balance.quantity,
            enteredQuantity: input.quantity.abs(),
            enteredUnit: unit,
            unitCost: input.unitCost ?? null,
            reason: input.reason ?? null,
            reference: input.reference ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            actorId: ctx.userId,
        },
        include: movementInclude,
    });
};

class StockService {
    /** Records one movement. A repeated idempotencyKey returns the first result instead of a duplicate. */
    async recordMovement(ctx: StockContext, input: MovementInput) {
        const replay = async () => {
            if (!input.idempotencyKey) return null;
            const existing = await prisma.stockMovement.findUnique({
                where: {
                    kiranaId_idempotencyKey: {
                        kiranaId: ctx.kiranaId,
                        idempotencyKey: input.idempotencyKey,
                    },
                },
                include: movementInclude,
            });
            if (!existing) return null;
            if (existing.productId !== input.productId || existing.type !== input.type) {
                throw new ApiError(
                    409,
                    'This idempotency key was already used for another movement',
                );
            }
            return {movement: serializeMovement(existing, ctx.canSeeCost), replayed: true};
        };
        const earlier = await replay();
        if (earlier) return earlier;
        try {
            const movement = await prisma.$transaction((tx) => applyMovement(tx, ctx, input));
            return {movement: serializeMovement(movement, ctx.canSeeCost), replayed: false};
        } catch (e) {
            // Two in-flight retries with one key: the loser rolled back (unique index, or the OPENING
            // check after the balance lock); once the winner's movement exists, replay it.
            const winner = await replay();
            if (winner) return winner;
            throw e;
        }
    }

    async listMovements(ctx: StockContext, query: MovementQuery) {
        if (query.productId) {
            const owned = await prisma.kiranaMaterial.findFirst({
                where: {id: query.productId, kiranaId: ctx.kiranaId},
                select: {id: true},
            });
            if (!owned) throw new ApiError(404, 'Product not found');
        }
        const where: Prisma.StockMovementWhereInput = {
            kiranaId: ctx.kiranaId,
            storeId: ctx.storeId,
            ...(query.productId ? {productId: query.productId} : {}),
            ...(query.type ? {type: query.type} : {}),
        };
        const [total, items] = await prisma.$transaction([
            prisma.stockMovement.count({where}),
            prisma.stockMovement.findMany({
                where,
                include: movementInclude,
                orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
        ]);
        return {
            items: items.map((m) => serializeMovement(m, ctx.canSeeCost)),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }
}

export default new StockService();
