# Repository map

## Workspace

```
kirana/                                   (not a git repo)
├─ CLAUDE.md                              pointer to Kirana-B memory files
├─ KiranaOS_Development_Blueprint.pdf     product blueprint + phase prompts
├─ Kirana-B/                              backend API (old nk-B code); origin SMulla786/Kirana-B
├─ kirana-F/                              web admin shell (React 19 + Vite); origin SMulla786/kirana-F
├─ Kirana-app/                            empty; origin SMulla786/Kirana-app (Android)
└─ Kirana-desktop/                        empty; origin SMulla786/Kirana-desktop (Windows POS)
```

See DECISIONS A-013, A-014 and O-17. The old `SMulla786/kirana-backend` repo still exists on GitHub.

## Kirana-B (backend API)

```
Kirana-B/
├─ CLAUDE.md, README.md, docs/      project memory + setup
├─ package.json, .npmrc             npm scripts, module-alias map; .npmrc allows Prisma install scripts
├─ tsconfig.json / tsconfig.test.json   build (src -> dist) / typecheck src + tests
├─ vitest.config.ts                 aliases, test env, global setup, no file parallelism
├─ eslint.config.mjs, .prettierrc   ESLint 9 flat config + prettier plugin
├─ .env.example                     placeholders only
├─ .github/workflows/ci.yml         Postgres 16 service; tsc, lint, tests
├─ prisma/schema.prisma             data model; migrations/ is gitignored (local only, P-006)
├─ tests/                           test-env.ts (_test guard), global-setup.ts (db push), helpers.ts,
│                                   smoke, auth, roles, permissions, tenancy tests
└─ src/
   ├─ index.ts, app.ts, client.ts   entry; Express app (requestId, /health, /api/v1, errors); Prisma singleton
   ├─ config/                       config.ts (zod env), permissions.ts (roles -> actions), logger, morgan, swagger
   ├─ routes/                       index.ts -> auth.routes, business.routes, catalog.routes, admin/index.ts
   ├─ controllers/                  auth, business, admin/admin, kirana/material (client/order: empty)
   ├─ services/                     token (JWT + sessions), auth, business, email; admin/admin;
   │                                kirana/{material,client,order} (tenant-scoped; client/order unrouted)
   ├─ validations/                  zod: user (auth), business, material, client, order, common, custom
   ├─ middlewares/                  auth (verifyJWT, requirePermission, tenantOf, checkAdmin), error,
   │                                requestId, rateLimiter (authLimiter), xss (unused)
   ├─ utils/                        ApiError, ApiResponse, PrismaError, catchAsync, encryption, pick, exclude
   ├─ cli/                          registerAdmin.ts, updateRoleToAdmin.ts
   └─ types/express.d.ts            req.user shape
```

## HTTP routes (base `/api/v1` unless noted)

| Method               | Path                                                                        | Guard                            |
| -------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| GET                  | `/health` (no prefix)                                                       | none                             |
| POST                 | `/auth/register`, `/auth/resend-code`, `/auth/password/forgot`              | email limiter                    |
| POST                 | `/auth/verify-code`, `/auth/login`, `/auth/refresh`, `/auth/password/reset` | auth limiter (counts failures)   |
| POST                 | `/auth/logout`                                                              | refresh token (cookie or body)   |
| GET / PATCH          | `/auth/me`                                                                  | verifyJWT                        |
| POST                 | `/auth/password/change`, `/auth/logout-all`                                 | verifyJWT                        |
| GET / DELETE         | `/auth/sessions`, `/auth/sessions/:id`                                      | verifyJWT (own sessions only)    |
| GET / PATCH          | `/business`                                                                 | business.read / business.update  |
| GET / POST           | `/business/members`                                                         | members.read / members.manage    |
| PATCH                | `/business/members/:id`                                                     | members.manage + canAssignRole   |
| GET / POST           | `/catalog/categories`, `/catalog/products`                                  | catalog.read / catalog.manage    |
| GET / PATCH / DELETE | `/catalog/categories/:id`, `/catalog/products/:id`                          | catalog.read / catalog.manage    |
| GET                  | `/admin`                                                                    | platform ADMIN                   |
| POST                 | `/admin/businesses`                                                         | platform ADMIN                   |

