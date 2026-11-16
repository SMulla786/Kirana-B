import {Request} from 'express';
import httpStatus from 'http-status';
import {catalogService, importService} from '@services/kirana';
import {catchAsync, ApiResponse, ApiError} from '@utils/index';
import {catalogValidation, commonValidation} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';
import {hasPermission} from '@config/permissions';

const v = catalogValidation;

/** Tenant, store and cost visibility, all from the session. */
export const catalogContext = (req: Request) => {
    const t = tenantOf(req);
    if (!t.storeId) throw new ApiError(httpStatus.CONFLICT, 'No store selected for this session');
    return {
        kiranaId: t.kiranaId,
        storeId: t.storeId,
        userId: t.id,
        canSeeCost: hasPermission(t.membershipRole, 'catalog.cost.view'),
    };
};

const ok = (data: unknown, message: string) => new ApiResponse(httpStatus.OK, data, message);
const created = (data: unknown, message: string) =>
    new ApiResponse(httpStatus.CREATED, data, message);
const idOf = (req: Request) => commonValidation.idSchema.parse(req.params.id);

export default {
    listCategories: catchAsync(async (req, res) => {
        res.json(ok(await catalogService.listCategories(tenantOf(req).kiranaId), 'Categories'));
    }),
    getCategory: catchAsync(async (req, res) => {
        res.json(
            ok(await catalogService.getCategory(tenantOf(req).kiranaId, idOf(req)), 'Category'),
        );
    }),
    createCategory: catchAsync(async (req, res) => {
        const {name} = v.namedSchema.parse(req.body);
        const category = await catalogService.createCategory(tenantOf(req).kiranaId, name);
        res.status(httpStatus.CREATED).json(created(category, 'Category created'));
    }),
    updateCategory: catchAsync(async (req, res) => {
        const {name} = v.namedSchema.parse(req.body);
        const category = await catalogService.updateCategory(
            tenantOf(req).kiranaId,
            idOf(req),
            name,
        );
        res.json(ok(category, 'Category updated'));
    }),
    deleteCategory: catchAsync(async (req, res) => {
        const category = await catalogService.deleteCategory(tenantOf(req).kiranaId, idOf(req));
        res.json(ok(category, 'Category deleted'));
    }),

    listBrands: catchAsync(async (req, res) => {
        res.json(ok(await catalogService.listBrands(tenantOf(req).kiranaId), 'Brands'));
    }),
    createBrand: catchAsync(async (req, res) => {
        const {name} = v.namedSchema.parse(req.body);
        const brand = await catalogService.createBrand(tenantOf(req).kiranaId, name);
        res.status(httpStatus.CREATED).json(created(brand, 'Brand created'));
    }),
    updateBrand: catchAsync(async (req, res) => {
        const {name} = v.namedSchema.parse(req.body);
        res.json(
            ok(
                await catalogService.updateBrand(tenantOf(req).kiranaId, idOf(req), name),
                'Brand updated',
            ),
        );
    }),
    deleteBrand: catchAsync(async (req, res) => {
        res.json(
            ok(
                await catalogService.deleteBrand(tenantOf(req).kiranaId, idOf(req)),
                'Brand deleted',
            ),
        );
    }),

    listProducts: catchAsync(async (req, res) => {
        const query = v.productQuerySchema.parse(req.query);
        res.json(ok(await catalogService.listProducts(catalogContext(req), query), 'Products'));
    }),
    getProduct: catchAsync(async (req, res) => {
        res.json(ok(await catalogService.getProduct(catalogContext(req), idOf(req)), 'Product'));
    }),
    createProduct: catchAsync(async (req, res) => {
        const data = v.createProductSchema.parse(req.body);
        const product = await catalogService.createProduct(catalogContext(req), data);
        res.status(httpStatus.CREATED).json(created(product, 'Product created'));
    }),
    updateProduct: catchAsync(async (req, res) => {
        const ctx = catalogContext(req);
        const id = idOf(req);
        const data = v.updateProductSchema.parse(req.body);
        res.json(ok(await catalogService.updateProduct(ctx, id, data), 'Product updated'));
    }),
    priceHistory: catchAsync(async (req, res) => {
        res.json(
            ok(await catalogService.priceHistory(catalogContext(req), idOf(req)), 'Price history'),
        );
    }),
    lookup: catchAsync(async (req, res) => {
        const {code} = v.lookupQuerySchema.parse(req.query);
        res.json(ok(await catalogService.lookup(catalogContext(req), code), 'Product found'));
    }),
    importProducts: catchAsync(async (req, res) => {
        const ctx = catalogContext(req);
        const {rows, dryRun} = v.importSchema.parse(req.body);
        const canManageStock = hasPermission(tenantOf(req).membershipRole, 'stock.manage');
        const report = await importService.importProducts({...ctx, canManageStock}, rows, dryRun);
        const status = dryRun ? httpStatus.OK : httpStatus.CREATED;
        res.status(status).json(
            new ApiResponse(status, report, dryRun ? 'Import preview' : 'Products imported'),
        );
    }),
};
