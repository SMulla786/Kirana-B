import {z} from 'zod';
import {Prisma, UnitCode} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {toBaseQuantity} from '@utils/units';
import {catalogValidation} from '@validations/index';
import {quantity} from '@validations/custom.validation';
import {CatalogContext, checkStructure, createProductIn} from './catalog.service';
import {applyMovement} from './stock.service';

type ImportRow = z.infer<typeof catalogValidation.importRowSchema>;
type CreateProduct = z.infer<typeof catalogValidation.createProductSchema>;
type FieldError = {field: string; message: string};
type Parsed = {
    row: number;
    data: CreateProduct;
    category?: string;
    brand?: string;
    opening?: Prisma.Decimal;
};

// Spreadsheet spellings shopkeepers actually use. Exact UnitCode names also work.
const UNIT_WORDS: Record<string, UnitCode> = {
    pc: 'PIECE',
    pcs: 'PIECE',
    piece: 'PIECE',
    pieces: 'PIECE',
    nos: 'PIECE',
    no: 'PIECE',
    pkt: 'PACKET',
    packet: 'PACKET',
    packets: 'PACKET',
    box: 'BOX',
    boxes: 'BOX',
    ctn: 'CARTON',
    carton: 'CARTON',
    cartons: 'CARTON',
    g: 'GRAM',
    gm: 'GRAM',
    gms: 'GRAM',
    gram: 'GRAM',
    grams: 'GRAM',
    kg: 'KILOGRAM',
    kgs: 'KILOGRAM',
    kilogram: 'KILOGRAM',
    kilograms: 'KILOGRAM',
    ml: 'MILLILITRE',
    millilitre: 'MILLILITRE',
    milliliter: 'MILLILITRE',
    l: 'LITRE',
    ltr: 'LITRE',
    litre: 'LITRE',
    liter: 'LITRE',
    litres: 'LITRE',
    liters: 'LITRE',
};
export const parseUnit = (text: string): UnitCode | undefined => {
    const word = text.trim().toLowerCase();
    return UNIT_WORDS[word] ?? Object.values(UnitCode).find((u) => u.toLowerCase() === word);
};

const blank = (v?: string) => (v === undefined || v.trim() === '' ? undefined : v.trim());
const lower = (s: string) => s.toLowerCase();

