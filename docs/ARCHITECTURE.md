# Architecture

## 1. Current architecture (as built, Phase 1A, 2026-11-16)

```
Client apps: kirana-F web admin shell (Vite, :5173; Phase 1A/1B). Desktop and Android: not yet.
   │  JSON over HTTP. Web: httpOnly SameSite=Strict cookies. Desktop/Android: Authorization: Bearer.
   ▼
Express 5 (src/app.ts)
   requestId → helmet → json/urlencoded (1 MB) → static /public → cookieParser → compression → CORS
   allow-list → morgan ([request-id] in each line)
   GET /health (DB ping) · /api/v1 → routes/index.ts → /auth /business /catalog /stock /customers /pos /admin · /api-docs
   notFoundHandler → errorConverter (Zod / Prisma / body-parser / ApiError) → errorHandler (ApiResponse JSON;
   5xx bodies are generic, and the cause is logged with the request id)
   ▼
routes (verifyJWT → requirePermission('<action>')) → controllers (zod .strict() parse, tenantOf(req))
   → services (Prisma, ApiError) → PrismaClient singleton (src/client.ts)
   ▼
PostgreSQL (dev DB `kirana` via local migrations; test DB `kirana_test` via `prisma db push`)

Side integrations: SMTP via nodemailer (verification code, reset link). In tests it uses jsonTransport.
```

- **Runtime:** Node 24, TypeScript 5.9 `strict`, CommonJS. Dev uses `ts-node-dev` + `tsconfig-paths`; prod uses
  `tsc` → `dist/` + `module-alias`.
- **Config:** zod-validated env in `src/config/config.ts`. The access TTL is capped at 60 min, and
  production requires a JWT secret of ≥32 characters. `APP_URL` builds email links (no caller-supplied
  redirect); `AUTH_RATE_LIMIT_MAX` sets the auth limit.
- **Identity:**
  - `User` is a login. `User.role` is only meaningful for the platform `ADMIN`; KIRANA and EMPLOYEE
    are legacy labels.
  - Business access is `Membership(userId, kiranaId, role)`, with roles OWNER, MANAGER, CASHIER,
    INVENTORY_MANAGER, ACCOUNTANT and STAFF.
  - The legacy `employee` table is unused.
- **Sessions:**
  - Login creates a `Session` row per device (user, kiranaId, storeId, device name, user agent, IP,
    expiry, revokedAt).
  - The access token is a 15-minute HS256 JWT `{sub, sid, typ:'access'}`.
  - The refresh token is opaque, `<sessionId>.<secret>`, with only `sha256(secret)` stored. It rotates
    via compare-and-swap, and reusing a rotated token revokes the session.
  - `verifyJWT` loads the session on every request, so revocation, deactivation and role changes take
    effect immediately.
  - Logout revokes the session from its refresh token. Logout-all, per-session revoke, password change
    (which keeps the current session) and password reset (which revokes all sessions) are supported.
- **Business setup:** `businessService.createBusinessWithOwner` creates the user, the business
  (`kirana`), the default `Store` and the OWNER `Membership` in one transaction. It is used by
  self-signup (`/auth/register`, email verified by a 6-digit CSPRNG code) and by platform admins
  (`/admin/businesses`, pre-verified).
- **Tenancy:**
  - `req.user.kiranaId`/`storeId` come only from the session row. Controllers read them via
    `tenantOf(req)`.
  - Services filter every read and write by `{id, kiranaId}`, and referenced ids (`categoryId`,
    `materialId`) are checked against the tenant.
  - Body schemas are `.strict()`.
  - Covered by cross-tenant tests (`tests/tenancy.test.ts`).
- **Authorization:** `requirePermission(action)` checks the code-defined `ROLE_PERMISSIONS` map. Member
  management follows `canAssignRole`: only OWNER grants MANAGER, nobody grants OWNER, and nobody edits
  their own membership.
- **Mounted business routes:** only the catalogue (categories, products), kept as the isolation-test
  vehicle. The order/client services are tenant-scoped but stay unrouted until Phases 4–5 (P-011).
- **Deployment:** none yet. CI is `.github/workflows/ci.yml`.

## 2. Gap analysis

| Concern            | Current                                         | Required                                                                     |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Tenant isolation   | `kiranaId` known; by-id queries unscoped        | Every query/mutation scoped; cross-tenant tests per route                    |
| `store_id`         | No Store                                        | `Store` (one default per business); `storeId` on store-owned rows            |
| Roles              | ADMIN / KIRANA / EMPLOYEE                       | Owner, Manager, Cashier, Inventory Mgr, Accountant, Staff + action permissions |
| Sessions / devices | One plaintext refresh token per user            | Per-device sessions, hashed rotating refresh tokens, revoke/logout-all       |
| Stock              | Mutable `inventory` Float, never updated        | Append-only `StockMovement` + transactional balance read model               |
| Financial records  | Float, mutable, hard-deletable                  | Decimal, immutable entries, returns/reversals, snapshots                     |
| Audit              | None                                            | Actor, timestamp, reason on business writes; audit trail for sensitive actions |
| Idempotency        | None                                            | Idempotency key on sale/payment/sync writes                                  |
| Offline            | None                                            | Desktop SQLite + outbox + sync API (Phase 9)                                 |
| Observability      | Console logs                                    | Request IDs, health check, safe error bodies, backup/restore tested          |
| Quality gates      | No tests or CI; build broken                    | Test runner, isolation tests, CI on every push                               |

