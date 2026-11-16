# Project state

_Last updated 2026-11-16 · Phase 1A (backend foundation) done, plus the `kirana-F` web shell · Next: see
the bottom_

## Repositories

| Path                     | Git (local)                                                         | Contents                                                     |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `kirana/` (root)         | not a repo                                                          | 4 repo folders, blueprint PDF, pointer `CLAUDE.md`           |
| `kirana/Kirana-B/`       | `main`; `origin/main` = `d3c9a0c`; Phase 1A commits are local, **not pushed** | Backend API + project memory                       |
| `kirana/kirana-F/`       | `main`; local commits only, **not pushed**                          | Web admin shell (React 19 + TS + Vite)                        |
| `kirana/Kirana-app/`     | empty                                                               | Android (tech undecided, O-3)                                |
| `kirana/Kirana-desktop/` | empty                                                               | Windows POS (waits for O-4)                                  |

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

## Checks (run 2026-11-16, Node 24.21, npm 11.19, Prisma 5.22, TS 5.9)

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

- A new local migration, `prisma/migrations/20261116120000_phase1a_business_store_membership_session/`,
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
| Web admin shell            | 🟡     | Built; mobile verified; restyle to A-022 in progress; no i18n yet (O-9)                      |
| Desktop POS shell          | ❌     | Waits for O-4 (Electron and hardware)                                                         |
| Android shell              | ❌     | Phase 8 (O-3)                                                                                |
| Catalogue / units / stock  | 🟡⚠️   | Basic tenant-scoped CRUD only. Hard delete; `inventory` Float; enum units → Phase 2           |
| Sales, udhaar, purchasing  | ⚠️/❌  | Old order/wallet code is Float, mutable and unrouted (P-011) → Phases 4–6                    |
| OpenAPI contract (P-008)   | ❌     | Swagger UI exists with no annotations; kirana-F types are hand-written                        |

## Known gaps and risks

1. **Leaked credentials (owner):** rotate the AWS key and Gmail app password, and archive or delete
   `kirana-backend` (O-1, O-17).
2. **Nothing is pushed:** `Kirana-B` and `kirana-F` commits are local only, so CI has never run on GitHub.
   Pushing needs the owner's go-ahead.
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

## Next action

1. **Owner:**
   - Review the local commits in `Kirana-B` and `kirana-F`, then say whether to push (CI then runs on
     GitHub).
   - Rotate the credentials (O-1).
   - Back up the migrations.
   - Answer O-4 (desktop: Electron plus target hardware) and O-9 (languages).
2. **Then, in a fresh chat: Phase 1B remainder.** Paste the Phase 1 prompt and add:
   _"Implement the Phase 1B remainder only, as defined in docs/PHASE_PLAN.md."_ That covers:
   - verify the kirana-F mobile fix
   - the OpenAPI spec from zod plus a generated kirana-F client (P-008)
   - the `Kirana-desktop` placeholder shell, if O-4 is answered
3. After that, **Phase 2 (catalogue, units, barcodes, stock ledger)**. Decide O-6 and O-15 first.
