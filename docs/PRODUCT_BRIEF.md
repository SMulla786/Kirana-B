# Product brief — KiranaOS (working name)

## Vision

One modular, affordable retail operating system for Indian kirana shops, medium grocery stores and
supermarkets. Easy for non-technical shopkeepers, complete for core retail operations, with counter billing
that keeps working offline. Complexity adapts to the business (settings and roles reveal features); it is
one product, not separate products per shop size.

## Users and roles

| Role              | Main jobs                                                          |
| ----------------- | ------------------------------------------------------------------ |
| Owner             | Setup, prices, staff, udhaar, cash, reports, approvals             |
| Manager           | Day-to-day operations, overrides within policy, shift supervision  |
| Cashier           | Billing, payments, returns within permission, shift open/close     |
| Inventory Manager | Products, receiving, stock counts, adjustments (with review)       |
| Accountant        | Ledgers, expenses, supplier payments, reports                      |
| Staff             | Limited, explicitly granted actions                                |
| Platform admin    | KiranaOS operator (not a shop role): onboarding, support           |

## Platforms

| Platform        | Responsibility                                                                    | Offline policy (MVP)                                                |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Windows desktop | Hybrid POS: scan/search/grid, cart, held bills, printer, register/shift           | Full offline billing after Phase 9: local durable store + outbox    |
| Web             | Owner/admin: products, inventory, purchases, customers, finance, staff, reports   | Online only                                                         |
| Android         | Owner dashboard, mobile POS, stock count, customer collections, receiving         | Online-first; safe cached reads only; no offline financial writes   |

## MVP scope

1. Business setup: one store per business, store-aware data model.
2. Authentication, roles, permissions.
3. Product catalogue, units and conversion, barcodes.
4. Stock ledger.
5. Hybrid POS: scanner, search, product grid, held bills.
6. Checkout and payments (cash, UPI-recorded, card, bank transfer, customer credit), invoices/receipts, sales returns.
7. Customer udhaar ledger.
8. Suppliers, purchases, goods receiving, payables.
9. Cash, expenses, shift close.
10. Owner web dashboard and reports.
11. Android owner/cashier/inventory basics.
12. Desktop offline billing and sync.
13. Security, backups, pilot readiness.

## Post-MVP (one at a time, prioritised by pilot evidence)

Advanced expiry/batch · AI restocking · invoice OCR · WhatsApp integrations · loyalty · online ordering ·
multi-store workflows.

## Non-goals for the MVP

- Multi-store workflows (the data model stays store-aware only).
- Offline financial writes on Android.
- Auto-posting OCR/AI-generated purchases, payments or financial entries.
- Treating a displayed UPI QR or a cashier click as bank-confirmed payment.
- Assuming GST registration, or hard-coding tax rules that haven't been checked with a tax professional.
- Separate products or codebases per shop size.

## Market defaults

India and INR. Indian mobile numbers (the current validator is `^[6-9]\d{9}$`). English/Hindi/Marathi
language support is configurable (from the blueprint; needs confirming, DECISIONS O-9). Tax settings and
invoice series are configured per business; GST is optional.

## Core business invariants

- Every stock change has a movement with source, actor, timestamp and reason/reference.
- Completed sales and payments are immutable; corrections use returns, reversals or adjustments.
- Customer and supplier balances are derived from linked ledger entries, never edited totals.
- Invoices preserve the price, discount and tax treatment used at completion.
- Cash balance, revenue, gross profit and net profit are separate concepts. Profit needs a defined cost
  basis and returns handling.
- Offline retries are idempotent: a repeated upload never creates a second sale or payment.
- A printer error never undoes a completed sale. A failed sync never erases a locally committed sale.
- Tenant and role permissions are enforced on the backend.
