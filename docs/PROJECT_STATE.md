# Project state

_Last updated 2026-11-16 · **Phase 3 (web POS) built on branches `phase3/pos`** in Kirana-B and kirana-F.
They are not merged or pushed, and wait for the live pass and the owner's OK. Phase 2 is merged and pushed. The
desktop shell (Tauri, A-026) is in progress. Next: see the bottom_

## Phase 3: what was built (2026-11-16)

Web first (A-023): the POS is an online kirana-F screen at `/pos`. Its React components are meant for reuse
in the Tauri shell later. The model is in DECISIONS A-028.

**Branches:** both local and unpushed.
- **Kirana-B** `phase3/pos`, on `f0b6c90`:
  - `535fc68`: favourites (`isFavourite`, `?favourite=true`), brand name in `q`, and the `pos.discount` /
    `pos.price.override` permissions.
  - `22d79eb`: customers search/create, and held bills with their tests.
  - `0b99256`: each held-bill line carries `product` and `priceOverridden`, plus OpenAPI for both.
  - `8aba695`: fixed metric units without a stored row (kg on a gram base), and openapi.json regenerated.
- **kirana-F** `phase3/pos`, on `aa7e8e4` (Phase 2 main):
  - `163c6a3`: money, cart reducer, scanner hook and shortcuts.
  - `58c245d`: the screen and dialogs.
  - `560ec32`: unit price per sales unit; recalled lines rebuilt from the product.
  - `0ce655d`: recall shows today's catalogue price.
  - `c55ad94`: a test fix.
  - `53a8513`: types generated from the phase3 openapi.json.

**Backend:**
- **Endpoints:** `GET/POST /pos/held` and `POST /pos/held/:id/recall` (`pos.use`), plus `GET/POST /customers`
  (`customers.manage`).
- **Held bills:** a held bill is a draft. It never touches stock, orders, wallets or revenue (tested by
  snapshotting all four).
- **Pricing:** the server snapshots the price per line from the sales-unit price. A different client price
  gets 403 without `pos.price.override`; a discount gets 403 without `pos.discount`.
- **Validation:** units, quantities and the discount cap are checked per line.
- **Recall:** it deletes the draft in its transaction, so a second recall gets 404.

**Web (`src/pages/pos/`):**
- **Layout:** the header shows store, cashier and online/offline. The left rail has Favourites and the
  categories. In the centre is `ProductSearch`, from Phase 2: it matches name, alias, SKU, barcode and brand,
  and Enter on an exact code does a lookup. Below it is a tile grid showing price and stock with a low/out
  label. The cart panel stays on screen.
- **Cart:**
  - Money is integer paise and quantity integer milli-units, with no float maths.
  - A repeat scan of the same product and unit adds 1; a different unit makes a new line.
  - Loose products open a weight dialog (up to 3 dp, kg/g).
  - Pack units act as variants, through a unit picker.
  - The discount and price-override inputs only show with the matching permission.
- **Scanner:** keyboard-wedge burst detection. The suffix, gap and minimum length are configurable. A burst
  into a qty/price/discount field (`data-pos-guard`) restores that field and still adds the item.
- **Shortcuts:** F1 help, F2 search, F3 qty, F4 customer, F6 discount, F8 hold, F9 recall, Delete,
  arrows, +/- and Esc. They can be remapped and are saved per device. While typing, only F-keys and Escape
  fire.
- **Dialogs:** hold with a note; recall (offering to hold the current cart first); customer search and quick
  add; shortcut help.
- **Layout widths:** at ≥1280 px the three panes are 200 px | 1fr | 380 px. At 1024–1279 px the rail becomes
  chips and the cart is 340 px. Below 1024 px the panes stack.
- **i18n:** a `pos` namespace in en/hi/mr. The hi/mr strings are machine-drafted and flagged for review.

**Checks** (run 2026-11-16 on the branches):

