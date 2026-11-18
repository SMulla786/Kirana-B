import {z} from 'zod';
import {
    extendZodWithOpenApi,
    OpenAPIRegistry,
    OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import {MembershipRole, ProductStatus, Role, StockMovementType, UnitCode} from '@prisma/client';
import {
    userValidation,
    businessValidation,
    catalogValidation,
    commonValidation,
    clientValidation,
    posValidation,
} from '@validations/index';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
});
registry.registerComponent('securitySchemes', 'cookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'accessToken',
});

// Mirrors ApiResponse. Data shapes below mirror what the services return.
const envelope = <T extends z.ZodTypeAny>(data: T) =>
    z.object({
        statusCode: z.number(),
        status: z.boolean(),
        message: z.string(),
        data,
        errors: z.array(z.unknown()).optional(),
    });

const date = z.string().datetime();
const id = z.string().uuid();
const role = z.nativeEnum(MembershipRole);
const idRef = z.object({id, name: z.string()});

const Me = z
    .object({
        user: z.object({
            id,
            username: z.string(),
            email: z.string(),
            fullname: z.string(),
            phoneNumber: z.string(),
            role: z.nativeEnum(Role).openapi('UserRole'),
        }),
        business: idRef.nullable(),
        store: idRef.nullable(),
        membershipRole: role.nullable(),
        permissions: z.array(z.string()),
    })
    .openapi('Me');

const Tokens = z.object({
    accessToken: z.string(),
    accessTokenExpiresAt: date,
    refreshToken: z.string(),
    refreshTokenExpiresAt: date,
});
const LoginData = Tokens.extend({me: Me}).openapi('LoginData');
const Session = z
    .object({
        id,
        deviceName: z.string().nullable(),
        userAgent: z.string().nullable(),
        ip: z.string().nullable(),
        createdAt: date,
        lastUsedAt: date,
        current: z.boolean(),
    })
    .openapi('Session');
const Profile = z
    .object({
        id,
        username: z.string(),
        email: z.string(),
        fullname: z.string(),
        phoneNumber: z.string(),
        secondaryPhoneNumber: z.string().nullable(),
    })
    .openapi('Profile');
const Store = z.object({
    id,
    name: z.string(),
    address: z.string().nullable(),
    isDefault: z.boolean(),
});
const Business = z
    .object({
        id,
        name: z.string(),
        address: z.string(),
        City: z.string(),
        gstin: z.string().nullable(),
        createdAt: date,
        stores: z.array(Store),
    })
    .openapi('Business');
const Member = z
    .object({
        id,
        role,
        isActive: z.boolean(),
        createdAt: date,
        user: z.object({
            id,
            username: z.string(),
            fullname: z.string(),
            email: z.string(),
            phoneNumber: z.string(),
        }),
    })
    .openapi('Member');
const Category = z
    .object({id, name: z.string(), kiranaId: id, createdAt: date, updatedAt: date})
    .openapi('Category');
const Brand = z
    .object({id, name: z.string(), kiranaId: id, createdAt: date, updatedAt: date})
    .openapi('Brand');
const unitCode = z.nativeEnum(UnitCode).openapi('UnitCode');
const money = z.string().openapi({example: '45.00', description: 'Decimal, 2 places'});
const qty = z.string().openapi({example: '12.000', description: 'Decimal, 3 places, base unit'});
const Product = z
    .object({
        id,
        name: z.string(),
        sku: z.string().nullable(),
        status: z.nativeEnum(ProductStatus).openapi('ProductStatus'),
        categoryId: id.nullable(),
        category: idRef.nullable(),
        brandId: id.nullable(),
        brand: idRef.nullable(),
        baseUnit: unitCode,
        salesUnit: unitCode,
        purchaseUnit: unitCode,
        isLoose: z.boolean().openapi({description: 'Mass/volume base: fractional quantities'}),
        units: z.array(
            z.object({
                unit: unitCode,
                factor: z.string().openapi({description: 'Base units in one of this unit'}),
            }),
        ),
        barcodes: z.array(z.object({code: z.string(), unit: unitCode})),
        aliases: z.array(z.string()),
        sellingPrice: money.nullable().openapi({description: 'Per sales unit'}),
        mrp: money.nullable().openapi({description: 'Per sales unit'}),
        purchaseCost: money.nullable().optional().openapi({
            description: 'Per purchase unit. Absent without the catalog.cost.view permission.',
        }),
        hsnCode: z.string().nullable(),
        gstRate: money.nullable(),
        priceIncludesTax: z.boolean(),
        isFavourite: z.boolean(),
        lowStockThreshold: qty.nullable(),
        stock: z.object({quantity: qty, isLow: z.boolean()}),
        createdAt: date,
        updatedAt: date,
    })
    .openapi('Product');
