import {z} from 'zod';
import {KiranaMaterial, Prisma, UnitCode} from '@prisma/client';
import prisma from 'client';
import ApiError from '@utils/ApiError';
import {isLooseUnit, resolveFactor} from '@utils/units';
import {catalogValidation} from '@validations/index';

type CreateProduct = z.infer<typeof catalogValidation.createProductSchema>;
type UpdateProduct = z.infer<typeof catalogValidation.updateProductSchema>;
type ProductQuery = z.infer<typeof catalogValidation.productQuerySchema>;
export type Db = Prisma.TransactionClient | typeof prisma;
type Decimal = Prisma.Decimal;
type FieldError = {field: string; message: string};

/** Who is asking: tenant and store from the session, never from the request. */
export type CatalogContext = {
    kiranaId: string;
    storeId: string;
    userId: string;
    canSeeCost: boolean;
};

const productInclude = (storeId: string) =>
    ({
        category: {select: {id: true, name: true}},
        brand: {select: {id: true, name: true}},
        units: {select: {unit: true, factor: true}, orderBy: {factor: 'asc'}},
        barcodes: {select: {code: true, unit: true}, orderBy: {createdAt: 'asc'}},
        aliases: {select: {alias: true}, orderBy: {alias: 'asc'}},
        stockBalances: {where: {storeId}, select: {quantity: true}},
    }) satisfies Prisma.KiranaMaterialInclude;

type ProductRow = Prisma.KiranaMaterialGetPayload<{include: ReturnType<typeof productInclude>}>;

const fixed = (d: Decimal | null, dp: number) => (d === null ? null : d.toFixed(dp));

export const serializeProduct = (p: ProductRow, canSeeCost: boolean) => {
    const qty = p.stockBalances[0]?.quantity ?? new Prisma.Decimal(0);
    return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        status: p.status,
        categoryId: p.categoryId,
        category: p.category,
        brandId: p.brandId,
        brand: p.brand,
        baseUnit: p.baseUnit,
        salesUnit: p.salesUnit,
        purchaseUnit: p.purchaseUnit,
        isLoose: isLooseUnit(p.baseUnit),
        units: [
            {unit: p.baseUnit, factor: '1'},
            ...p.units.map((u) => ({unit: u.unit, factor: u.factor.toString()})),
        ],
        barcodes: p.barcodes,
        aliases: p.aliases.map((a) => a.alias),
        sellingPrice: fixed(p.sellingPrice, 2),
        mrp: fixed(p.mrp, 2),
        ...(canSeeCost ? {purchaseCost: fixed(p.purchaseCost, 2)} : {}),
        hsnCode: p.hsnCode,
        gstRate: fixed(p.gstRate, 2),
        priceIncludesTax: p.priceIncludesTax,
        isFavourite: p.isFavourite,
        lowStockThreshold: fixed(p.lowStockThreshold, 3),
        stock: {
            quantity: qty.toFixed(3),
            isLow: p.lowStockThreshold !== null && qty.lte(p.lowStockThreshold),
        },
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
};

type Structure = {
    baseUnit: UnitCode;
    salesUnit: UnitCode;
    purchaseUnit: UnitCode;
    units: {unit: UnitCode; factor?: Decimal | null}[];
    barcodes: {code: string; unit: UnitCode}[];
};

