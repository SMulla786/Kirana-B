# Phase plan

Each phase runs in a fresh Claude Code chat, using that phase's prompt from
`../KiranaOS_Development_Blueprint.pdf`. Start by reading `CLAUDE.md` and the docs. Finish by updating
`PROJECT_STATE.md` and the Status column below. Don't start the next phase in the same chat.

| #   | Phase                                                                                      | Depends on                  | Status                 |
| --- | ------------------------------------------------------------------------------------------ | --------------------------- | ---------------------- |
| 0   | Discovery and baseline                                                                     | —                           | ✅ Done 2026-11-16     |
| 1A  | Backend foundation: build fix, test harness, auth security, business + store, roles, tenancy | 0 + owner prerequisites     | ✅ Done 2026-11-16 (local, not pushed) |
| 1B  | Client foundation: `kirana-F` web admin shell, design tokens, desktop POS placeholder shell | 1A; O-4, O-9                | 🟡 Web shell built with 1A; remainder ⏭ Next |
| 2   | Catalogue, units, barcodes, stock ledger                                                   | 1A (1B for screens)         | Not started            |
| 3   | Desktop hybrid POS: search, scanning, cart, held bills                                     | 1B, 2                       | Not started            |
| 4   | Checkout, payments, invoices, receipt printing, returns                                    | 3; O-8, O-10                | Not started            |
| 5   | Customers and udhaar ledger                                                                | 4                           | Not started            |
| 6   | Suppliers, purchasing, goods receiving, stock operations                                   | 2, 4                        | Not started            |
| 7   | Web owner portal, finance, shifts, reports, administration                                 | 4–6                         | Not started            |
| 8   | Android (`Kirana-app`): owner, cashier, inventory                                                    | Stable APIs from 2–7; O-3   | Not started            |
| 9   | Desktop offline-first billing and sync                                                     | 4–6 stable; O-11            | Not started            |
| 10  | Quality hardening, pilot readiness, release                                                | 1–9; O-13                   | Not started            |
| 11  | Post-MVP features, one sub-phase at a time                                                 | 10 + pilot evidence         | Not started            |

Offline support shapes design from Phase 1 (UUIDs, idempotency, append-only records), but the sync engine
waits for Phase 9, once sale/payment/stock/ledger contracts are stable.

## Phase 1A — Backend foundation

Use the blueprint's Phase 1 prompt and limit it to this list. Steps are in order; commit each separately.
Work in `Kirana-B`. Its first commit (`d3c9a0c`, the imported old backend plus Phase 0 docs) is on
`origin/main`, so every step below is a reviewable diff on top of it.

_Done 2026-11-16. Commits and results are in PROJECT_STATE. Steps 5–8 landed as one commit because
they depend on each other._

1. **Restore build and boot (behaviour-neutral):** remove the dead exports/routes in `controllers/index.ts`,
   `services/admin/index.ts` and `routes/admin/index.ts`; fix the 2 prettier errors. `tsc`, lint and app
   load must pass.
2. **Secrets hygiene:** the `.env.example` placeholders and removal of the AWS fallbacks were done
   2026-11-16. Remaining: decide whether to delete the unused S3/Cloudinary helpers (P-007). Rotation is
   the owner's job (O-1).
3. **Reproducibility:** skipped. The owner keeps migrations and the lockfile gitignored (P-006), so test and
   CI databases are created with `prisma db push` from `schema.prisma`, and CI uses `npm install`.
4. **Test harness and CI** (P-003): `npm test`, a test DB, and a GitHub Actions workflow running
   typecheck, lint and tests.
5. **Auth fixes** (P-005; PROJECT_STATE issues 2–7): no `role` in public registration; no sensitive fields
   in responses or logs; token separation and short TTL; hashed per-device sessions with rotation and
   revoke; single-use reset tokens; CSPRNG codes; working auth rate limits; uniform login errors.
6. **Business + Store setup** (P-001; consider O-5, O-12): an atomic flow creating user + business + default
   store + OWNER membership; a business profile read/update endpoint. This fixes the "Seller not found" login.
7. **Roles and permissions** (P-004): `Membership`, the permission map, `requirePermission`, and migration of
   existing KIRANA/EMPLOYEE users.
8. **Tenant scoping:** apply `{id, kiranaId}` scoping to every existing kirana service (material, category,
   client, order). Mount only the catalogue category/material routes, as the isolation-test vehicle. Order
   and client routes stay unmounted until Phases 4–5.
9. **Platform basics:** `GET /health`, request IDs in logs, error bodies that don't echo internals.
10. **Docs:** update PROJECT_STATE, ARCHITECTURE (auth/tenancy as built), DECISIONS (P-001/3/4/5/6 →
    Accepted or amended), and setup instructions in README.