| Repo     | Command                                                  | Result                         |
| -------- | -------------------------------------------------------- | ------------------------------ |
| Kirana-B | `npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.test.json` | ✅ 0 errors                 |
| Kirana-B | `npm run lint`                                           | ✅ clean                        |
| Kirana-B | `npx vitest run` (separate `kirana_p3_test` DB)          | ✅ 12 files, 128 passed         |
| kirana-F | `npx tsc`, `npx prettier --check src`                    | ✅ clean                        |
| kirana-F | `npx vitest run`                                         | ✅ 20 files, 109 passed (incl. POS perf: 500 adds + totals < 100 ms, 500 tiles) |
| kirana-F | `npm run build`                                          | ✅                              |
| Live     | Browser pass on `kirana_live_test`, done by a parallel session | ⏳ pending                |

UI skills used: `frontend-design`, `emil-design-eng`, `apple-design` and `break-ui`. `pick-ui-library` and
`prototype` aren't installed, and no UI dependency was added.

## Phase 2: what was built (2026-11-16)

Kirana-B `ff72475`, plus fixes `377a8e2` and `7694a85`; pushed 2026-11-16 with the owner's OK. It contains the backend and the acceptance tests, which a
parallel session wrote against the API contract on branch `phase2/tests`.

- **Model.** `KiranaMaterial` stays the product table (A-015: no renames). It gains:
  - SKU, `status` (ACTIVE/ARCHIVED), category and brand;
  - `baseUnit`/`salesUnit`/`purchaseUnit`;
  - `sellingPrice`/`mrp` (per sales unit) and `purchaseCost` (per purchase unit);
  - HSN, GST %, `priceIncludesTax` and `lowStockThreshold`.

  New tables: `Brand`, `ProductUnit` (factor = base units per unit), `ProductBarcode` (unique per
  business; carries the unit one scan means), `ProductAlias`, `ProductPriceChange` (append-only
  snapshots), `StockMovement` (append-only ledger), and `StockBalance` (read model).
- **Units** (`src/utils/units.ts`):
  - The units are PIECE, PACKET, BOX, CARTON, GRAM, KILOGRAM, MILLILITRE and LITRE.
  - Metric factors are fixed: 1 kg = 1000 g.
  - Pack sizes are per product, and must be whole numbers over a count base.
  - A metric unit over a count base is rejected.
  - Quantities are Decimal with at most 3 dp in base units, and are never rounded.
  - Loose (weighed) items are the ones with a mass or volume base unit.
- **Ledger** (`stock.service.ts` `applyMovement`):
  - The balance upsert locks the row, then the movement is appended with `balanceAfter`, in one
    transaction.
  - Rules:
    - OPENING is allowed once per product and store.
    - DAMAGE, EXPIRY and ADJUSTMENT need a reason.
    - No movement may take stock negative, except SALE.
    - Idempotency keys make retries safe.
  - The manual API allows OPENING, DAMAGE, EXPIRY and ADJUSTMENT. SALE and PURCHASE_* will be posted
    by their documents in Phases 4 and 6.
- **Prices:** every change to price, cost, unit or tax appends a snapshot. Past snapshots and movement
  `unitCost` never change (tested). Sale-line snapshots come with Phase 4.
- **API:**
  - `/catalog/products`: search across name, alias, SKU and barcode, with filters and pagination; CRUD;
    archive via PATCH status, with no delete.
  - `/catalog/products/:id/prices`, `/catalog/lookup?code=` (barcode, then SKU).
  - `/catalog/brands`.
  - `/catalog/import`: a dry-run report, then an all-or-nothing commit that returns 422 with row errors
    and writes nothing on failure.
  - `/stock/movements`.
  - A duplicate name, SKU or barcode returns 409 naming the conflicting product.
- **Permissions:** the new `catalog.cost.view` (OWNER, MANAGER, INVENTORY_MANAGER, ACCOUNTANT) controls
  whether `purchaseCost`/`unitCost` keys appear in responses. Cashiers and staff never receive them.