const pageOf = <T extends z.ZodTypeAny>(item: T) =>
    z.object({
        items: z.array(item),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
    });
const PriceChange = z
    .object({
        id,
        salesUnit: unitCode,
        sellingPrice: money.nullable(),
        mrp: money.nullable(),
        purchaseUnit: unitCode,
        purchaseCost: money.nullable().optional(),
        hsnCode: z.string().nullable(),
        gstRate: money.nullable(),
        priceIncludesTax: z.boolean(),
        effectiveFrom: date,
        changedBy: z.object({id, fullname: z.string()}),
    })
    .openapi('PriceChange');
const Lookup = z.object({product: Product, unit: unitCode, factor: z.string()}).openapi('Lookup');
const ImportReport = z
    .object({
        valid: z.boolean(),
        rows: z.array(
            z.object({
                row: z.number().int(),
                name: z.string(),
                errors: z.array(z.object({field: z.string(), message: z.string()})),
            }),
        ),
        newCategories: z.array(z.string()),
        newBrands: z.array(z.string()),
        created: z.number().int(),
    })
    .openapi('ImportReport');
const Movement = z
    .object({
        id,
        productId: id,
        product: z.object({id, name: z.string(), baseUnit: unitCode}),
        type: z.nativeEnum(StockMovementType).openapi('StockMovementType'),
        quantity: qty.openapi({description: 'Signed, base unit'}),
        balanceAfter: qty,
        enteredQuantity: qty,
        enteredUnit: unitCode,
        unitCost: money.nullable().optional(),
        reason: z.string().nullable(),
        reference: z.string().nullable(),
        actor: z.object({id, fullname: z.string()}),
        createdAt: date,
    })
    .openapi('StockMovement');
const Customer = z.object({id, name: z.string(), phoneNumber: z.string()}).openapi('Customer');
const personRef = z.object({id, fullname: z.string()});
const HeldBill = z
    .object({
        id,
        note: z.string().nullable(),
        customer: Customer.nullable(),
        lines: z.array(
            z.object({
                productId: id,
                productName: z.string(),
                product: Product.nullable().openapi({
                    description:
                        'Current catalogue entry (cost shown only with catalog.cost.view); null if archived or removed',
                }),
                unit: unitCode,
                factor: z.string().openapi({description: 'Base units in one of this unit'}),
                quantity: qty.openapi({description: 'In the selected unit'}),
                unitPrice: money.openapi({
                    description:
                        'Per selected unit, for display (rounded; gross is not built from it)',
                }),
                gross: money.openapi({
                    description:
                        'Catalogue: round2(quantity x factor x sellingPrice / salesFactor). Overridden: round2(quantity x unitPrice)',
                }),
                discount: money,
                lineTotal: money.openapi({description: 'gross - discount'}),
                priceOverridden: z.boolean().openapi({
                    description:
                        'The stored unitPrice differed from the catalogue price at hold time',
                }),
            }),
        ),
        subtotal: money,
        discountTotal: money,
        total: money,
        createdBy: personRef,
        createdAt: date,
    })
    .openapi('HeldBill');
const HeldBillSummary = z
    .object({
        id,
        note: z.string().nullable(),
        customer: idRef.nullable(),
        lineCount: z.number().int(),
        total: money,
        createdBy: personRef,
        createdAt: date,
    })
    .openapi('HeldBillSummary');