## 3. Target direction: the smallest safe path

Principle: keep the existing stack and layering, evolve it with additive migrations, and don't rewrite.

- **Keep:** Node + Express 5 + TypeScript + Prisma + PostgreSQL + zod, plus `ApiError`/`ApiResponse`/
  `catchAsync`, the route → controller → service layering, and the `/api/v1` prefix.
- **Tenant model (P-001):** `kirana` stays as the Business (tenant root); renaming tables would be churn. Add
  `Store` and create one default store atomically with the business. Store-owned rows (stock movements,
  sales, registers/shifts, receipts) get `storeId`. Business-level rows (products, customers, suppliers,
  staff) keep `kiranaId`. Decide each table when it's built.
- **Tenant enforcement:** services take `kiranaId` from `req.user` and filter by it, including writes
  (`updateMany`/`deleteMany` on `{id, kiranaId}` with a count check, or a `findFirst` guard). Referenced IDs
  in bodies (category, product, customer) must belong to the same tenant. Postgres RLS is optional later,
  not needed for the MVP.
- **Identity and roles (P-004):** `User` is a login. Add `Membership(userId, kiranaId, role)` with roles
  OWNER, MANAGER, CASHIER, INVENTORY_MANAGER, ACCOUNTANT, STAFF. Platform `ADMIN` stays on `User.role`.
  A code-defined `role → permissions` map drives `requirePermission('<action>')` middleware. Migrate
  existing KIRANA users to OWNER and EMPLOYEE to STAFF.
- **Auth hardening (P-005):** separate access/refresh secrets (or a checked `typ` claim); access TTL of
  15–30 minutes; a `Session` table (user, device, hashed refresh token, expiry, revokedAt) with rotation;
  single-use hashed reset tokens; `crypto.randomInt` codes; auth rate limits; `role` never accepted from
  public input; a cashier PIN-login primitive for registered POS devices. Use library primitives (bcrypt,
  jsonwebtoken, node:crypto); no custom crypto.
- **Money and quantity (P-002):** Prisma `Decimal`: money `Decimal(14,2)`, quantity `Decimal(14,3)`, rates
  `Decimal(7,4)`. Do the arithmetic with `Prisma.Decimal`, never JS `number`.
- **Ledgers (Phases 2, 4, 5, 6):** `StockMovement` is append-only (type, signed quantity in the base unit,
  unit cost, source type/id, actor, reason, storeId, timestamp), with the balance updated in the same DB
  transaction. Sales, payments and customer/supplier ledger entries are append-only, and corrections are new
  linked rows. The cost basis is decided in Phase 2 (O-15).
- **API conventions:** keep the `ApiResponse` envelope; add a request-ID middleware, `GET /health`, error
  bodies that don't leak internals, and an `Idempotency-Key` header on sale/payment writes. OpenAPI can be
  generated from zod later.
- **Repo layout (A-013, A-014):** separate repos: `Kirana-B` (this backend; the old `kirana-backend` code moved here 2026-11-16),
  `kirana-F` (web admin), `Kirana-app` (Android) and `Kirana-desktop` (Windows POS). The backend repo holds the
  project memory; client repos carry a pointer `CLAUDE.md`.
- **Clients (P-009; O-3, O-4):** React + TypeScript (Vite) web admin in `kirana-F`. The Windows desktop POS is
  Electron + React + TypeScript in `Kirana-desktop`, with local SQLite (`better-sqlite3`), an outbox from Phase 9,
  and native printer/scanner access. Android tech is decided before Phase 8.
- **Cross-repo contract (P-008):** Kirana-B serves an OpenAPI spec generated from its zod schemas, and client
  repos generate typed API clients from it. Business rules live in the API. The one exception is the
  desktop's offline sale calculation (Phase 9), which must match the server's, checked by shared test cases.

## 4. Offline sync guardrails (built in Phase 9; they shape choices from Phase 1)

- Transactional IDs stay client-generatable UUIDs (already `@default(uuid())` strings).
- The desktop commits a sale locally (SQLite, WAL) and writes an outbox event with an idempotency key. The
  sync API applies it in one server transaction and returns an ack, which is stored locally. Retries never
  duplicate anything.
- The server is authoritative. Stock reconciles through movements; a balance is never overwritten.
- Offline invoice numbering uses a per-device/register series (O-11).
- A printer failure never rolls back a sale; a sync failure never deletes a local sale. The UI shows "saved
  locally" separately from "confirmed by server".

## 5. Integration boundaries

- The API is the only writer to PostgreSQL.
- Web and Android are online REST clients of `/api/v1`.
- The desktop is a REST client while online; offline writes reach the server only through the sync API.
- External services: SMTP now. Later: a payment gateway for trusted UPI confirmation (webhooks, O-10), and
  WhatsApp/OCR post-MVP. All gated by explicit credentials, consent and audit.