Unrouted code: the client and order services (tenant-scoped; to be retired per P-011) and the admin
master-material service (O-6).

## Data model (`prisma/schema.prisma`, including staged changes)

| Model                    | Product meaning                 | Tenant key                | Notes                                                                  |
| ------------------------ | ------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `User`                   | login                           | —                         | `role` (only ADMIN matters; KIRANA/EMPLOYEE are legacy labels); unique username + email; reset-token hash; `refreshToken` column unused |
| `Session`                | device login                    | `kiranaId`/`storeId`      | refresh-token SHA-256, expiry, revokedAt                                |
| `Membership`             | a user's role in a business     | `kiranaId`                | `MembershipRole` OWNER..STAFF; unique (userId, kiranaId)                |
| `Store`                  | shop                            | `kiranaId`                | one `isDefault` store per business (MVP)                                |
| `kirana`                 | business / tenant               | (root)                    | `name`, `address`, `City`, `gstin?`; 1:1 creator user; `amount`/`renewalAmount` default 0 (O-5) |
| `employee`               | legacy staff                    | `kiranaId`                | unused since Membership (A-017)                                         |
| `MaterialCategory`       | global category                 | none                      | admin master (O-6)                                                     |
| `Material`               | global product                  | none                      | `inventory` Int; global-unique name and barcode                        |
| `KiranaMaterialCategory` | shop category                   | `kiranaId`                | unique (kiranaId, name)                                                |
| `KiranaMaterial`         | shop product                    | `kiranaId`                | `unit` enum; `inventory` Float; unique (kiranaId, barcode/name)        |
| `client`                 | customer                        | `kiranaId`                | unique (kiranaId, phoneNumber)                                         |
| `order` / `orderItem`    | sale / line                     | `kiranaId` / via order    | Float money; Int quantity; unique (orderId, materialId)                |
| `clientWallet`           | udhaar balance                  | via client                | 1:1 client (staged); `amount` Float, never updated                     |
| `clientWalletHistory`    | udhaar entry                    | via client                | `type` DEBIT/CREDIT, optional `orderId` (staged)                       |
| `purchaseOrder(Item)`    | purchase / line                 | `kiranaId` / via PO       | no supplier; no service                                                |

Enums: `Role`, `MembershipRole`, `Gender` (unused), `MaterialUnit` (`KG G PEICE L ML DOZON NOs`), `HistoryType`.
IDs are `String @default(uuid())`. FKs are RESTRICT, except `clientWalletHistory.orderId` (SET NULL).

## npm scripts (package.json)

`dev`, `build`, `start`, `test`, `test:watch`, `lint`, `lint:fix`, `prettier`, `prettier:fix`, `format`,
`prepare` (husky; there is no `.husky/`, so install with `HUSKY=0`), `prisma:*` (⚠ `prisma:reset` is destructive),
`registerAdmin` (needs a build), `updateRoleToAdmin` (⚠ wrong path).

## Environment variables (names only)

In the zod schema: `NODE_ENV`, `PORT`, `JWT_SECRET`, `JWT_ACCESS_EXPIRATION_MINUTES` (<= 60),
`JWT_REFRESH_EXPIRATION_DAYS`, `JWT_RESET_PASSWORD_EXPIRATION_MINUTES` (reset-link TTL),
`JWT_VERIFY_EMAIL_EXPIRATION_MINUTES` (unused), `SMTP_*`, `EMAIL_FROM`, `APP_URL`, `AUTH_RATE_LIMIT_MAX`,
`CORS_ORIGINS`. Read directly: `DATABASE_URL`, `BCRYPT_SALT_ROUNDS`. Tests: `TEST_DATABASE_URL` (CI).

## kirana-F (web admin shell)

React 19 + TS + Vite + react-router, Vitest + Testing Library.
- `src/styles`: design tokens.
- `src/ui`: components.
- `src/layout`: AppShell and AuthLayout.
- `src/api`: fetch client and hand-written types (P-008).
- `src/auth`: provider, guards, `useCan`.
- `src/nav`: permission-filtered nav.
- `src/pages`.

The dev proxy sends `/api` to `API_PROXY_TARGET` (default `:4800`).

## Tooling not present

No Dockerfile, seed script, OpenAPI generation or shared packages.