const Health = z.object({status: z.string(), db: z.string()});
const NewBusiness = z.object({
    business: idRef,
    store: idRef,
    owner: z.object({id, username: z.string(), email: z.string()}),
});

const idParams = z.object({id: commonValidation.idSchema});
const json = <T extends z.ZodTypeAny>(schema: T) => ({content: {'application/json': {schema}}});
const NoData = envelope(z.unknown().optional());
const ErrorResponse = NoData.openapi('ErrorResponse');
// 409 from login when the user belongs to several businesses and sent no kiranaId.
const BusinessChoice = idRef.openapi('BusinessChoice');
const SelectBusiness = NoData.extend({errors: z.array(BusinessChoice)}).openapi('SelectBusiness');

type Method = 'get' | 'post' | 'patch' | 'delete';
type Op = {
    method: Method;
    path: string;
    tag: string;
    summary: string;
    permission?: string; // omit for public routes
    authenticated?: boolean;
    body?: z.ZodTypeAny;
    params?: z.AnyZodObject;
    query?: z.AnyZodObject;
    data?: z.ZodTypeAny; // omit for an empty data field
    status?: number;
    extraResponses?: Record<number, {description: string; schema: z.ZodTypeAny}>;
};

const route = (op: Op) => {
    const authed = op.authenticated ?? !!op.permission;
    const ok = op.status ?? 200;
    registry.registerPath({
        method: op.method,
        path: op.path,
        tags: [op.tag],
        summary: op.summary,
        description: op.permission ? `Requires permission \`${op.permission}\`.` : undefined,
        security: authed ? [{bearer: []}, {cookie: []}] : undefined,
        request: {
            ...(op.params ? {params: op.params} : {}),
            ...(op.query ? {query: op.query} : {}),
            ...(op.body ? {body: {required: true, ...json(op.body)}} : {}),
        },
        responses: {
            [ok]: {description: 'Success', ...json(op.data ? envelope(op.data) : NoData)},
            ...(authed || op.body
                ? {400: {description: 'Validation error', ...json(ErrorResponse)}}
                : {}),
            ...(authed ? {401: {description: 'Not authenticated', ...json(ErrorResponse)}} : {}),
            ...(op.permission ? {403: {description: 'Forbidden', ...json(ErrorResponse)}} : {}),
            ...Object.fromEntries(
                Object.entries(op.extraResponses ?? {}).map(([code, r]) => [
                    code,
                    {description: r.description, ...json(r.schema)},
                ]),
            ),
        },
    });
};

const {
    registerSchema,
    loginSchema,
    verifyCodeSchema,
    resendCodeSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
    updateMeSchema,
} = userValidation;
const {updateBusinessSchema, addMemberSchema, updateMemberSchema} = businessValidation;
const cv = catalogValidation;

// Health sits outside /api/v1; buildOpenApiDocument() overrides its server.
route({method: 'get', path: '/health', tag: 'System', summary: 'Health check', data: Health});

// Auth: public
const pub = (m: Method, path: string, summary: string, rest: Partial<Op> = {}) =>
    route({method: m, path, tag: 'Auth', summary, ...rest});
pub('post', '/auth/register', 'Register a business and its owner', {
    body: registerSchema,
    status: 201,
    data: z.object({user: z.object({id, username: z.string(), email: z.string()})}),
});
pub('post', '/auth/verify-code', 'Verify email with a 6-digit code', {body: verifyCodeSchema});
pub('post', '/auth/resend-code', 'Resend the verification code', {body: resendCodeSchema});
pub('post', '/auth/login', 'Log in; sets httpOnly cookies and returns tokens', {
    body: loginSchema,
    data: LoginData,
    extraResponses: {
        401: {description: 'Invalid credentials', schema: ErrorResponse},
        403: {
            description: 'Email not verified, account disabled or no access',
            schema: ErrorResponse,
        },
        409: {description: 'Several businesses: resend with kiranaId', schema: SelectBusiness},
    },
});
pub('post', '/auth/refresh', 'Rotate the refresh token (cookie or body)', {
    body: z.object({refreshToken: z.string().optional()}),
    data: Tokens,
});
pub('post', '/auth/logout', 'Revoke the current refresh token');
pub('post', '/auth/password/forgot', 'Email a password reset link', {body: forgotPasswordSchema});
pub('post', '/auth/password/reset', 'Reset a password with a token', {body: resetPasswordSchema});