/** Checks units, sales/purchase units and barcodes fit together; returns the extra units with canonical factors. */
export const checkStructure = (s: Structure) => {
    const errors: FieldError[] = [];
    const units = new Map<UnitCode, Decimal>([[s.baseUnit, new Prisma.Decimal(1)]]);
    s.units.forEach((u, i) => {
        if (units.has(u.unit)) {
            errors.push({field: `units.${i}.unit`, message: `${u.unit} is listed twice`});
            return;
        }
        const factor = resolveFactor(s.baseUnit, u.unit, u.factor);
        if (typeof factor === 'string') errors.push({field: `units.${i}.factor`, message: factor});
        else units.set(u.unit, factor);
    });
    // A referenced unit with a fixed metric factor (kg on a gram base) is added and stored, so
    // `units` and lookups always carry its factor, as the ledger already accepts it.
    const known = (unit: UnitCode) => {
        if (units.has(unit)) return true;
        const fixed = resolveFactor(s.baseUnit, unit);
        if (typeof fixed === 'string') return false;
        units.set(unit, fixed);
        return true;
    };
    for (const field of ['salesUnit', 'purchaseUnit'] as const) {
        if (!known(s[field])) {
            errors.push({field, message: `${s[field]} is not one of this product's units`});
        }
    }
    const seen = new Set<string>();
    s.barcodes.forEach((b, i) => {
        if (seen.has(b.code)) {
            errors.push({
                field: `barcodes.${i}.code`,
                message: `Barcode ${b.code} is listed twice`,
            });
        }
        seen.add(b.code);
        if (!known(b.unit)) {
            errors.push({
                field: `barcodes.${i}.unit`,
                message: `${b.unit} is not one of this product's units`,
            });
        }
    });
    if (errors.length) throw new ApiError(400, 'Validation failed', errors);
    return [...units.entries()]
        .filter(([unit]) => unit !== s.baseUnit)
        .map(([unit, factor]) => ({unit, factor}));
};

const assertRefs = async (
    db: Db,
    kiranaId: string,
    refs: {categoryId?: string | null; brandId?: string | null},
) => {
    if (refs.categoryId) {
        const found = await db.kiranaMaterialCategory.findFirst({
            where: {id: refs.categoryId, kiranaId},
            select: {id: true},
        });
        if (!found) throw new ApiError(404, 'Category not found');
    }
    if (refs.brandId) {
        const found = await db.brand.findFirst({
            where: {id: refs.brandId, kiranaId},
            select: {id: true},
        });
        if (!found) throw new ApiError(404, 'Brand not found');
    }
};

/** 409 with the conflicting product, so the client can offer to open or unarchive it. */
const assertNoConflicts = async (
    db: Db,
    kiranaId: string,
    fields: {name?: string; sku?: string | null; codes: string[]},
    excludeId?: string,
) => {
    const others = {kiranaId, ...(excludeId ? {id: {not: excludeId}} : {})};
    const select = {id: true, name: true, status: true} as const;
    const errors: object[] = [];
    const conflict = (
        field: string,
        message: string,
        p: {id: string; name: string; status: string},
    ) => errors.push({field, message, productId: p.id, productName: p.name, status: p.status});

    if (fields.name) {
        const p = await db.kiranaMaterial.findFirst({
            where: {...others, name: {equals: fields.name, mode: 'insensitive'}},
            select,
        });
        if (p) conflict('name', `A product named "${p.name}" already exists`, p);
    }
    if (fields.sku) {
        const p = await db.kiranaMaterial.findFirst({
            where: {...others, sku: {equals: fields.sku, mode: 'insensitive'}},
            select,
        });
        if (p) conflict('sku', `SKU ${fields.sku} belongs to "${p.name}"`, p);
    }
    if (fields.codes.length) {
        const taken = await db.productBarcode.findMany({
            where: {
                kiranaId,
                code: {in: fields.codes},
                ...(excludeId ? {productId: {not: excludeId}} : {}),
            },
            select: {code: true, product: {select}},
        });
        for (const b of taken)
            conflict('barcode', `Barcode ${b.code} belongs to "${b.product.name}"`, b.product);
    }
    if (errors.length) throw new ApiError(409, 'Duplicate product details', errors);
};

const PRICE_FIELDS = [
    'salesUnit',
    'sellingPrice',
    'mrp',
    'purchaseUnit',
    'purchaseCost',
    'hsnCode',
    'gstRate',
    'priceIncludesTax',
] as const;
type PriceSnapshot = Pick<KiranaMaterial, (typeof PRICE_FIELDS)[number]>;
const priceSnapshot = (p: PriceSnapshot): PriceSnapshot => ({
    salesUnit: p.salesUnit,
    sellingPrice: p.sellingPrice,
    mrp: p.mrp,
    purchaseUnit: p.purchaseUnit,
    purchaseCost: p.purchaseCost,
    hsnCode: p.hsnCode,
    gstRate: p.gstRate,
    priceIncludesTax: p.priceIncludesTax,
});
// Decimal.toString drops trailing zeros, so 45 and 45.00 compare equal.
const samePrices = (a: PriceSnapshot, b: PriceSnapshot) =>
    PRICE_FIELDS.every((k) => String(a[k] ?? null) === String(b[k] ?? null));

