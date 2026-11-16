# Project state

_Last updated 2026-11-16 · Phase 0 (discovery) complete · Next: Phase 1A (see bottom)_

## Repositories

| Path                       | Git                                                                                     | Contents                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `kirana/` (workspace root) | not a repo                                                                              | 4 repo folders, blueprint PDF, pointer `CLAUDE.md`           |
| `kirana/Kirana-B/`         | `main`; first commit = this import, pushed to `SMulla786/Kirana-B`                      | Backend API: the old `nk-B` code, moved here 2026-11-16      |
| `kirana/kirana-F/`         | `main`, no commits; origin `SMulla786/kirana-F`                                         | Empty: web admin                                             |
| `kirana/Kirana-app/`       | `main`, no commits; origin `SMulla786/Kirana-app`                                       | Empty: Android app (tech undecided, O-3)                     |
| `kirana/Kirana-desktop/`   | `main`, no commits; origin `SMulla786/Kirana-desktop`                                   | Empty: Windows POS with offline billing                      |

The old backend repo `SMulla786/kirana-backend` (2 commits, private) still exists on GitHub. The local `nk-B`
folder, including its git data, is gone. No web, desktop or Android code exists yet. CORS origins and email
links in the backend reference a frontend at `localhost:5173` (the Vite default) plus a devtunnels origin; no
such code was found (O-2).

## Baseline commit

The first commit on `Kirana-B`'s `main` is the imported old backend plus the Phase 0 docs, with secrets
scrubbed. It includes the old backend's last staged-but-uncommitted changes, which were never pushed to
`kirana-backend`:

- `prisma/schema.prisma`: adds `MaterialUnit.NOs`; `client.clientWallet` becomes 1:1 (`clientWallet.clientId`
  unique); `clientWalletHistory` gains `type` (DEBIT/CREDIT), `orderId` and `clientWalletId`.
- `src/services/kirana/order.service.ts`: create and update now run in `$transaction`; create upserts the
  client wallet and writes a DEBIT history row for the order total.
- `src/services/user.service.ts`, `src/controllers/user.controller.ts`: remove `createSeller`, which referenced
  the dropped `languageId` column.

All 7 local migrations came along in `prisma/migrations/` (still gitignored), as did `node_modules/` and the
real `.env` (both gitignored). Phase 0 added `CLAUDE.md` and `docs/*`. On 2026-11-16, before any commit,
Claude replaced `.env.example` with placeholders and removed the hard-coded AWS key fallbacks from
`src/utils/s3upload.ts`. Gitignored, so not in the commit: `.env`, `node_modules/`, `prisma/migrations/` and
`package-lock.json` (the last two by owner decision, P-006).

## Baseline checks (2026-11-16, Node 24.21.0, npm 11.19.0, Prisma 5.22.0, TS 5.9.3)

| Check                  | Command                                                                       | Result                                                                  | Pre-existing? |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| Prisma schema          | `npx prisma validate`                                                         | ✅ valid                                                                | —             |
| Generated client       | diff `node_modules/.prisma/client/schema.prisma` against `prisma/schema.prisma` | ✅ in sync with the staged schema                                       | —             |
| Migrations vs local DB | `npx prisma migrate status`                                                   | ✅ 7 migrations, local DB `kirana` up to date                           | —             |
| Typecheck / build      | `npx tsc --noEmit` (`npm run build` is `tsc`)                                 | ❌ 12 × TS2307 (missing template modules)                               | Yes           |
| App module load        | `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e "require('./src/app')"` with a dummy test env | ❌ `Cannot find module './admin/manager.controller'`, so the server can't start | Yes           |
| Lint                   | `npx eslint "src/**/*.ts"`                                                    | ❌ 2 `prettier/prettier` errors                                         | Yes           |
| Format                 | `npx prettier --check "src/**/*.ts"`                                          | ❌ `controllers/index.ts`, `validations/user.validation.ts`             | Yes           |
| Tests                  | —                                                                             | ⚪ none exist; no runner configured                                     | —             |
| CI                     | —                                                                             | ⚪ none (no `.github/`)                                                 | —             |