// Auth: any signed-in user
const authed = (m: Method, path: string, summary: string, rest: Partial<Op> = {}) =>
    route({method: m, path, tag: 'Auth', summary, authenticated: true, ...rest});
authed('get', '/auth/me', 'Current user, business and permissions', {data: Me});
authed('patch', '/auth/me', 'Update own profile', {body: updateMeSchema, data: Profile});
authed('post', '/auth/password/change', 'Change password; other sessions are signed out', {
    body: changePasswordSchema,
});
authed('post', '/auth/logout-all', 'Revoke every session');
authed('get', '/auth/sessions', 'List active sessions', {data: z.array(Session)});
authed('delete', '/auth/sessions/{id}', 'Revoke one session', {params: idParams});

// Business
const biz = (m: Method, path: string, summary: string, permission: string, rest: Partial<Op>) =>
    route({method: m, path, tag: 'Business', summary, permission, ...rest});
biz('get', '/business', 'Get the current business', 'business.read', {data: Business});
biz('patch', '/business', 'Update the current business', 'business.update', {
    body: updateBusinessSchema,
    data: Business,
});
biz('get', '/business/members', 'List members', 'members.read', {data: z.array(Member)});
biz('post', '/business/members', 'Add a staff login', 'members.manage', {
    body: addMemberSchema,
    status: 201,
    data: Member,
});
biz('patch', '/business/members/{id}', 'Update a member', 'members.manage', {
    params: idParams,
    body: updateMemberSchema,
    data: Member,
});

// Catalog
const cat = (m: Method, path: string, summary: string, permission: string, rest: Partial<Op>) =>
    route({method: m, path, tag: 'Catalog', summary, permission, ...rest});
const conflict = {409: {description: 'Duplicate name, SKU or barcode', schema: ErrorResponse}};
for (const [path, label, schema] of [
    ['/catalog/categories', 'category', Category],
    ['/catalog/brands', 'brand', Brand],
] as const) {
    cat('get', path, `List ${label}s`, 'catalog.read', {data: z.array(schema)});
    cat('post', path, `Create a ${label}`, 'catalog.manage', {
        body: cv.namedSchema,
        status: 201,
        data: schema,
    });
    cat('patch', `${path}/{id}`, `Rename a ${label}`, 'catalog.manage', {
        params: idParams,
        body: cv.namedSchema,
        data: schema,
    });
    cat('delete', `${path}/{id}`, `Delete an unused ${label}`, 'catalog.manage', {
        params: idParams,
        data: schema,
        extraResponses: {409: {description: 'In use by products', schema: ErrorResponse}},
    });
}
cat('get', '/catalog/categories/{id}', 'Get a category', 'catalog.read', {
    params: idParams,
    data: Category,
});
cat('get', '/catalog/products', 'Search and list products', 'catalog.read', {
    query: cv.productQuerySchema,
    data: pageOf(Product),
});
cat('post', '/catalog/products', 'Create a product', 'catalog.manage', {
    body: cv.createProductSchema,
    status: 201,
    data: Product,
    extraResponses: conflict,
});
cat('get', '/catalog/products/{id}', 'Get a product', 'catalog.read', {
    params: idParams,
    data: Product,
});
cat(
    'patch',
    '/catalog/products/{id}',
    'Update or archive a product (base unit is fixed)',
    'catalog.manage',
    {
        params: idParams,
        body: cv.updateProductSchema,
        data: Product,
        extraResponses: conflict,
    },
);
cat(
    'get',
    '/catalog/products/{id}/prices',
    'Price, cost and tax history, newest first',
    'catalog.read',
    {
        params: idParams,
        data: z.array(PriceChange),
    },
);
cat('get', '/catalog/lookup', 'Find an active product by barcode, then SKU', 'catalog.read', {
    query: cv.lookupQuerySchema,
    data: Lookup,
});
cat(
    'post',
    '/catalog/import',
    'Import products from CSV rows (dry run or all-or-nothing commit)',
    'catalog.manage',
    {
        body: cv.importSchema,
        data: ImportReport,
        extraResponses: {
            201: {description: 'Imported', schema: envelope(ImportReport)},
            422: {description: 'Rows have errors; nothing was imported', schema: ErrorResponse},
        },
    },
);