class ImportService {
    /**
     * Validates every row against the product rules, the file itself and the catalogue. A dry run
     * reports; a commit writes everything in one transaction or nothing at all.
     */
    async importProducts(
        ctx: CatalogContext & {canManageStock: boolean},
        rows: ImportRow[],
        dryRun: boolean,
    ) {
        if (!ctx.canManageStock && rows.some((r) => blank(r.openingStock))) {
            throw new ApiError(403, 'Recording opening stock needs the stock.manage permission');
        }
        const errors = new Map<number, FieldError[]>();
        const fail = (row: number, field: string, message: string) =>
            errors.set(row, [...(errors.get(row) ?? []), {field, message}]);
        const parsed: Parsed[] = [];

        rows.forEach((r, i) => {
            const row = i + 1;
            const unitText = blank(r.baseUnit);
            const baseUnit = unitText ? parseUnit(unitText) : undefined;
            if (unitText && !baseUnit) fail(row, 'baseUnit', `Unknown unit "${unitText}"`);
            const result = catalogValidation.createProductSchema.safeParse({
                name: blank(r.name),
                sku: blank(r.sku),
                baseUnit: unitText ? (baseUnit ?? 'PIECE') : undefined,
                barcodes: (r.barcodes ?? '')
                    .split(';')
                    .map((c) => c.trim())
                    .filter(Boolean)
                    .map((code) => ({code})),
                sellingPrice: blank(r.sellingPrice),
                mrp: blank(r.mrp),
                purchaseCost: blank(r.purchaseCost),
                hsnCode: blank(r.hsnCode),
                gstRate: blank(r.gstRate),
                lowStockThreshold: blank(r.lowStockThreshold),
            });
            if (!result.success) {
                for (const issue of result.error.issues) {
                    fail(row, issue.path.join('.') || 'row', issue.message);
                }
                return;
            }
            let opening: Prisma.Decimal | undefined;
            const openingText = blank(r.openingStock);
            if (openingText) {
                const q = quantity().safeParse(openingText);
                if (!q.success) fail(row, 'openingStock', q.error.issues[0].message);
                else if (q.data.lte(0)) fail(row, 'openingStock', 'Must be greater than 0');
                else opening = q.data;
            }
            try {
                const d = result.data;
                checkStructure({
                    baseUnit: d.baseUnit,
                    salesUnit: d.baseUnit,
                    purchaseUnit: d.baseUnit,
                    units: [],
                    barcodes: (d.barcodes ?? []).map((b) => ({code: b.code, unit: d.baseUnit})),
                });
                if (opening) toBaseQuantity(opening, new Prisma.Decimal(1), d.baseUnit);
            } catch (e) {
                if (!(e instanceof ApiError)) throw e;
                const details = e.errors as FieldError[];
                if (details.length) details.forEach((x) => fail(row, x.field, x.message));
                else fail(row, 'openingStock', e.message);
            }
            parsed.push({
                row,
                data: result.data,
                category: blank(r.category),
                brand: blank(r.brand),
                opening,
            });
        });

        // Duplicates inside the file: every later copy is an error.
        const seen = {
            name: new Map<string, number>(),
            sku: new Map<string, number>(),
            barcode: new Map<string, number>(),
        };
        const once = (kind: keyof typeof seen, key: string, row: number, label: string) => {
            const first = seen[kind].get(key);
            if (first) fail(row, kind, `${label} repeats row ${first}`);
            else seen[kind].set(key, row);
        };
        for (const p of parsed) {
            once('name', lower(p.data.name), p.row, `Name "${p.data.name}"`);
            if (p.data.sku) once('sku', lower(p.data.sku), p.row, `SKU ${p.data.sku}`);
            for (const b of p.data.barcodes ?? [])
                once('barcode', b.code, p.row, `Barcode ${b.code}`);
        }

        // Clashes with the existing catalogue (archived products included).
        const kiranaId = ctx.kiranaId;
        const [names, skus, codes, categories, brands] = await Promise.all([
            prisma.kiranaMaterial.findMany({
                where: {kiranaId, name: {in: parsed.map((p) => p.data.name), mode: 'insensitive'}},
                select: {name: true},
            }),
            prisma.kiranaMaterial.findMany({
                where: {
                    kiranaId,
                    sku: {
                        in: parsed.flatMap((p) => (p.data.sku ? [p.data.sku] : [])),
                        mode: 'insensitive',
                    },
                },
                select: {sku: true},
            }),
            prisma.productBarcode.findMany({
                where: {
                    kiranaId,
                    code: {in: parsed.flatMap((p) => (p.data.barcodes ?? []).map((b) => b.code))},
                },
                select: {code: true, product: {select: {name: true}}},
            }),
            prisma.kiranaMaterialCategory.findMany({
                where: {kiranaId},
                select: {id: true, name: true},
            }),
            prisma.brand.findMany({where: {kiranaId}, select: {id: true, name: true}}),
        ]);
        const takenNames = new Set(names.map((n) => lower(n.name)));
        const takenSkus = new Set(skus.map((s) => lower(s.sku ?? '')));
        const takenCodes = new Map(codes.map((c) => [c.code, c.product.name]));
        for (const p of parsed) {
            if (takenNames.has(lower(p.data.name)))
                fail(p.row, 'name', `"${p.data.name}" already exists`);
            if (p.data.sku && takenSkus.has(lower(p.data.sku)))
                fail(p.row, 'sku', `SKU ${p.data.sku} already exists`);
            for (const b of p.data.barcodes ?? []) {
                const owner = takenCodes.get(b.code);
                if (owner) fail(p.row, 'barcode', `Barcode ${b.code} belongs to "${owner}"`);
            }
        }

        const categoryIds = new Map(categories.map((c) => [lower(c.name), c.id]));
        const brandIds = new Map(brands.map((b) => [lower(b.name), b.id]));
        const newNames = (values: (string | undefined)[], known: Map<string, string>) => {
            const out = new Map<string, string>();
            for (const v of values)
                if (v && !known.has(lower(v)) && !out.has(lower(v))) out.set(lower(v), v);
            return [...out.values()];
        };
        const newCategories = newNames(
            parsed.map((p) => p.category),
            categoryIds,
        );
        const newBrands = newNames(
            parsed.map((p) => p.brand),
            brandIds,
        );

        const report = {
            valid: errors.size === 0,
            rows: [...errors.entries()]
                .sort(([a], [b]) => a - b)
                .map(([row, errs]) => ({row, name: blank(rows[row - 1].name) ?? '', errors: errs})),
            newCategories,
            newBrands,
            created: errors.size === 0 ? rows.length : 0,
        };
        if (dryRun) return report;
        if (!report.valid) {
            throw new ApiError(
                422,
                'Import has errors; nothing was imported',
                report.rows.flatMap((r) => r.errors.map((e) => ({row: r.row, ...e}))),
            );
        }

        await prisma.$transaction(
            async (tx) => {
                for (const name of newCategories) {
                    const c = await tx.kiranaMaterialCategory.create({data: {kiranaId, name}});
                    categoryIds.set(lower(name), c.id);
                }
                for (const name of newBrands) {
                    const b = await tx.brand.create({data: {kiranaId, name}});
                    brandIds.set(lower(name), b.id);
                }
                for (const p of parsed) {
                    const product = await createProductIn(tx, ctx, {
                        ...p.data,
                        categoryId: p.category ? categoryIds.get(lower(p.category)) : null,
                        brandId: p.brand ? brandIds.get(lower(p.brand)) : null,
                    });
                    if (p.opening) {
                        await applyMovement(tx, ctx, {
                            productId: product.id,
                            type: 'OPENING',
                            quantity: p.opening,
                            unitCost: p.data.purchaseCost ?? null,
                            reason: 'Opening stock (import)',
                            reference: `Import row ${p.row}`,
                        });
                    }
                }
            },
            // shortcut: one transaction for up to 1000 rows, about 6 queries per row; batch it if imports grow.
            {timeout: 120_000, maxWait: 10_000},
        );
        return report;
    }
}

export default new ImportService();