"Pre-existing" means every failure is in a file the staged diff doesn't touch; the staged diff adds no new
typecheck or lint errors. Not run: `npm run dev`/`start` (they connect to the DB and Gmail SMTP),
`npm run build` (writes `dist/`; the tsc result is already known), `npm audit` (network).

## Feature status against the MVP

✅ implemented · 🟡 partial · ❌ missing · ⚠️ exists but breaks a product rule · ❓ intent unknown

| Area                          | Status | Evidence                                                                                                                                                                                           |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business setup                | 🟡⚠️   | `kirana` model (address, City, amount, renewalAmount). `services/kirana/kiranaa.service.ts#createKirana` exists but has no route. Self-registration no longer creates a `kirana` row (staged), so a self-registered KIRANA user can't log in ("Seller not found"). No Store model. |
| Authentication                | 🟡⚠️   | `/api/v1/users/*`: register, verify-code, login, refresh, logout, change/reset password, me, update. JWT in a cookie or Bearer header. Serious defects: issues 2–7.                               |
| Roles / permissions           | 🟡     | `Role` enum ADMIN/KIRANA/EMPLOYEE; `checkRole` middleware; `employee` linked to a kirana. No Manager/Cashier/Inventory/Accountant roles; no action-level permissions.                              |
| Tenant isolation              | 🟡⚠️   | `verifyJWT` resolves `kiranaId` server-side (a good base). Service get/update/delete methods use `id` alone (material, category, client, order), so any route would allow cross-tenant access (IDOR). |
| Product catalogue             | 🟡     | `KiranaMaterial` (name, unit, barcode, category; unique per kirana). Service and controller exist, **no routes**. No price, MRP, cost, tax, SKU or archive.                                        |
| Units / conversion            | ❌⚠️   | Fixed enum `KG G PEICE L ML DOZON NOs`; the zod validator omits `NOs`; no conversion; `orderItem.quantity` is Int, so loose/weighted items can't be sold.                                          |
| Barcodes                      | 🟡     | `@@unique([kiranaId, barcode])`; exactly one barcode per product, required. No lookup endpoint.                                                                                                     |
| Stock ledger                  | ❌⚠️   | `KiranaMaterial.inventory` is a Float field; nothing updates it; no movements.                                                                                                                      |
| POS / checkout / receipts     | ❌     | `order.service` create/update (staged); `order.controller.ts` is empty; no routes. No payment modes, invoice numbers, tax, discounts, receipts or held bills.                                     |
| Sales returns                 | ❌     | —                                                                                                                                                                                                  |
| Customer udhaar ledger        | 🟡⚠️   | `clientWallet` + `clientWalletHistory` (staged). DEBITs the full total even when paid; ignores `paid`; balance `amount` never changes; order update/delete leave the ledger stale. Float money.     |
| Suppliers / purchasing        | ❌     | `purchaseOrder(Item)` tables only; no supplier model, no service.                                                                                                                                  |
| Cash / expenses / shifts      | ❌     | —                                                                                                                                                                                                  |
| Owner dashboard / reports     | ❌     | Only a platform-admin record-count dashboard (`services/admin/admin.service.ts`), not routed.                                                                                                       |
| Web / desktop / Android apps  | ❌     | Not in the workspace (O-2).                                                                                                                                                                        |
| Offline sync                  | ❌     | —                                                                                                                                                                                                  |
| Security / ops / backups      | 🟡⚠️   | helmet, compression, CORS allow-list, winston, zod. No CI, Docker, health check, backups or audit log.                                                                                            |
| Global master catalogue       | ❓     | `Material`/`MaterialCategory` + `services/admin/material.service.ts` (no controller or routes). Purpose unconfirmed (O-6).                                                                        |

## Known issues (ranked)

**Critical: fix before any deployment or pilot**