// Stock ledger
const stock = (m: Method, path: string, summary: string, permission: string, rest: Partial<Op>) =>
    route({method: m, path, tag: 'Stock', summary, permission, ...rest});
stock('get', '/stock/movements', 'Stock movement history for the session store', 'catalog.read', {
    query: cv.movementQuerySchema,
    data: pageOf(Movement),
});
stock(
    'post',
    '/stock/movements',
    'Record opening stock, damage, expiry or an adjustment',
    'stock.manage',
    {
        body: cv.createMovementSchema,
        status: 201,
        data: Movement,
        extraResponses: {
            200: {description: 'Idempotency key replayed', schema: envelope(Movement)},
            409: {
                description: 'Insufficient stock or opening already recorded',
                schema: ErrorResponse,
            },
        },
    },
);

// Customers (minimal; Phase 5 builds the real customer work)
const cust = (m: Method, path: string, summary: string, rest: Partial<Op>) =>
    route({method: m, path, tag: 'Customers', summary, permission: 'customers.manage', ...rest});
cust('get', '/customers', 'Search customers by name or phone (up to 20)', {
    query: clientValidation.customerQuerySchema,
    data: z.array(Customer),
});
cust('post', '/customers', 'Create a customer', {
    body: clientValidation.createCustomerSchema,
    status: 201,
    data: Customer,
    extraResponses: {409: {description: 'Phone already in use', schema: ErrorResponse}},
});

// POS held bills: drafts, never sales. They post no stock, order, wallet or revenue.
const pos = (m: Method, path: string, summary: string, rest: Partial<Op>) =>
    route({method: m, path, tag: 'POS', summary, permission: 'pos.use', ...rest});
const notFound = {404: {description: 'Not found', schema: ErrorResponse}};
pos('get', '/pos/held', 'Held bills for the session store, newest first', {
    data: z.array(HeldBillSummary),
});
pos(
    'post',
    '/pos/held',
    'Hold a bill. The price is snapshotted by the server; a discount needs pos.discount and a different price needs pos.price.override',
    {
        body: posValidation.holdBillSchema,
        status: 201,
        data: HeldBill,
        extraResponses: {
            ...notFound,
            200: {description: 'Idempotency key replayed', schema: envelope(HeldBill)},
        },
    },
);
pos(
    'post',
    '/pos/held/{id}/recall',
    'Claim a held bill for this till (2 min). Repeat with the same claimKey to retry; another key gets 404 while the claim is live',
    {params: idParams, body: posValidation.claimSchema, data: HeldBill, extraResponses: notFound},
);
pos('delete', '/pos/held/{id}', 'Confirm a recall: delete the draft claimed with claimKey', {
    params: idParams,
    query: posValidation.claimSchema,
    status: 204,
    extraResponses: {409: {description: 'Another till holds the claim', schema: ErrorResponse}},
});

// Platform admin (role ADMIN, no tenant permission)
const adm = (m: Method, path: string, summary: string, rest: Partial<Op>) =>
    route({method: m, path, tag: 'Admin', summary, authenticated: true, ...rest});
adm('get', '/admin', 'Platform dashboard (requires the ADMIN platform role)', {
    data: z.record(z.unknown()),
});
adm('post', '/admin/businesses', 'Onboard a business with a pre-verified owner', {
    body: registerSchema,
    status: 201,
    data: NewBusiness,
});

export const buildOpenApiDocument = () => {
    const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
        openapi: '3.0.3',
        info: {title: 'KiranaOS API', version: '1.0.0'},
        servers: [{url: '/api/v1'}],
    });
    doc.paths['/health'].get!.servers = [{url: '/'}];
    return doc;
};