const unique = (values: string[]) => [...new Set(values)];

/** Creates a product with its units, barcodes, aliases and first price snapshot. */
export const createProductIn = async (db: Db, ctx: CatalogContext, data: CreateProduct) => {
    const salesUnit = data.salesUnit ?? data.baseUnit;
    const purchaseUnit = data.purchaseUnit ?? data.baseUnit;
    const barcodes = (data.barcodes ?? []).map((b) => ({
        code: b.code,
        unit: b.unit ?? data.baseUnit,
    }));
    const units = checkStructure({
        baseUnit: data.baseUnit,
        salesUnit,
        purchaseUnit,
        units: data.units ?? [],
        barcodes,
    });
    await assertRefs(db, ctx.kiranaId, data);
    await assertNoConflicts(db, ctx.kiranaId, {
        name: data.name,
        sku: data.sku,
        codes: barcodes.map((b) => b.code),
    });
    const prices: PriceSnapshot = {
        salesUnit,
        sellingPrice: data.sellingPrice ?? null,
        mrp: data.mrp ?? null,
        purchaseUnit,
        purchaseCost: data.purchaseCost ?? null,
        hsnCode: data.hsnCode ?? null,
        gstRate: data.gstRate ?? null,
        priceIncludesTax: data.priceIncludesTax ?? true,
    };
    return db.kiranaMaterial.create({
        data: {
            ...prices,
            kiranaId: ctx.kiranaId,
            name: data.name,
            sku: data.sku ?? null,
            isFavourite: data.isFavourite ?? false,
            categoryId: data.categoryId ?? null,
            brandId: data.brandId ?? null,
            baseUnit: data.baseUnit,
            lowStockThreshold: data.lowStockThreshold ?? null,
            units: {create: units},
            barcodes: {create: barcodes.map((b) => ({...b, kiranaId: ctx.kiranaId}))},
            aliases: {create: unique(data.aliases ?? []).map((alias) => ({alias}))},
            priceChanges: {
                create: {...prices, kiranaId: ctx.kiranaId, changedById: ctx.userId},
            },
        },
        include: productInclude(ctx.storeId),
    });
};

const findProduct = async (ctx: CatalogContext, id: string) => {
    const product = await prisma.kiranaMaterial.findFirst({
        where: {id, kiranaId: ctx.kiranaId},
        include: productInclude(ctx.storeId),
    });
    if (!product) throw new ApiError(404, 'Product not found');
    return product;
};

class CatalogService {
    // Categories and brands: simple named lists per business. Deleting one in use fails with 409 (FK).
    listCategories(kiranaId: string) {
        return prisma.kiranaMaterialCategory.findMany({where: {kiranaId}, orderBy: {name: 'asc'}});
    }
    async getCategory(kiranaId: string, id: string) {
        const category = await prisma.kiranaMaterialCategory.findFirst({where: {id, kiranaId}});
        if (!category) throw new ApiError(404, 'Category not found');
        return category;
    }
    createCategory(kiranaId: string, name: string) {
        return prisma.kiranaMaterialCategory.create({data: {name, kiranaId}});
    }
    async updateCategory(kiranaId: string, id: string, name: string) {
        await this.getCategory(kiranaId, id);
        return prisma.kiranaMaterialCategory.update({where: {id, kiranaId}, data: {name}});
    }
    async deleteCategory(kiranaId: string, id: string) {
        await this.getCategory(kiranaId, id);
        return prisma.kiranaMaterialCategory.delete({where: {id, kiranaId}});
    }

