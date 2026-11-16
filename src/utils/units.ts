import {Prisma, UnitCode} from '@prisma/client';
import ApiError from './ApiError';

type Decimal = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Stock quantities are stored in the product's base unit with this many decimals (DECISIONS P-002). */
export const QTY_DP = 3;
const FACTOR_DP = 6;

type Dimension = 'COUNT' | 'MASS' | 'VOLUME';
// `metric` = size in the dimension's smallest unit (g, ml); count units have no fixed size.
const UNITS: Record<UnitCode, {dim: Dimension; metric?: number}> = {
    PIECE: {dim: 'COUNT'},
    PACKET: {dim: 'COUNT'},
    BOX: {dim: 'COUNT'},
    CARTON: {dim: 'COUNT'},
    GRAM: {dim: 'MASS', metric: 1},
    KILOGRAM: {dim: 'MASS', metric: 1000},
    MILLILITRE: {dim: 'VOLUME', metric: 1},
    LITRE: {dim: 'VOLUME', metric: 1000},
};

/** Weighed or measured products (mass/volume base) take fractional quantities. */
export const isLooseUnit = (unit: UnitCode) => UNITS[unit].dim !== 'COUNT';

/**
 * The canonical factor (base units in one `unit`), or an error message.
 * - Same unit: 1.
 * - Metric over the same dimension: fixed (KILOGRAM over GRAM = 1000); a different given factor is an error.
 * - Count unit (pack, box, carton) over any base: product-specific, > 0; whole when the base is a count unit.
 * - Metric over a count base, or across mass/volume: not convertible.
 */
export const resolveFactor = (
    base: UnitCode,
    unit: UnitCode,
    given?: Decimal | null,
): Decimal | string => {
    if (unit === base) return D(1);
    const u = UNITS[unit];
    const b = UNITS[base];
    if (u.metric !== undefined) {
        if (b.metric === undefined || u.dim !== b.dim) {
            return `${unit} cannot be converted to ${base}`;
        }
        const fixed = D(u.metric).div(b.metric);
        if (given && !given.equals(fixed)) return `1 ${unit} is always ${fixed} ${base}`;
        return fixed;
    }
    if (!given) return `Give how many ${base} are in one ${unit}`;
    if (given.lte(0)) return 'Factor must be greater than 0';
    if (given.decimalPlaces() > FACTOR_DP) return `Factor allows at most ${FACTOR_DP} decimals`;
    if (b.dim === 'COUNT' && !given.isInteger()) {
        return `1 ${unit} must be a whole number of ${base}`;
    }
    return given;
};

/**
 * Converts a quantity entered in some unit to base units. Never rounds: a result with more than
 * QTY_DP decimals, or a fraction of a count base unit, is rejected.
 */
export const toBaseQuantity = (quantity: Decimal, factor: Decimal, base: UnitCode): Decimal => {
    const result = quantity.mul(factor);
    if (result.decimalPlaces() > QTY_DP) {
        throw new ApiError(400, `Quantity is too precise: at most ${QTY_DP} decimals of ${base}`);
    }
    if (!isLooseUnit(base) && !result.isInteger()) {
        throw new ApiError(400, `Quantity must be a whole number of ${base}`);
    }
    return result;
};
