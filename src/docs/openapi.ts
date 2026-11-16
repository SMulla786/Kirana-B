import {z} from 'zod';
import {
    extendZodWithOpenApi,
    OpenAPIRegistry,
    OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import {MaterialUnit, MembershipRole, Role} from '@prisma/client';
import {
    userValidation,
    businessValidation,
    materialValidation,
    commonValidation,
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
const Product = z
    .object({
        id,
        name: z.string(),
        unit: z.nativeEnum(MaterialUnit),
        categoryId: id,
        kiranaId: id,
        barcode: z.string(),
        inventory: z.number().openapi({
            deprecated: true,
            description: 'Legacy Float field, replaced by the Phase 2 stock ledger. Do not use.',
        }),
        createdAt: date,
        updatedAt: date,
    })
    .openapi('Product');
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
const {materialSchema, materialCategorySchema, updateMaterialSchema} = materialValidation;

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
cat('get', '/catalog/categories', 'List categories', 'catalog.read', {data: z.array(Category)});
cat('post', '/catalog/categories', 'Create a category', 'catalog.manage', {
    body: materialCategorySchema,
    status: 201,
    data: Category,
});
cat('get', '/catalog/categories/{id}', 'Get a category', 'catalog.read', {
    params: idParams,
    data: Category,
});
cat('patch', '/catalog/categories/{id}', 'Update a category', 'catalog.manage', {
    params: idParams,
    body: materialCategorySchema,
    data: Category,
});
cat('delete', '/catalog/categories/{id}', 'Delete a category', 'catalog.manage', {
    params: idParams,
    data: Category,
});
cat('get', '/catalog/products', 'List products', 'catalog.read', {data: z.array(Product)});
cat('post', '/catalog/products', 'Create a product', 'catalog.manage', {
    body: materialSchema,
    status: 201,
    data: Product,
});
cat('get', '/catalog/products/{id}', 'Get a product', 'catalog.read', {
    params: idParams,
    data: Product,
});
cat('patch', '/catalog/products/{id}', 'Update a product', 'catalog.manage', {
    params: idParams,
    body: updateMaterialSchema,
    data: Product,
});
cat('delete', '/catalog/products/{id}', 'Delete a product', 'catalog.manage', {
    params: idParams,
    data: Product,
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