1. **Leaked credentials.** The git history of the old repo `kirana-backend` holds what look like a real AWS
   access key and secret and a Gmail SMTP app password (in `.env.example`, plus an AWS fallback in
   `src/utils/s3upload.ts`). Both were scrubbed in `Kirana-B` on 2026-11-16 before any commit, but the old
   repo still has them. The owner must revoke and rotate them (O-1) and archive or delete
   `kirana-backend` (O-17). Values are deliberately not repeated in these docs.
2. **Privilege escalation.** Public `POST /api/v1/users/register` accepts `role`
   (`registerUserSchema.role` in `validations/user.validation.ts`), so anyone can register as ADMIN.
3. **The register response leaks the whole user row** (`registerUser` returns `createdUser`), including the
   bcrypt hash and `verifyCode`, which defeats email verification. It is also `console.log`ged.
4. **Token design.** Access and refresh tokens share one secret, and the refresh token `{id}` passes
   `verifyJWT`, so a 30-day refresh token works as an access token. The local `.env` access TTL is
   300,000,000 minutes (about 570 years). Refresh tokens are stored in plaintext, and `/refresh` sits behind
   `verifyJWT`.
5. **Password reset** emails an ordinary access token (huge TTL, reusable, in the URL), and `/reset-password`
   accepts any valid token rather than a single-use reset token.
6. **No effective rate limiting.** `authLimiter` is mounted on `/v1/auth` (no such route) and only in
   production. The 6-digit verify code comes from `Math.random` and can be brute-forced.
7. **Account enumeration.** Login returns 404 "User does not exist" vs 401 for a wrong password.
8. **Cross-tenant IDOR** in the kirana services (see the table). `categoryId`/`materialId` values in request
   bodies aren't checked against the tenant.

**High: data integrity**

9. Money is stored as `Float` (`order`, `orderItem`, `purchaseOrderItem`, `clientWallet*`), while
   `kirana.amount` is `Decimal(65,30)`.
10. Sales are mutable (`updateOrder` deletes and recreates lines) and hard-deletable (`deleteOrder`, which
    also fails on FK RESTRICT when lines exist). The udhaar ledger diverges after an update.
11. Every sale requires a customer with a phone number (`createOrderSchema.client`), so walk-in sales are
    impossible.
12. Prices and totals from the client are trusted; `totalPrice` overrides the line sum.

**Build and hygiene**

13. Build and boot are broken by dead template exports in `controllers/index.ts`, `services/admin/index.ts`
    and `routes/admin/index.ts`.
14. `prisma/migrations` and `package-lock.json` are gitignored, so schema history and installs can't be
    reproduced from git. The owner chose to keep it that way for now (P-006).
15. Template leftovers: `package.json` `repository` points to a Catering-Backend repo;
    `PROJECT_NAME='template-backend'`; S3 bucket `promoteindiawamess`; unused S3 and Cloudinary helpers;
    `utils/calculations.ts` (linear regression with `console.log`); unused `Gender` enum;
    `UserProfile.studentId`; catering fields (`isVegetarian`, `isJain`, `caste`) in
    `client.validation.updateClientSchema`; empty `utils/helper.ts`, `client.controller.ts` and
    `order.controller.ts`.
16. `@types/express` v4 with Express 5; `prepare: husky` but no `.husky/` directory; the `updateRoleToAdmin`
    script points at a non-existent `src/cli/*.js`; the `prisma:reset` script uses `--force` (dangerous).
17. The error handler returns raw Prisma messages, which can echo submitted values.
18. Empty README; no tests, CI, Dockerfile or health endpoint.

## Next action: Phase 1A (backend foundation)

**Owner prerequisites (Claude can't do these):**

- Revoke and rotate the leaked AWS key and Gmail app password (O-1); archive or delete `kirana-backend` (O-17).
- Keep a backup of `Kirana-B/prisma/migrations/`. It isn't in git (P-006), so this PC holds the only copy.

**Then:** open a fresh Claude Code chat in this workspace, paste the blueprint's Phase 1 prompt, and add:
_"Implement Phase 1A only, as defined in docs/PHASE_PLAN.md."_ The first step is the behaviour-neutral
build/boot fix (issue 13), so every later step can be verified by typecheck, lint and tests.
