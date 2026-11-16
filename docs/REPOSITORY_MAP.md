# Repository map

## Workspace

```
kirana/                                   (not a git repo)
├─ CLAUDE.md                              pointer to Kirana-B memory files
├─ KiranaOS_Development_Blueprint.pdf     product blueprint + phase prompts
├─ Kirana-B/                              backend API (old nk-B code); origin SMulla786/Kirana-B
├─ kirana-F/                              empty; origin SMulla786/kirana-F (web admin)
├─ Kirana-app/                            empty; origin SMulla786/Kirana-app (Android)
└─ Kirana-desktop/                        empty; origin SMulla786/Kirana-desktop (Windows POS)
```

See DECISIONS A-013, A-014 and O-17. The old `SMulla786/kirana-backend` repo still exists on GitHub.

## Kirana-B (backend API)

```
Kirana-B/
├─ CLAUDE.md, docs/                 project memory (this folder)
├─ package.json                     npm scripts, module-alias map, lint-staged
├─ tsconfig.json                    strict, CommonJS, ES6, paths aliases, rootDir src, outDir dist
├─ eslint.config.mjs, .prettierrc   ESLint 9 flat config + prettier plugin
├─ .env.example                     placeholders only (real values scrubbed 2026-11-16)
├─ prisma/
│  ├─ schema.prisma                 data model (PostgreSQL)
│  └─ migrations/                   7 migrations, ⚠ gitignored (local only)
├─ public/temp/                     multer upload temp dir (served statically via /public)
└─ src/
   ├─ index.ts                      entry: prisma.$connect → app.listen; process error handlers
   ├─ app.ts                        Express app, middleware chain, /api/v1, /api-docs, error handlers
   ├─ client.ts                     PrismaClient singleton
   ├─ config/                       config.ts (zod env), logger.ts (winston), morgan.ts, swagger.ts
   ├─ routes/                       index.ts (mounts /users only), user.routes.ts, admin/index.ts (⚠ broken imports, unmounted)
   ├─ controllers/                  user.controller.ts; admin/admin.controller.ts; kirana/material.controller.ts;
   │                                kirana/client.controller.ts + order.controller.ts (empty); index.ts (⚠ 6 dead exports)
   ├─ services/                     user, token, email; admin/{admin,material}.service.ts (index ⚠ 3 dead exports);
   │                                kirana/{kiranaa,material,client,order}.service.ts
   ├─ validations/                  zod: user, kirana, material, client, order, common, custom (password, phone regex)
   ├─ middlewares/                  auth (verifyJWT, checkRole), validate, error, rateLimiter, multer, xss (disabled)
   ├─ utils/                        ApiError, ApiResponse, PrismaError, catchAsync, encryption (bcrypt), pick/exclude,
   │                                s3upload, cloudinary, calculations (all unused)
   ├─ cli/                          registerAdmin.ts (interactive admin creation), updateRoleToAdmin.ts
   └─ types/                        express.d.ts (req.user shape), response.d.ts
```

## HTTP routes

| Method | Path                                    | Auth      | Handler                                   |
| ------ | --------------------------------------- | --------- | ----------------------------------------- |
| GET    | `/`                                     | —         | welcome                                   |
| GET    | `/api-docs`                             | —         | Swagger UI (no annotated routes)          |
| POST   | `/api/v1/users/register`                | —         | `userController.registerUser` ⚠ accepts `role` |
| POST   | `/api/v1/users/verify-code`             | —         | `verifyVerificationCode`                  |
| POST   | `/api/v1/users/login`                   | —         | `loginUser`                               |
| POST   | `/api/v1/users/reset-password-request`  | —         | `requestPasswordReset`                    |
| POST   | `/api/v1/users/refresh`                 | verifyJWT | `refreshAccessToken`                      |
| POST   | `/api/v1/users/logout`                  | verifyJWT | `logoutUser`                              |
| POST   | `/api/v1/users/reset-password`          | verifyJWT | `resetPassword`                           |
| POST   | `/api/v1/users/change-password`         | verifyJWT | `changeCurrentPassword`                   |
| GET    | `/api/v1/users/me`                      | verifyJWT | `getCurrentUser`                          |
| PATCH  | `/api/v1/users/update`                  | verifyJWT | `updateUser`                              |

Unrouted code: the kirana material/category controller and service, the client, order and kirana
services, the admin dashboard, and the admin master-material service.

## Data model (`prisma/schema.prisma`, including staged changes)

| Model                    | Product meaning                 | Tenant key                | Notes                                                                  |
| ------------------------ | ------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `User`                   | login                           | —                         | `role` ADMIN/KIRANA/EMPLOYEE; plaintext `refreshToken`; `verifyCode`    |
| `kirana`                 | business / tenant               | (root)                    | 1:1 user; `City`, `amount`/`renewalAmount` Decimal(65,30) (meaning: O-5) |
| `employee`               | staff                           | `kiranaId`                | 1:1 user                                                               |
| `MaterialCategory`       | global category                 | none                      | admin master (O-6)                                                     |
| `Material`               | global product                  | none                      | `inventory` Int; global-unique name and barcode                        |
| `KiranaMaterialCategory` | shop category                   | `kiranaId`                | unique (kiranaId, name)                                                |
| `KiranaMaterial`         | shop product                    | `kiranaId`                | `unit` enum; `inventory` Float; unique (kiranaId, barcode/name)        |
| `client`                 | customer                        | `kiranaId`                | unique (kiranaId, phoneNumber)                                         |
| `order` / `orderItem`    | sale / line                     | `kiranaId` / via order    | Float money; Int quantity; unique (orderId, materialId)                |
| `clientWallet`           | udhaar balance                  | via client                | 1:1 client (staged); `amount` Float, never updated                     |
| `clientWalletHistory`    | udhaar entry                    | via client                | `type` DEBIT/CREDIT, optional `orderId` (staged)                       |
| `purchaseOrder(Item)`    | purchase / line                 | `kiranaId` / via PO       | no supplier; no service                                                |

Enums: `Role`, `Gender` (unused), `MaterialUnit` (`KG G PEICE L ML DOZON NOs`), `HistoryType`.
IDs are `String @default(uuid())`. FKs are RESTRICT, except `clientWalletHistory.orderId` (SET NULL).

## npm scripts (package.json)

`dev`, `build`, `start`, `lint`, `lint:fix`, `prettier`, `prettier:fix`, `format`, `prepare` (husky; no
`.husky/` exists), `prisma:generate`, `prisma:migrate:dev`, `prisma:migrate:deploy`, `prisma:studio`,
`prisma:db:seed` (no seed configured), `prisma:reset` (⚠ destructive, `--force`), `registerAdmin` (needs a
build), `updateRoleToAdmin` (⚠ wrong path). There is no `test` script.

## Environment variables (names only)

In the zod schema: `NODE_ENV`, `PORT`, `JWT_SECRET`, `JWT_ACCESS_EXPIRATION_MINUTES`,
`JWT_REFRESH_EXPIRATION_DAYS`, `JWT_RESET_PASSWORD_EXPIRATION_MINUTES` (unused),
`JWT_VERIFY_EMAIL_EXPIRATION_MINUTES` (unused), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`,
`EMAIL_FROM`, `CORS_ORIGINS`.
Read directly: `DATABASE_URL` (Prisma), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_KEY`, `AWS_REGION`,
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_SECRET_KEY`, `BCRYPT_SALT_ROUNDS`.

## Tooling not present

No tests, no CI (`.github/`), no Dockerfile or compose file, no seed script, no README content, no API client
SDK, no shared packages.