    listBrands(kiranaId: string) {
        return prisma.brand.findMany({where: {kiranaId}, orderBy: {name: 'asc'}});
    }
    async getBrand(kiranaId: string, id: string) {
        const brand = await prisma.brand.findFirst({where: {id, kiranaId}});
        if (!brand) throw new ApiError(404, 'Brand not found');
        return brand;
    }
    createBrand(kiranaId: string, name: string) {
        return prisma.brand.create({data: {name, kiranaId}});
    }
    async updateBrand(kiranaId: string, id: string, name: string) {
        await this.getBrand(kiranaId, id);
        return prisma.brand.update({where: {id, kiranaId}, data: {name}});
    }
    async deleteBrand(kiranaId: string, id: string) {
        await this.getBrand(kiranaId, id);
        return prisma.brand.delete({where: {id, kiranaId}});
    }

    async listProducts(ctx: CatalogContext, query: ProductQuery) {
        const where: Prisma.KiranaMaterialWhereInput = {
            kiranaId: ctx.kiranaId,
            ...(query.status !== 'ALL' ? {status: query.status} : {}),
            ...(query.categoryId ? {categoryId: query.categoryId} : {}),
            ...(query.brandId ? {brandId: query.brandId} : {}),
            ...(query.favourite === 'true' ? {isFavourite: true} : {}),
        };
        if (query.q) {
            const code = query.q.replace(/\s+/g, '');
            where.OR = [
                {name: {contains: query.q, mode: 'insensitive'}},
                {aliases: {some: {alias: {contains: query.q, mode: 'insensitive'}}}},
                {sku: {equals: query.q, mode: 'insensitive'}},
                {brand: {name: {contains: query.q, mode: 'insensitive'}}},
                {barcodes: {some: {code}}},
            ];
        }
        if (query.lowStock === 'true') {
            // A column-to-column comparison across tables, which Prisma's query API cannot express.
            const rows = await prisma.$queryRaw<{id: string}[]>`
                SELECT p."id" FROM "KiranaMaterial" p
                LEFT JOIN "StockBalance" b ON b."productId" = p."id" AND b."storeId" = ${ctx.storeId}
                WHERE p."kiranaId" = ${ctx.kiranaId} AND p."lowStockThreshold" IS NOT NULL
                  AND COALESCE(b."quantity", 0) <= p."lowStockThreshold"`;
            where.id = {in: rows.map((r) => r.id)};
        }
        const [total, items] = await prisma.$transaction([
            prisma.kiranaMaterial.count({where}),
            prisma.kiranaMaterial.findMany({
                where,
                include: productInclude(ctx.storeId),
                orderBy: {name: 'asc'},
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
        ]);
        return {
            items: items.map((p) => serializeProduct(p, ctx.canSeeCost)),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    async getProduct(ctx: CatalogContext, id: string) {
        return serializeProduct(await findProduct(ctx, id), ctx.canSeeCost);
    }

    async createProduct(ctx: CatalogContext, data: CreateProduct) {
        return serializeProduct(await createProductIn(prisma, ctx, data), ctx.canSeeCost);
    }

    async updateProduct(ctx: CatalogContext, id: string, data: UpdateProduct) {
        const existing = await findProduct(ctx, id);
        if (
            data.salesUnit &&
            data.salesUnit !== existing.salesUnit &&
            (data.sellingPrice === undefined || data.mrp === undefined)
        ) {
            throw new ApiError(
                400,
                'Changing the sales unit needs sellingPrice and mrp for the new unit',
            );
        }
        if (
            data.purchaseUnit &&
            data.purchaseUnit !== existing.purchaseUnit &&
            data.purchaseCost === undefined
        ) {
            throw new ApiError(
                400,
                'Changing the purchase unit needs purchaseCost for the new unit',
            );
        }
        const {units, barcodes, aliases, ...fields} = data;
        const nextBarcodes = barcodes
            ? barcodes.map((b) => ({code: b.code, unit: b.unit ?? existing.baseUnit}))
            : existing.barcodes;
        const nextUnits = checkStructure({
            baseUnit: existing.baseUnit,
            salesUnit: fields.salesUnit ?? existing.salesUnit,
            purchaseUnit: fields.purchaseUnit ?? existing.purchaseUnit,
            units: units ?? existing.units,
            barcodes: nextBarcodes,
        });

        const updated = await prisma.$transaction(async (tx) => {
            await assertRefs(tx, ctx.kiranaId, fields);
            await assertNoConflicts(
                tx,
                ctx.kiranaId,
                {
                    name: fields.name,
                    sku: fields.sku,
                    codes: barcodes ? nextBarcodes.map((b) => b.code) : [],
                },
                id,
            );
            // Also rewrite when checkStructure added an implied metric unit.
            if (units || nextUnits.length !== existing.units.length) {
                await tx.productUnit.deleteMany({where: {productId: id}});
                await tx.productUnit.createMany({
                    data: nextUnits.map((u) => ({...u, productId: id})),
                });
            }
            if (barcodes) {
                await tx.productBarcode.deleteMany({
                    where: {productId: id, kiranaId: ctx.kiranaId},
                });
                await tx.productBarcode.createMany({
                    data: nextBarcodes.map((b) => ({...b, productId: id, kiranaId: ctx.kiranaId})),
                });
            }
            if (aliases) {
                await tx.productAlias.deleteMany({where: {productId: id}});
                await tx.productAlias.createMany({
                    data: unique(aliases).map((alias) => ({alias, productId: id})),
                });
            }
            const product = await tx.kiranaMaterial.update({
                where: {id, kiranaId: ctx.kiranaId},
                data: fields,
                include: productInclude(ctx.storeId),
            });
            // Past snapshots are never edited; a change appends a new one.
            if (!samePrices(existing, product)) {
                await tx.productPriceChange.create({
                    data: {
                        ...priceSnapshot(product),
                        kiranaId: ctx.kiranaId,
                        productId: id,
                        changedById: ctx.userId,
                    },
                });
            }
            return product;
        });
        return serializeProduct(updated, ctx.canSeeCost);
    }

    async priceHistory(ctx: CatalogContext, id: string) {
        await findProduct(ctx, id);
        const rows = await prisma.productPriceChange.findMany({
            where: {productId: id, kiranaId: ctx.kiranaId},
            include: {changedBy: {select: {id: true, fullname: true}}},
            orderBy: {effectiveFrom: 'desc'},
        });
        return rows.map((r) => ({
            id: r.id,
            salesUnit: r.salesUnit,
            sellingPrice: fixed(r.sellingPrice, 2),
            mrp: fixed(r.mrp, 2),
            purchaseUnit: r.purchaseUnit,
            ...(ctx.canSeeCost ? {purchaseCost: fixed(r.purchaseCost, 2)} : {}),
            hsnCode: r.hsnCode,
            gstRate: fixed(r.gstRate, 2),
            priceIncludesTax: r.priceIncludesTax,
            effectiveFrom: r.effectiveFrom,
            changedBy: r.changedBy,
        }));
    }

    /** Scan or type a code: exact barcode first, then SKU. Active products only. */
    async lookup(ctx: CatalogContext, rawCode: string) {
        const include = productInclude(ctx.storeId);
        const barcode = await prisma.productBarcode.findFirst({
            where: {
                kiranaId: ctx.kiranaId,
                code: rawCode.replace(/\s+/g, ''),
                product: {status: 'ACTIVE'},
            },
            select: {unit: true, product: {include}},
        });
        let product: ProductRow | null = barcode?.product ?? null;
        let unit = barcode?.unit;
        if (!product) {
            product = await prisma.kiranaMaterial.findFirst({
                where: {
                    kiranaId: ctx.kiranaId,
                    status: 'ACTIVE',
                    sku: {equals: rawCode.trim(), mode: 'insensitive'},
                },
                include,
            });
            unit = product?.salesUnit;
        }
        if (!product || !unit) throw new ApiError(404, 'No product with this barcode or SKU');
        const serialized = serializeProduct(product, ctx.canSeeCost);
        const factor = serialized.units.find((u) => u.unit === unit)?.factor ?? '1';
        return {product: serialized, unit, factor};
    }
}

export default new CatalogService();