**Out of scope:** stock, pricing, sale/udhaar logic, money-type migration of the order tables, client apps.

**Done when:** a user can create/access a business and its default store; Business A can't read or mutate
Business B data even with guessed IDs (tested); role restrictions are enforced and tested server-side;
build, lint and tests pass in CI; no secrets in the repo.

## Phase 1B — Client foundation

**Status 2026-11-16:** the owner chose to build the `kirana-F` web shell alongside 1A (A-020), and it
exists as local commits. **Remainder:**
1. Verify the 375 px drawer and route-on-resize fix.
2. Add ESLint and page-level tests to kirana-F.
3. Generate the OpenAPI spec from zod in Kirana-B, and a typed kirana-F client from it (P-008). This
   replaces `src/api/types.ts`.
4. Add i18n scaffolding once O-9 is answered.
5. Build the `Kirana-desktop` placeholder shell once O-4 is answered.

Settle O-4 and O-9, then clone the client repos next to the backend. In `kirana-F`, build the web
admin shell (React + TS + Vite, P-009): login, business setup, role-aware navigation, design tokens,
typography, spacing, buttons, forms, tables, dialogs, status/empty/error/loading states, and a typed API
client generated from Kirana-B's OpenAPI spec (P-008). In `Kirana-desktop`, build a placeholder Electron POS
shell with login and role routing. Give each client repo a pointer `CLAUDE.md`. `Kirana-app` waits for
Phase 8 (O-3).
**Done when:** each role lands in the correct workspace; layouts work at mobile, tablet and desktop widths.

## Acceptance checkpoints, Phases 2–11 (condensed from the blueprint)

- **2 Catalogue and stock:** tenant-scoped product CRUD, search and archive; duplicate barcodes detected;
  unit conversions deterministic and tested, including fractions; every stock change is a movement with
  source, actor, time and reason; balances reconcile to the ledger in tests; price changes don't alter past
  transactions; invalid imports don't partially corrupt the catalogue.
  _Codebase note: replaces `KiranaMaterial.inventory` and the `MaterialUnit` enum; decide O-6 and O-15._
- **3 POS:** scan, search and grid without leaving POS; repeat scans increment quantity per the defined rule;
  weighted items take fractional quantities; totals stay correct after edits; held bills don't touch stock,
  sales or balances; keyboard flow without focus loss; price/discount overrides are permission-gated.
- **4 Checkout:** cash, UPI-recorded, card, bank transfer and credit modes; split payments reconcile exactly;
  UPI never shown as bank-confirmed without a trusted integration; one completed sale gives exactly one
  invoice + payment set + stock movement set (idempotent); a printer failure keeps the sale and allows a
  reprint; returns reverse stock and balances without mutating the invoice; completed bills stay
  historically stable. _Codebase note: P-011 for the current `order` tables._
- **5 Udhaar:** a credit sale raises outstanding by the unpaid amount exactly once; partial payments are
  traceable; returns and reversals post linked entries; credit limits and cashier permissions are enforced
  server-side; statements reconcile; posted entries can't be edited or deleted.
- **6 Purchasing:** only received quantity adds stock; a posted receipt links purchase, movement and payable;
  partial supplier payments reduce the payable; purchase returns don't rewrite the original; stock-count
  differences need review and create audited adjustments; supplier statements reconcile.
- **7 Owner portal:** dashboard totals reconcile to source transactions; gross profit ≠ net profit ≠ cash;
  shift close computes expected cash; discrepancies need explanation/approval; reports use consistent
  filters, timezone and return handling; role restrictions enforced in the APIs.
- **8 Android:** role-limited destinations; mobile sales use the same backend transaction model; the camera
  scanner handles denied permission and duplicate scans; stock-count drafts survive app restarts;
  collections can't be double-submitted; no sensitive data in notifications or insecure storage; usable
  with system font scaling.
- **9 Offline:** offline bills survive restart and power/network loss; retries never duplicate; local sales and
  cloud purchases both survive sync without stock overwrite; conflicts stay visible and recoverable; the UI
  distinguishes local commit from server confirmation; sync is auditable per event/device/business; local
  backup and restore are tested.
- **10 Pilot:** E2E tests for critical workflows; ledger/stock invariants reconcile under failure; supported
  hardware tested; backups restored in a test environment; no open critical tenant/authorization defects;
  performance measured; pilot support and rollback documented.
- **11 Post-MVP:** only the selected sub-phase; core invariants intact; human approval for AI/OCR financial
  actions; external integrations have credentials, consent, error handling and audit; measurable value and
  a disable path.
