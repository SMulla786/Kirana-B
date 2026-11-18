# Phase 3 POS review (2026-11-17)

This is an independent, read-only review of `phase3/pos`: Kirana-B @ `09fd5c2` (from `f0b6c90`) and
kirana-F @ `53a8513` (from `aa7e8e4`). It was done by reading the code; no tests were run.

Two findings, #2 and #3, were re-checked against the branch code and confirmed.

**Verdict:** the backend is sound on tenancy, strict schemas, server-side price snapshots,
permissions, held bills never touching stock or sales, and the two-till recall race. **Do not merge
until items 1–6 are fixed.**

## Must fix before merge

1. **Back-to-back scans in the search box are lost** (`kirana-F src/catalog/ProductSearch.tsx:77-93`).
   - `lookup()` clears the box only after the response arrives, and the `seq` check throws away older
     results.
   - With about 400 ms latency, three scans 300 ms apart concatenate into one code: a 404, no item
     added, and garbage left in the box.
   - Fix: copy the code and clear the box before the `await`. Handle every lookup result; keep `seq`
     for the typeahead only.
   - Add a test that scans into the focused search box.
2. **Tile and dialog prices are multiplied by the sales-unit factor** (`ProductGrid.tsx:35`,
   `Dialogs.tsx:18-21`). `scalePaise(selling, factor)` is called without `salesFactor`, but
   `sellingPrice` is already per sales unit.
   - Example: gram-base atta sold at ₹45/kg shows "₹45,000.00 / kg". The quantity dialog previews
     ₹22.50 for 0.5 g, but the cart charges ₹0.03.
   - Fix: the tile shows `selling` as is. The dialogs reuse cart's `priceFor(selling, factor,
     salesFactor)`.
   - Add tests with `salesUnit ≠ baseUnit`.
3. **The per-unit price is rounded before the quantity multiplies it**, on both the server
   (`heldBill.service.ts:128-131`, `round2(sellingPrice×factor/salesFactor)`) and the client
   (`money.ts:28-32`, `cart.ts:70`).
   - Example: 750 g at ₹45/kg bills ₹37.50 instead of ₹33.75; at ₹44/kg it bills ₹30.00 instead
     of ₹33.00.
   - It is also a loophole: a cashier can pick a smaller unit to get an unapproved effective
     discount.
   - Fix: never round the derived unit price. Compute `gross = round2(qty × factor × sellingPrice /
     salesFactor)` with Decimal on the server and BigInt on the client. Store `unitPrice` at 4–6 dp,
     or store the sales-unit price plus the factor.
   - Amend A-028 to match.
4. **Scans are silently dropped or replace an open dialog** (`Pos.tsx:117-120, 128-145`).
   - `if (dialog) return;` drops a scan made while the quantity dialog is open (an undercharge).
   - A lookup that resolves after a dialog opens replaces it.
   - Fix: queue the scan, or show a notice. Check `dialog` when the lookup resolves.
5. **Changing a line's unit loses focus and moves the selection** (`CartPanel.tsx:206-208`,
   `cart.ts:94-115`).
   - The React key is `productId:unit`, and `setUnit` changes it, so the line remounts. Focus drops to
     `<body>` and `selected` falls back to the last line.
   - Example: a following Delete removes the wrong line.
   - Fix: give each line a stable `id` for the React key and the selection. Keep `key` only for
     merging.
6. **Recall deletes the server copy before the client has it, and hold isn't idempotent**
   (`heldBill.service.ts:192-200`, `Pos.tsx:148-182`).
   - A lost recall response, or a closed window, loses the bill.
   - A lost hold response plus a retry duplicates it.
   - Fix: recall *claims* the bill (`recalledAt`, `recalledBySessionId`; a repeat recall by the same
     session returns it; claimed bills are hidden from the list). Delete it when the bill is
     re-held or sold.
   - Add an `idempotencyKey` on hold, as stock movements have.

## Nice to have

- **Loose products:** a pre-packed barcode on a loose product always opens the weight dialog. Decide
  by the scanned unit (`isLooseUnit(unit)`), not `product.isLoose`.
- **Unpriced products:** the client sends `unitPrice:"0.00"` for them, so a manager silently holds the
  line at ₹0 and a cashier gets a misleading 403.
- **Recall errors:** "Hold first" closes the dialog, so a later recall error is never shown.
- **Recall transaction:** `serialize()` runs inside the recall transaction on the global client.
  Serialize after the commit.
- **Held-bill list:** it stops at 200 rows with no paging or expiry.
- **Stale recalled lines:** a recalled line whose unit or factor changed shows a stale unit and price.
- **Scanner edge cases:** short bursts into guarded fields; scans into unguarded dialog fields; and
  the typeahead's active item winning over a scanned code.
- **Large quantities:** there's no quantity cap, so `paise × milli` can pass 2^53.

## Acceptance (Phase 3 Definition of Done)

| # | Criterion | Status |
|---|---|---|
| 1 | Scanner, search and grid, without leaving the POS | Not met under real latency (#1, #4) |
| 2 | Repeated scans increment | Not met: the reducer is right but scans are lost (#1, #4) |
| 3 | Weighted products | Partly met: quantities and units work, prices are wrong (#2, #3) |
| 4 | Totals after edits | Partly met: correct except lines below the sales unit (#3) |
| 5 | Held bills don't touch stock, sales or balances | Met, except loss or duplication on a dropped response (#6) |
| 6 | Keyboard without focus loss | Partly met (#5) |
| 7 | Price and discount permissions | Met on the server, except the rounding loophole (#3) |

## Resolution (2026-11-18)

All six must-fix items are fixed and merged locally on `main`: Kirana-B `5c9c869` and kirana-F `96f1de9`.
Nothing is pushed.

| # | Fix | Commit |
|---|---|---|
| 1 | The search box clears before awaiting a lookup, and every result is handled | kirana-F `1f9c2f4` |
| 2 | Tiles show the sales-unit price; dialogs scale by factor/salesFactor | kirana-F `6797b03` (from kirana-44) |
| 3 | The line gross is `round2(qty × factor × sellingPrice / salesFactor)`, on the server (Decimal) and the client (BigInt); the unit price is for display only | Kirana-B `4f2f974`, kirana-F `1f9c2f4` |
| 4 | Picks during a dialog are queued and added when it closes | kirana-F `1f9c2f4` |
| 5 | Cart lines carry a stable `id` (the React key); the selection follows a unit change | kirana-F `1f9c2f4` |
| 6 | Hold takes an `idempotencyKey` (concurrent retries replay too). Recall claims with a `claimKey`, and the till confirms with a DELETE | Kirana-B `4f2f974`, `d88c579`; kirana-F `1f9c2f4` |

**Nice-to-haves done:**
- A loose *unit* decides the weight dialog.
- An unpriced line at ₹0 isn't sent as an override.
- A recall error after "Hold first" stays visible.
- The recall serializes after the claim.
- BigInt line maths removes the 2^53 limit.

**First live pass** (kirana-44, kirana-F `f507ce6` + Kirana-B `4f2f974`): 10 pass, 1 partial, 2 fail. Its
defects and their fixes:

| Defect | Fix | Commit |
|---|---|---|
| D1 (high): a late confirm got 204 after another till had confirmed | Confirm marks `recalledAt` instead of deleting; any other claim gets 409 | Kirana-B `5c9c869` |
| D2: Delete did nothing from a unit select | Delete, + and − act on the line from a select | kirana-F `d539a58` |
| D3: the cart showed about one row at 1024×600 | The cart spans the chip row; on short screens Hold/Recall sit beside the totals | kirana-F `d539a58` |
| D4: a product with no category or favourite has no tile | By design; it's found through search | none |
| D5: the Hold label ignored a remap | The labels come from the live keymap | kirana-F `d539a58` |
| D6: dialogs opened on the × button | `Dialog` focuses `[data-autofocus]` after `showModal()` | kirana-F `d539a58` |

Also in `5c9c869`: concurrent same-key stock movements (Phase 2 code) now replay instead of failing.

**Re-pass on the mains** (Kirana-B `5c9c869`, kirana-F `96f1de9`):
- **Pass:** D1 (API 12/12, plus the on-screen notice), D2, D3 (cart lines 68 → 196 px at 1024×600), D5 and
  D6, plus 750 g = ₹33.75 and a hold retry giving one bill.
- **Fail:** three fast scans added 2 (**D7**, a bug from before this review). When a lookup resolved, it
  cleared the search box again, which wiped the next half-typed code. Fixed in kirana-F `5799510`: the box
  is cleared only at Enter. A unit test reproduces the timing, fails before the fix and passes after. The
  live recheck passed: 3 fast scans gave +3, 4 of 4 rounds.

**Verdict:** all acceptance criteria are met on the merged mains. Phase 3 is accepted, pending the push.