- **Removed:** the old material module, and the unmounted admin `material.service.ts` (dead code).
- **kirana-F** (branch `phase2/catalogue` @ `aa7e8e4`, built by a parallel session against the contract):
  - Product list, form and detail; the record-stock dialog; categories and brands; CSV import preview
    and commit; a reusable `ProductSearch`.
  - Typed from the generated `openapi.json`.
  - Its report: tsc ✅, vitest 70/70, prettier ✅, build ✅.
  - Fast-forward merged into kirana-F `main` and pushed (owner OK, 2026-11-16). On `main` after the
    merge: tsc ✅, vitest 70/70 ✅, build ✅.
- **Live pass** (2026-11-16): the API ran on :4800 against `kirana_test` with the test config, and
  kirana-F `phase2/catalogue` on :5174, with a demo owner and cashier.

  | Check                                                 | Result |
  | ----------------------------------------------------- | ------ |
  | GRAM product with a 500 g PACKET unit and a barcode    | ✅ PASS |
  | OPENING 2500 g → 2,500                                 | ✅ PASS |
  | DAMAGE 1 PACKET → 2,000 (a −500 movement)              | ✅ PASS |
  | Second OPENING → 409 shown in the dialog               | ✅ PASS |
  | Price change adds a history row                        | ✅ PASS |
  | Import preview lists the row errors; no commit offered  | ✅ PASS |
  | Cashier: no cost fields, no edit/stock/import actions  | ✅ PASS |
  | No horizontal scroll at 375 or 1280 px                 | ✅ PASS (detail page fixed in `c2449e9`) |
  | `ProductSearch`                                        | ⚪ N/A: not mounted until POS (unit tests only) |

  - Follow-up from the pass: the dialog now offers kg on gram-base products (`aa7e8e4`). The backend
    ledger accepts fixed metric units without a stored unit row (`Kirana-B` "Stock: accept fixed
    metric units", tested).
  - Not live-checked: that kg path in the browser, the list at 1280 px and the edit form at 375 px.

**Phase 1 closing (2026-11-16):**
- Pushed `Kirana-B` to `45d1b9a`; GitHub Actions CI ran on it and **passed**.
- Then added the OpenAPI spec (`c046128`, `3e7cc53`; A-025) and these docs. Kirana-B now has 85 tests.
- kirana-F now has the A-022 restyle (`fd07c95`), i18n en/hi/mr (`453fcfe`; A-024) and generated API types
  (`1394a43`, `04d6ec4`).
- kirana-F checks: tsc ✅, vitest 41 passed, prettier ✅, build ✅.
- Live checks at 375 and 1280 px passed, including Marathi at 375 px.
- The owner rotated the leaked credentials (O-1).
- The final batch is pushed only after the owner's OK.

## Desktop app (Kirana-desktop, not pushed)

**2026-11-17 — the desktop wraps kirana-F (A-029, owner's choice).**
- `Kirana-desktop` `766dece` is now only the Tauri 2 shell: Rust window, guards, CSP and the token
  commands. It builds `../kirana-F` and loads its `dist`; in development it loads kirana-F's Vite
  server on port 1420.
- The copied React UI, i18n and UI kit were removed (38 files), so web and desktop now share one UI,
  including the Phase 3 POS.
- kirana-F `desktop/tauri-transport` (`8b16861`, `e1096ae`; local, based on `main`): inside Tauri,
  `src/api/client.ts` calls `invoke('api_request' | 'login' | 'logout')`, and startup calls
  `restore_session`. The web path is unchanged. It adds `@tauri-apps/api` 2.12.4 (pinned).
  - Checks: tsc ✅, vitest 74/74 ✅ (4 new IPC tests), prettier ✅, build ✅.
- kirana-F's build was checked against the desktop CSP: no inline scripts or styles, no remote loads.
- `npx tauri info` parses the config (frontendDist `../../kirana-F/dist`, devUrl `:1420`).

**From the Phase 1 shell (2026-11-16, still true):**
- The Rust side owns the tokens: the access token is held in memory, and the refresh token is stored
  in Windows Credential Manager via `keyring`.
- `api_request` refreshes once on a 401 (single-flight), strips token fields from every reply, and
  refuses the auth routes and unsafe paths.
- Strict CSP, no Tauri permissions granted, a navigation guard, and `window.open` denied.

**Not run:** `cargo test` (13 Rust tests are written), `tauri dev` and `tauri build`. This PC has no
Rust/MSVC toolchain, and none was installed. Expect a first-compile fix. Commit `Cargo.lock` after
the first build.

**Open:**
- The bundle identifier `in.kiranaos.desktop` is a placeholder and needs confirming before packaging.
- The 409 business list returns only `{id, name}`, so two shops with the same name look identical in
  the picker. Add the city or store name (small Kirana-B change).
- On desktop, a role without `pos.use` now sees the full kirana-F app, not the old "use the web admin"
  screen.
## Repositories

| Path                     | Git (local)                                                         | Contents                                                     |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `kirana/` (root)         | not a repo                                                          | 4 repo folders, blueprint PDF, pointer `CLAUDE.md`           |
| `kirana/Kirana-B/`       | `main` = `origin/main` (Phase 2 pushed 2026-11-16); local branch `phase3/pos` | Backend API + project memory                       |
| `kirana/kirana-F/`       | `main` = `origin/main` `aa7e8e4` (Phase 2 pushed); local branch `phase3/pos` | Web admin (React 19 + TS + Vite)                   |
| `kirana/Kirana-app/`     | empty                                                               | Android (tech undecided, O-3)                                |
| `kirana/Kirana-desktop/` | `main` `766dece`, 7 local commits, **not pushed**                  | Tauri 2 shell around kirana-F (A-026, A-029)                 |

`SMulla786/kirana-backend` (the old repo, which holds the leaked credentials) still exists on GitHub (O-1, O-17).

## Phase 1A: what was built (2026-11-16)

Each step is its own commit on `Kirana-B` `main`. Steps 5–8 depend on each other, so they landed together
in one commit with their tests.

| Commit    | Content                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `7dcda39` | Step 1: build/boot restored (dead template exports removed, prettier fixed)                                 |
| `11f381c` | Step 4: Vitest + supertest harness, `*_test` DB guard, `prisma db push` global setup, GitHub Actions CI, `.npmrc` |
| `e6c9ce0` | Steps 2+9: unused S3/Cloudinary/multer/regression helpers and deps deleted; `X-Request-Id`; `GET /health`; safe error bodies |
| `a4cfa9d` | Merge of the harness branch                                                                                 |
| `eb3dc63` | Steps 5–8: business + store setup, session auth, roles/permissions, tenant scoping, 81 tests                |
| (docs)    | Step 10: this file, ARCHITECTURE, DECISIONS (A-015…A-021), REPOSITORY_MAP, PHASE_PLAN, README, CLAUDE.md     |

**Behaviour now:**

- **Business setup:**
  - Self-signup: `POST /api/v1/auth/register` creates the owner user, business, default store and OWNER
    membership in one transaction, then emails a 6-digit code.
  - Admin onboarding: `POST /api/v1/admin/businesses` does the same with a pre-verified owner.
  - `GET/PATCH /business` reads and updates the business profile, including an optional GSTIN.
- **Auth:**
  - Login uses username or email plus password.
  - Each login creates a per-device `Session`. The access JWT lasts 15 min and the refresh token is
    opaque, hashed and rotating; reuse is detected.
  - Supported: logout, logout-all, list and revoke sessions, change password (other devices are signed
    out), forgot/reset password (single-use, all sessions revoked), and resending the verification code.
  - Rate limits on auth and email endpoints. Login errors are uniform. Responses and logs never contain
    hashes, codes or tokens.
- **Roles:**
  - `Membership` with six roles and the `ROLE_PERMISSIONS` map; `requirePermission(action)` on every
    tenant route.
  - Members: `GET/POST /business/members`, `PATCH /business/members/:id` (role / isActive).
  - Deactivation and role changes take effect on the next request.
- **Tenancy:** the tenant comes from the session only (`tenantOf(req)`). Catalogue category/product CRUD
  is mounted at `/catalog`. Client/order services are scoped but stay unrouted.
- **Platform:**
  - `GET /health` checks the DB.
  - Request IDs appear in logs and in the `X-Request-Id` header.
  - 5xx bodies are generic, and Prisma errors are mapped without values.
  - The JSON body limit is 1 MB.

**Web shell (`kirana-F`):**
- **Built by:** the peer session `kirana-04`, against the API contract above.
- **Structure:** design tokens, a UI kit (Button, TextField, Select, Table, Dialog, StatusBadge,
  Empty/Error/Loading states), a responsive AppShell (sidebar, collapsible sidebar, drawer), and auth
  pages (login with a business picker, register, verify, forgot/reset).
- **Navigation:** role-aware nav driven by `me.permissions`, with a landing page per role. Catalogue,
  Staff and Business settings show real data; the other workspaces are phase placeholders.
- **Auth:** cookie auth with a single refresh-and-retry; no tokens in web storage. API types are written
  by hand (P-008 is still to do).

## Phase 2 checks (run 2026-11-16 on `ff72475`)

| Check                  | Command (in `Kirana-B/`)                 | Result                                         |
| ---------------------- | ---------------------------------------- | ---------------------------------------------- |
| Typecheck src / tests  | `npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.test.json` | ✅ 0 errors                  |
| Lint + Prettier        | `npm run lint`                           | ✅ clean                                        |
| Tests                  | `npm test`                               | ✅ 10 files, 115 passed (85 earlier + 25 acceptance/ledger + 5 unit-conversion) |
| Build                  | `npm run build`                          | ✅                                              |
| OpenAPI                | `npm run openapi:export`                 | ✅ `openapi.json` regenerated; the staleness test passes |
| Migration              | `npx prisma migrate deploy` / `migrate status` | ✅ 9 migrations, dev DB up to date        |

GitHub Actions CI on `6d6bf2f` (after the push): ✅ passed (Postgres 16, typecheck, lint, tests).

## Phase 1 checks (run 2026-11-16, Node 24.21, npm 11.19, Prisma 5.22, TS 5.9)

| Check                         | Command (in `Kirana-B/`)                       | Result                                      |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Typecheck src                 | `npx tsc --noEmit`                             | ✅ 0 errors                                  |
| Typecheck src + tests         | `npx tsc --noEmit -p tsconfig.test.json`       | ✅ 0 errors                                  |
| Lint (ESLint + Prettier)      | `npm run lint`                                 | ✅ clean                                     |
| Format                        | `npx prettier --check "src/**/*.ts" "tests/**/*.ts"` | ✅ clean                              |
| Tests                         | `npm test`                                     | ✅ 5 files, 81 tests passed (local `kirana_test`) |
| Build                         | `npm run build`                                | ✅ (dist/ deleted afterwards)                |
| Migrations vs dev DB          | `npx prisma migrate status`                    | ✅ 8 migrations, up to date                  |
| CI                            | `.github/workflows/ci.yml`                     | ⚪ not run yet (nothing pushed)              |
| kirana-F typecheck            | `npx tsc -b`                                   | ✅                                           |
| kirana-F tests                | `npx vitest run`                               | ✅ 13 passed (the peer's commit + my proxy change) |
| kirana-F build                | `npm run build`                                | ✅                                           |
| Live check                    | Backend on `:4800` against `kirana_test` (NODE_ENV=test) + `npm run dev`, Chrome | ✅ register → verify → login via API; cashier lands on `/pos` with nav limited to Dashboard/POS/Catalogue/Customers; 768 and 1280 px fine. 375 px: the first run found the drawer stuck mid-slide over the menu button (a click hit Dashboard). Fixed in kirana-F `e58f246`; re-checked at a true 375x740 mobile viewport: drawer `display:none`, menu button top-left, no horizontal scroll, route stays `/pos`. |

## Migrations

- **Phase 3:** `prisma/migrations/20261116200000_phase3_pos/`. It's additive only:
  - `KiranaMaterial."isFavourite" BOOLEAN NOT NULL DEFAULT false`;
  - a `HeldBill` table, with an index on `(kiranaId, storeId, createdAt)`;
  - FKs to kirana, Store and User (RESTRICT), and to client (SET NULL).

  It was generated with `prisma migrate diff`, so no DB was touched. It's in the branch worktree and **not
  yet applied to the dev DB**: at merge, copy the folder into `Kirana-B/prisma/migrations/` and run
  `npx prisma migrate deploy`.
- **Phase 2:** `prisma/migrations/20261116180000_phase2_catalogue_stock_ledger/`. The SQL was
  hand-reviewed and applied to the dev DB `kirana` (0 products) and to `kirana_test` (legacy test rows).
  - It adds the new enums and tables, then backfills:
    - legacy `unit` → `baseUnit`/`salesUnit`/`purchaseUnit` (DOZON and NOs → PIECE);
    - `barcode` → `ProductBarcode`;
    - a baseline `ProductPriceChange` per product;
    - non-zero `inventory` → an OPENING (or ADJUSTMENT if negative) movement plus a balance in the
      default store.
  - Only then does it drop `unit`, `barcode` and `inventory`.
  - The test DB needed this, because `prisma db push` can't add required columns to a table with rows.
    Fresh databases still use `db push`.
- **Phase 1A:** a new local migration, `prisma/migrations/20261116120000_phase1a_business_store_membership_session/`,
  was created as reviewed SQL and applied to the dev DB `kirana`, which was empty (owner: throwaway).
  - It adds the `MembershipRole` enum and the `Session`, `Membership` and `Store` tables.
  - It adds `kirana.name`/`gstin`, defaults `amount`/`renewalAmount` to 0, makes `User.email` unique, and
    adds the reset-token columns.
  - It backfills existing kiranas as a default store plus an OWNER membership, and existing employees as
    STAFF, and clears the old plaintext `User.refreshToken`.
- ⚠ Migrations are gitignored (P-006), so this folder exists **only on this PC**. Back it up. Fresh
  databases can be created with `prisma db push`.
- The local `.env` value of `JWT_ACCESS_EXPIRATION_MINUTES` was changed to 15: the new config rejects
  values over 60, and the old value was about 570 years. No other `.env` values were read or changed.
- New optional env vars: `APP_URL` (email links) and `AUTH_RATE_LIMIT_MAX`. See `.env.example`.

## Feature status against the MVP

✅ done · 🟡 partial · ❌ missing · ⚠️ breaks a product rule

| Area                       | Status | Notes                                                                                        |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Business + store setup     | ✅     | Self-signup and admin onboarding; single default store; no multi-store workflows (A-002)    |
| Authentication / sessions  | ✅     | See above. Deferred: cashier PIN, per-account lockout                                        |
| Roles / permissions        | ✅     | Server-enforced and tested; the UI only hides                                                |
| Tenant isolation           | ✅     | Catalogue, business and members are tested cross-tenant; order/client services scoped, unrouted |
| Web admin shell            | ✅     | A-022 look, i18n en/hi/mr, generated API types                                               |
| Desktop POS shell          | 🟡     | Tauri shell wraps kirana-F (A-029); Rust never compiled (no toolchain); hardware is O-4       |
| Android shell              | ❌     | Phase 8 (O-3)                                                                                |
| Catalogue / units / stock  | ✅     | Phase 2: backend and web screens, live-passed                                               |
| POS (web): cart, scan, held bills | 🟡 | Phase 3 built and tested on branches; live pass and merge pending                  |
| Sales, udhaar, purchasing  | ⚠️/❌  | Old order/wallet code is Float, mutable and unrouted (P-011) → Phases 4–6                    |
| OpenAPI contract (A-025)   | ✅     | Generated from zod; kirana-F generates its types                                             |

## Known gaps and risks

1. **Old repo:** the credentials are rotated (O-1). Still to do: archive or delete `kirana-backend` (O-17).
2. **Pushes:** the first batch is pushed (CI green on `45d1b9a`). Later commits wait for the owner's OK.
   `Kirana-B` is a **public** GitHub repo (the API answered without auth). Confirm that's intended.
3. **Migrations exist only on this PC** (P-006). Back up `prisma/migrations/`.
4. **kirana-F:**
   - The mobile drawer is fixed and verified (`e58f246`).
   - The restyle to the owner's chosen look (A-022, GeoSales reference), using the installed UI
     skills, is in progress in the peer session. Check its commit.
   - Still missing: ESLint in kirana-F and page-level tests. "Log out" wraps at 375 px.
5. **Auth hardening still open:**
   - Rate limits use an in-memory, per-IP store, which needs a shared store with more than one instance.
   - No per-account lockout.
   - Refresh tokens are also returned in the login body for web clients, so XSS could read them; the
     only client affected is web.
   - Sessions have a fixed 30-day lifetime and no cleanup job.
   - The verify-code attempt counter is IP-limited only.
6. **Legacy leftovers:**
   - The `User.refreshToken` column and the `employee` table are unused, as are `User.role`
     KIRANA/EMPLOYEE, which are labels only.
   - `addMember` always creates a new login; adding an existing user to a second business isn't
     supported.
7. **Old sales/udhaar design** (Float money, mutable orders, required customer, trusted client totals):
   unrouted, to be retired in Phases 4–5 (P-011).
8. **Hygiene:**
   - `package.json` `name`/`repository` still point to the old template.
   - `updateRoleToAdmin` points at a wrong path.
   - `prisma:reset` uses `--force`.
   - `prepare: husky` runs without a `.husky/` folder; use `HUSKY=0 npm install`.
   - `@types/express` is v4.
   - Catering fields remain in `client.validation`; the `Gender` enum is unused.
9. **Email delivery** was never tested against real SMTP; tests use `jsonTransport`.
10. **Phase 2 gaps:**
    - The ledger is append-only in code (no update or delete routes or services). There is no DB
      trigger yet; add one in Phase 10.
    - No stock valuation yet: movements store `unitCost`, and the method waits for O-15.
    - Variants are separate products, because nothing in the brief requires variant groups.
    - Import is create-only (no update-existing mode), CSV only (save Excel as CSV), and capped at
      1000 rows in one transaction.
    - Low-stock thresholds are per product, not per store (single store, A-002).
    - Category and brand names are unique case-sensitively in the DB; the import matches them
      case-insensitively.
    - The global `Material` catalogue is untouched and unused (O-6).
11. **Phase 3 gaps:**
    - **Tax:** no GST in the cart preview; Phase 4 invoices compute tax.
    - **Out of stock:** products can still be added. The ledger allows SALE below zero, and the warning
      is a text label.
    - **Hindi/Marathi:** the POS strings are machine-drafted and need native review.
    - **Re-holding:** a recalled bill whose override or discount was set by a manager can't be re-held by a
      cashier (403, shown inline, with "Reset to catalogue price" / "Remove discount" buttons). Non-overridden
      lines show and re-hold at today's catalogue price.
    - **Customers:** search and quick add only. Credit, udhaar and statements are Phase 5.
    - **Held bills:** no expiry or cleanup job. The list is capped at 200 per store.
    - **Not run:** no concurrent-recall test (the 404 is tested in sequence; the transaction's delete count
      decides it), and no real hardware scanner test (the wedge is simulated in jsdom).
    - **Shortcut:** `src/docs/openapi.ts` emits nullable registered refs as `allOf + nullable`, and
      openapi-typescript drops the null. kirana-F restores it in `src/pages/pos/types.ts` (marked
      `shortcut:`).
    - **Catalogue validation:** it is stricter than the ledger. A product with `salesUnit: KILOGRAM` on a
      GRAM base needs a stored KILOGRAM unit row (reported to the Phase 2 owner).

## Manual verification

1. Run the backend:
   - `cd Kirana-B && HUSKY=0 npm install && npm test`.
   - Then `npm run dev` with a real `.env`: SMTP, `APP_URL`, and `JWT_ACCESS_EXPIRATION_MINUTES` ≤ 60.
2. `curl localhost:$PORT/health` should return `{"status":"ok","db":"up"}`.
3. Run the web shell:
   - `cd kirana-F && npm install && API_PROXY_TARGET=http://localhost:$PORT npm run dev`.
   - Open `http://localhost:5173`.
4. Walk through the flows:
   - Register a business, then enter the emailed code at `/verify`.
   - Log in: the owner lands on `/dashboard` with the full nav.
   - Staff → add a cashier, then log in as the cashier: they land on `/pos` with a reduced nav, and
     catalogue edits are rejected by the API (403).
5. Check the layout at 375, 768 and 1280 px widths.
6. **Phase 2:** apply the migration (`npx prisma migrate deploy`), then check out kirana-F
   `phase2/catalogue`.
   - Create a product with base GRAM and a 500 g PACKET unit plus a barcode.
   - Record OPENING 2.5 KILOGRAM: stock should show 2500.000.
   - Record DAMAGE 1 PACKET with a reason: stock should show 2000.000.
   - A second OPENING should return 409.
   - Change the selling price: price history gets a new row, and the old row is unchanged.
   - Scan the barcode in `ProductSearch`.
   - As a cashier, no purchase cost is visible anywhere.
   - Import a CSV with one bad row: the preview lists it, and the commit is refused with nothing written.
7. **Phase 3:** apply the Phase 3 migration, then open `/pos` with an owner and a cashier.
   - **Scanning:** type a barcode fast and press Enter, with focus anywhere outside the search box: the item
     is added. Scan it again: its quantity becomes 2. Scan while the qty box is focused: the field is
     restored and the item is still added.
   - **Weighed items and totals:** sell a loose gram product as 1.25 kg. Check that the totals are right
     after changing qty, unit and discount.
   - **Hold and recall:** hold (F8). The product's stock and movements are unchanged. Recall (F9) loads the
     bill, and recalling it again from a second tab gives 404.
   - **Cashier:** the cashier sees no discount or price inputs. Re-holding an owner's discounted bill gives an
     inline 403, and the cart is kept.
   - **Keyboard and layout:** the keyboard alone (F2, arrows, Delete, +/-, F1 help) never leaves focus on
     the page body. At 1024×600 the cart and grid don't overlap.

## Next action

1. **Owner:**
   - Make Kirana-B private, if that's still the plan; it was public at the last check.
   - Archive or delete `kirana-backend`.
   - Back up `prisma/migrations/`, which now has 9 migrations.
   - Confirm the defaults taken for O-6 (global catalogue left unused) and O-15 (cost recorded per
     movement; method decided in Phase 7, recommended: moving weighted average).
   - Get the hi/mr strings reviewed by a native speaker before the pilot.
2. **Phase 3 merge:** this needs the owner's OK.
   - Finish the live pass and the independent review.
   - Merge Kirana-B `phase3/pos` (a fast-forward on `f0b6c90`) and kirana-F `phase3/pos` (on `aa7e8e4`).
   - Copy and apply the Phase 3 migration to the dev DB.
   - Push both and confirm CI is green.
3. **Then, in a fresh chat:** Phase 4 (checkout, payments, invoices, receipts, returns). Use the blueprint
   prompt, posting stock through `applyMovement(... type 'SALE')`. Settle O-8 (GST registration) and O-10
   (trusted UPI) first.
