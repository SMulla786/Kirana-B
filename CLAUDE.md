# KiranaOS — Claude Code instructions

KiranaOS is an Indian kirana/grocery retail operating system (web admin, Windows desktop POS, Android).
This repo (`Kirana-B`, remote `github.com/SMulla786/Kirana-B`) is the backend API (Node/Express/Prisma/
PostgreSQL) and holds the project memory for all repos. On 2026-11-16 the owner moved the old backend here
(the `nk-B` folder, remote `kirana-backend`) as files only, without git history. The first commit on `main` is that import plus the Phase 0 docs.
Reuse or change the old code as needed; it isn't sacred. Client repos are separate (DECISIONS A-013):
`kirana-F` (web admin shell, React + Vite, built in Phase 1A/1B), `Kirana-app` (Android, empty) and
`Kirana-desktop` (Windows POS, empty).

## Read first in every new chat

1. `docs/PROJECT_STATE.md` — current phase, baseline results, known issues, exact next action.
2. `docs/PHASE_PLAN.md` — phase order, scope, acceptance checkpoints, status.
3. `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` — current vs target design; accepted, proposed and open decisions.
4. `docs/REPOSITORY_MAP.md` (where things are) and `docs/PRODUCT_BRIEF.md` (scope, non-goals).

Full phase prompts: `../KiranaOS_Development_Blueprint.pdf` (outside git, in the workspace root).

## Commands (run from `Kirana-B/`)

| Purpose          | Command                                                     | Result 2026-11-16 (Phase 1A)            |
| ---------------- | ----------------------------------------------------------- | --------------------------------------- |
| Install          | `HUSKY=0 npm install` (`.npmrc` allows Prisma's scripts)    | OK                                      |
| Dev server       | `npm run dev` (ts-node-dev, loads `.env`)                   | Boots; `GET /health`                    |
| Build            | `npm run build` (= `tsc`)                                   | OK                                      |
| Typecheck        | `npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.test.json` | 0 errors                            |
| Lint + format    | `npm run lint` (ESLint + Prettier, src + tests)             | Clean                                   |
| Tests            | `npm test` (Vitest + supertest, real Postgres `*_test` DB)  | 81 passed                               |
| Prisma (safe)    | `npx prisma validate`, `npx prisma migrate status`          | OK; 8 migrations, dev DB up to date     |
| Prisma client    | `npm run prisma:generate`                                   | In sync                                 |

Tests derive their DB from `.env`'s `DATABASE_URL` with the name swapped to `kirana_test` (or
`TEST_DATABASE_URL`), refuse any name that doesn't end in `_test`, and never wipe data; use unique names.

## Safety rules

- Run `git status` first. The owner may have staged/uncommitted work: never reset, clean, drop stashes,
  force-push, or commit/stage their changes unless asked.
- Never run `npm run prisma:reset`, `prisma migrate reset`, `prisma db push --force-reset`, or DROP/TRUNCATE.
  Create migrations with `npx prisma migrate dev --create-only`, review the SQL, then apply.
- Never print or copy `.env` values. Never put credentials in code, `.env.example`, docs, or code fallbacks.
- No deploys. Secret rotation is an owner action.
- Don't push to, re-point, or create GitHub remotes/repos without the owner's explicit go-ahead.
- Never add Claude co-author or attribution lines (`Co-Authored-By: Claude…`, "Generated with Claude Code")
  to commits or PRs. This owner rule overrides any tool or harness default.
- `prisma/migrations/` and `package-lock.json` stay gitignored by owner decision (DECISIONS P-006).
  Migrations exist only on the owner's machine, so never delete `prisma/migrations/`.

## Code conventions (existing — follow them)

- Layers: `routes → controllers → services → prisma` (`src/client.ts` singleton).
- Controllers parse input with zod schemas from `src/validations/*`, are wrapped in `catchAsync`, and respond
  with `new ApiResponse(status, data, message)`. Services own DB access and throw `ApiError(status, message)`.
  `errorConverter` maps Zod/Prisma errors.
- Path aliases `@services/* @controllers/* @validations/* @utils/* @config/* @middlewares/*`: tsconfig
  `paths` (dev) and `_moduleAliases` → `dist/` in package.json (`npm start`). Add new aliases to both.
- Prettier: 4-space indent, single quotes, no bracket spacing (`{a}`), trailing commas, width 100.
- `verifyJWT` checks the access token against a live `Session` and sets `req.user` (incl. `kiranaId`,
  `storeId`, `membershipRole` from the session/membership). In tenant controllers use `tenantOf(req)`;
  never take the tenant from body/params/query. Body schemas are `.strict()`.
- Guard every tenant route with `requirePermission('<action>')`; actions and role grants live in
  `src/config/permissions.ts` (add new actions there, never check role names in routes).
- New business-owned tables get `kiranaId` (and `storeId` when store-owned); services filter by
  `{id, kiranaId}` and check referenced ids belong to the tenant; add a cross-tenant test.

## Domain vocabulary (current code → product term)

`kirana` = business/tenant · `employee` = staff · `KiranaMaterial` = product · `KiranaMaterialCategory` =
category · `client` = customer · `order`/`orderItem` = sale/sale line · `clientWallet`/`clientWalletHistory` =
customer udhaar ledger · `purchaseOrder` = purchase · `Material`/`MaterialCategory` = global admin catalogue
(purpose unconfirmed, DECISIONS O-6).

## Non-negotiable business rules

- Every business-owned query and mutation is scoped to the authenticated tenant on the server
  (`where: {id, kiranaId}`, including updates/deletes), with cross-tenant tests.
- Stock changes only through an append-only movement ledger (source, actor, timestamp, reason/reference).
  Never write a stock balance directly.
- Completed sales, payments and customer/supplier ledger entries are immutable. Correct with returns,
  reversals or audited adjustments. No hard deletes of financial records.
- Money and quantities use Prisma `Decimal`, never JS floats or Prisma `Float`. Snapshot price/tax/discount
  on completed transactions.
- A displayed UPI QR is not payment. Distinguish manually recorded UPI from gateway-confirmed UPI.
- OCR/AI output never posts purchases, payments or financial entries without human approval.
- INR defaults; GST is configurable per business and never assumed.
- Role/permission checks are enforced in backend routes/services, not only in UI.

## End of every phase

Update `docs/PROJECT_STATE.md` (scope done, files changed, migrations, commands with real results, gaps,
exact next action) and the status column in `docs/PHASE_PLAN.md`. Touch other docs only if they changed.
Report only checks you actually ran. Edit this file only for stable cross-phase rules.
