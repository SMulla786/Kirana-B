import {z} from 'zod';
import {GstScheme, Prisma, UnitCode} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {resolveFactor, toBaseQuantity} from '@utils/units';
import {posValidation} from '@validations/index';
import {round2} from './billing';

type Decimal = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
type LineInput = z.infer<typeof posValidation.holdBillSchema>['lines'][number];

/** What the person pricing the cart may do. */
export type PriceContext = {kiranaId: string; canDiscount: boolean; canOverridePrice: boolean};

const productQuery = {include: {units: {select: {unit: true, factor: true}}}} as const;
type ProductRow = Prisma.KiranaMaterialGetPayload<typeof productQuery>;

export type PricedLine = {
    product: ProductRow;
    unit: UnitCode;
    factor: Decimal;
    quantity: Decimal;
    unitPrice: Decimal; // per `unit`, display only
    gross: Decimal;
    discount: Decimal;
    priceOverridden: boolean;
};

/**
 * Prices cart lines from the catalogue, as the server is the authority (A-028). Shared by held bills,
 * the checkout preview and sale completion, so all three agree to the paisa.
 */
export async function priceLines(ctx: PriceContext, lines: LineInput[]): Promise<PricedLine[]> {
    const ids = [...new Set(lines.map((l) => l.productId))];
    const products = await prisma.kiranaMaterial.findMany({
        where: {id: {in: ids}, kiranaId: ctx.kiranaId, status: 'ACTIVE'},
        ...productQuery,
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    if (ids.some((id) => !byId.has(id))) throw new ApiError(404, 'Product not found');

    return lines.map((l, i) => {
        const fail = (status: number, message: string): never => {
            throw new ApiError(status, message, [{field: `lines.${i}`, message}]);
        };
        const p = byId.get(l.productId)!;
        // A stored pack size, else a fixed metric factor (kg on a gram base), as applyMovement does.
        const factorOf = (unit: UnitCode) => {
            const fixed = resolveFactor(p.baseUnit, unit);
            const stored = p.units.find((u) => u.unit === unit)?.factor;
            return stored ?? (typeof fixed === 'string' ? undefined : fixed);
        };
        const factor = factorOf(l.unit);
        if (!factor) return fail(400, `${l.unit} is not one of this product's units`);
        toBaseQuantity(l.quantity, factor, p.baseUnit); // throws 400 on bad precision/fraction

        // sellingPrice is per sales unit. The gross is never built from a rounded unit price, or
        // 750 g at ₹45/kg would bill ₹37.50 and picking a smaller unit would be a hidden discount.
        const salesFactor = factorOf(p.salesUnit) ?? D(1);
        const shown = p.sellingPrice && round2(p.sellingPrice.mul(factor).div(salesFactor));
        const overridden = !!l.unitPrice && !(shown && l.unitPrice.equals(shown));
        if (overridden) {
            if (!ctx.canOverridePrice) return fail(403, 'You cannot change the price');
        } else if (!shown) {
            return fail(400, `"${p.name}" has no price; enter one`);
        }
        const unitPrice = overridden ? l.unitPrice! : shown!;
        const gross = round2(
            overridden
                ? l.quantity.mul(unitPrice)
                : l.quantity.mul(factor).mul(p.sellingPrice!).div(salesFactor),
        );
        const discount = l.discount ?? D(0);
        if (discount.gt(0) && !ctx.canDiscount) return fail(403, 'You cannot give a discount');
        if (discount.gt(gross)) return fail(400, 'Discount cannot exceed the line amount');
        return {
            product: p,
            unit: l.unit,
            factor,
            quantity: l.quantity,
            unitPrice,
            gross,
            discount,
            priceOverridden: overridden,
        };
    });
}

export type TaxedLine = PricedLine & {
    gstRate: Decimal;
    taxableValue: Decimal;
    cgst: Decimal;
    sgst: Decimal;
    total: Decimal; // payable for the line, tax included
};

/**
 * GST per line (A-030). Only a REGULAR business charges tax: CGST + SGST, half each, since a counter
 * sale is intra-state. A tax-inclusive price is split back into taxable value + tax; an exclusive one
 * has tax added on top. Discounts come off before tax. UNREGISTERED and COMPOSITION bills carry no tax.
 */
export function taxLine(scheme: GstScheme, l: PricedLine): TaxedLine {
    const net = l.gross.sub(l.discount);
    const rate = scheme === 'REGULAR' ? (l.product.gstRate ?? D(0)) : D(0);
    let taxableValue = net;
    let tax = D(0);
    if (rate.gt(0)) {
        if (l.product.priceIncludesTax) {
            taxableValue = round2(net.mul(100).div(rate.add(100)));
            tax = net.sub(taxableValue);
        } else {
            tax = round2(net.mul(rate).div(100));
        }
    }
    const cgst = round2(tax.div(2));
    return {
        ...l,
        gstRate: rate,
        taxableValue,
        cgst,
        sgst: tax.sub(cgst),
        total: taxableValue.add(tax),
    };
}
