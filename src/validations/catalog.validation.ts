import {z} from 'zod';
import {ProductStatus, StockMovementType, UnitCode} from '@prisma/client';
import {decimal, money, quantity} from './custom.validation';

const id = z.string().uuid('Invalid ID format.');
const unit = z.nativeEnum(UnitCode);
const name = z.string().trim().min(1).max(100);

/** Categories and brands. */
const namedSchema = z.object({name}).strict();

// Scanners and people paste codes with stray spaces; they are removed, never rejected.
const barcode = z
    .string()
    .max(80)
    .transform((s) => s.replace(/\s+/g, ''))
    .refine((s) => /^[\x21-\x7E]{1,64}$/.test(s), 'Barcode must be 1-64 characters, no spaces');

const productFields = {
    name,
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    categoryId: id.nullable().optional(),
    brandId: id.nullable().optional(),
    salesUnit: unit.optional(),
    purchaseUnit: unit.optional(),
    // Factor = base units in one of this unit. Optional for metric units (fixed, e.g. 1 kg = 1000 g).
    units: z
        .array(
            z
                .object({unit, factor: decimal({dp: 6, positive: true, max: 1_000_000}).optional()})
                .strict(),
        )
        .max(7)
        .optional(),
    barcodes: z
        .array(z.object({code: barcode, unit: unit.optional()}).strict())
        .max(20)
        .optional(),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    sellingPrice: money().nullable().optional(),
    mrp: money().nullable().optional(),
    purchaseCost: money().nullable().optional(),
    hsnCode: z
        .string()
        .trim()
        .regex(/^\d{4,8}$/, 'HSN code is 4 to 8 digits')
        .nullable()
        .optional(),
    gstRate: decimal({dp: 2, min: 0, max: 100}).nullable().optional(),
    priceIncludesTax: z.boolean().optional(),
    lowStockThreshold: decimal({dp: 3, min: 0}).nullable().optional(),
};

const createProductSchema = z.object({...productFields, baseUnit: unit}).strict();
// The base unit is fixed once created: every ledger quantity is in it.
const updateProductSchema = z
    .object({
        ...productFields,
        name: name.optional(),
        status: z.nativeEnum(ProductStatus).optional(),
    })
    .strict();

const page = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

const productQuerySchema = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
    categoryId: id.optional(),
    brandId: id.optional(),
    lowStock: z.enum(['true', 'false']).optional(),
    ...page,
});

const lookupQuerySchema = z.object({code: z.string().trim().min(1).max(80)});

// CSV cells arrive as strings; the import service parses them with the product schema above.
const cell = z.string().max(200).optional();
const importRowSchema = z
    .object({
        name: cell,
        category: cell,
        brand: cell,
        sku: cell,
        barcodes: z.string().max(1000).optional(),
        baseUnit: cell,
        sellingPrice: cell,
        mrp: cell,
        purchaseCost: cell,
        hsnCode: cell,
        gstRate: cell,
        lowStockThreshold: cell,
        openingStock: cell,
    })
    .strict();
const importSchema = z
    .object({rows: z.array(importRowSchema).min(1).max(1000), dryRun: z.boolean()})
    .strict();

// Sales and purchase movements are posted by their documents (Phases 4 and 6), not by hand.
const MANUAL_MOVEMENT_TYPES = ['OPENING', 'DAMAGE', 'EXPIRY', 'ADJUSTMENT'] as const;
const createMovementSchema = z
    .object({
        productId: id,
        type: z.enum(MANUAL_MOVEMENT_TYPES),
        quantity: quantity(),
        unit: unit.optional(),
        unitCost: money().nullable().optional(),
        reason: z.string().trim().min(1).max(200).optional(),
        reference: z.string().trim().min(1).max(100).optional(),
        idempotencyKey: z.string().trim().min(8).max(100).optional(),
    })
    .strict();

const movementQuerySchema = z.object({
    productId: id.optional(),
    type: z.nativeEnum(StockMovementType).optional(),
    ...page,
});

export default {
    namedSchema,
    createProductSchema,
    updateProductSchema,
    productQuerySchema,
    lookupQuerySchema,
    importRowSchema,
    importSchema,
    createMovementSchema,
    movementQuerySchema,
};
