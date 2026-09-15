# Architecture

The guiding rule is that complexity belongs in the system, not in the
interface. A PG owner should be able to do a day's work in a few taps while the
backend carries the burden of dates, rates, history and correctness.

---

## 1. The backend is the source of truth

The app never computes money, never decides what a tenant owes, and never
writes to the database directly. Every calculation — rent, pro-rata, food,
electricity, notice shortfall, settlement — happens on the server, which also
enforces permissions.

The app receives the signed-in user's permission list so it can hide what they
cannot do, but that is a courtesy. `PermissionsGuard` re-reads permissions from
the database on **every request**, so revoking access takes effect immediately
rather than when a token happens to expire.

---

## 2. Nothing business-related is hardcoded

`AppSetting` holds every tunable value. `SettingsService` reads from the
database and **throws if a key is missing**; the defaults in
`setting-keys.ts` are used once, to seed a fresh install.

That distinction matters. A fallback like `?? 150` in code would quietly become
business policy the day someone deleted a row. Failing loudly means a missing
configuration is fixed in Settings, where it is visible, instead of hiding in a
source file.

Every write records old value, new value, who changed it, when, and why, in
`AppSettingHistory`. `getValueAt(key, date)` can reconstruct the value that was
in force on any past date.

---

## 3. Financial history is immutable

This is the rule the data model is built around.

| Mechanism | Where |
|---|---|
| Snapshot the rate onto the record | `EbCycle.ratePerUnit`, `Invoice.totalAmount`, `InvoiceLine.calcSnapshot` |
| Effective-date the inputs | `PricingRule`, `FoodPeriod`, `BedAssignment` |
| Append, never overwrite | `DepositEntry`, `AuditLog`, `PaymentAllocation` |
| Reverse, never delete | `Payment.reversalOfId`, `Invoice.cancelledAt` |

Changing the E.B. rate today cannot alter last month's cycle, because that
cycle carries its own rate. Switching a tenant's food off in October cannot
change September's bill, because September's bill was computed from the food
period that covered September.

A manual financial adjustment always requires an **amount, a reason and a
user**, and lands in the audit log. There is no code path that silently edits a
historical amount.

---

## 4. Money

All money is `Decimal(12,2)` in PostgreSQL and `decimal.js` in TypeScript.
JavaScript numbers are never used for money arithmetic — `0.1 + 0.2` problems
become rupee discrepancies that someone has to explain to a tenant.

When an amount is divided (an E.B. bill across four tenants, a month's rent
across days), `allocateByWeight` uses the largest-remainder method so the parts
**always add back to the total exactly**. No paisa is invented or lost.

---

## 5. Tenants, stays and beds

```
Tenant  (identity, permanent)
  └── Stay  (one residence period)
        ├── BedAssignment[]   room history, effective-dated
        ├── FoodPeriod[]      food history, effective-dated
        ├── PricingRule[]     tenant-specific rent, effective-dated
        ├── Invoice[] / Payment[] / DepositEntry[]
        └── VacateNotice + Settlement
```

A tenant who leaves in September and returns in December has **two stays**. The
first is never destroyed, and its bills, payments and room history stay
attached to it.

Occupancy is bed-level. A room is never "occupied" or "free" — availability is
`active beds − assignments overlapping the date`. That is what makes a
3-sharing room with one free bed representable at all.

### Preventing double booking

Assignment writes run inside a `Serializable` transaction and check for any
overlapping assignment on the target bed. A weaker isolation level would let
two simultaneous assignments both pass their checks and both commit.

Room switches and swaps close the outgoing assignments *before* opening the new
ones, inside the same transaction, so neither bed ever looks occupied twice.

---

## 6. Pricing resolution

Rules are matched by scope and date, then the most specific wins:

```
STAY  >  ROOM  >  SHARING  >  BRANCH  >  GLOBAL
```

Among rules of equal specificity, the most recently effective one wins.

Prices are stored **inclusive of food**, so there is a single number per room
type to maintain. A tenant without food pays that number minus the configured
food difference.

On a bill the two are shown separately — `RENT` and `FOOD` — because that is
what the bill and the final settlement need to display. They always sum back to
the configured price. (This was a real bug during development: adding the food
difference *on top of* the food-inclusive price charged it twice. The invariant
is now covered by `billing.service.spec.ts`.)

Creating a new rule closes the previous one the day before it starts rather
than editing it, so a bill from before the change can still be explained.

---

## 7. Billing

`computeCharges(stayId, from, to)` cuts the period at every date where
something price-relevant changed — a room move, a food switch, a new rate — and
prices each segment with the values in force on **its own dates**.

Each line stores a `calcSnapshot`: the rate, the day count, the divisor and the
rule id that produced it. An old bill can always be explained without
re-running today's code.

Part months pro-rate by default (`billing.proration_method`), dividing by the
real length of that month (`billing.proration_basis`). Both are configurable.

Daily stays are billed per day and can never carry food — enforced in the
service, not just hidden in the UI.

---

## 8. The E.B. algorithm

This is the one piece of business logic the specification fixes in code, in
`eb.algorithm.ts`. Its inputs — the rate, the split method, the plausibility
limit — still come from configuration; only the procedure is fixed:

1. **Units** = closing reading − opening reading. If the closing reading is
   flagged as a meter reset, the meter was replaced and started from zero, so
   that reading *is* the consumption.
2. A reading that **goes backwards** without a reset flag is rejected. It is a
   data-entry mistake, and billing a wrapped or negative value silently is
   worse than refusing.
3. **Amount** = units × rate, rounded to two decimals.
4. **Split** between the tenants who occupied a bed in that room during the
   period — weighted by days occupied, or equally, per configuration.
5. Shares allocated by largest remainder, so they sum to the total exactly.

The function is **pure**: no database, no clock. Same inputs, same output.
That is what makes a historical cycle reproducible and the whole thing
testable, and why finalising a cycle snapshots the rate onto it.

When nobody occupied the room, the amount is reported as unattributed and stays
with the property rather than being forced onto someone.

---

## 9. Vacating and settlement

```
Notice  →  Final charges  →  Deposit adjustment  →  Refund or amount payable
```

The notice period in force **on the notice date** is copied onto the notice
record, so changing the setting later cannot retroactively make a past notice
short or long. Leaving early produces a notice-period charge for the remaining
days at the tenant's own daily rent.

Deductions are, in order: unpaid balances on issued bills, charges for days
since the last bill up to checkout, the notice shortfall, and any manual
adjustments. The deposit is applied against them; what is left is a pending
refund, and if deductions exceed the deposit the difference is shown as
payable by the tenant.

Vacating closes the bed assignment on the checkout date — so the bed is free
from the next day and the tenant drops out of future occupancy and E.B.
calculations — while every historical record stays exactly where it was.

---

## 10. Notifications

Home shows property structure only. Everything that needs attention —
pending payments, incomplete profiles, upcoming checkouts, expiring notices,
pending deposit refunds — lives behind the bell. Duplicating it on Home would
make the screen the owner opens most the busiest one.

Each condition has a stable `dedupeKey`, so a recurring situation updates one
row instead of producing a new alert every night, and conditions that no longer
hold are resolved automatically.

---

## 11. Incomplete profiles are allowed

A tenant arriving at the door should not wait on paperwork. Only a name is
required. Which fields count as required is configuration
(`tenant.required_fields` plus required document types), and anything missing
is flagged under the bell with a Complete Profile action — never a blocked save.

---

## 12. Cost

No paid service is required. PostgreSQL, NestJS, React, Capacitor, PDFKit,
ExcelJS and the rest are open source, and the backend runs on the owner's own
machine or LAN server. WhatsApp, SMS, OCR and cloud storage are deliberately
absent rather than stubbed — the architecture leaves room for them as optional
integrations later, but nothing depends on them.

---

## 13. Responsive layout

`useBreakpoint` resolves phone / tablet / wide from the available width at
runtime, so one APK adapts:

- **Phone** — bottom navigation, stacked cards, sheets slide up from the bottom.
- **Tablet and landscape** — a persistent side rail, multi-column grids, dialogs
  centred rather than bottom-anchored.

Touch targets are at least 44–48dp (`min-h-touch`), base type runs larger than
web defaults, and numbers are tabular so columns of money line up.

Frosted glass is used only where it belongs — the top bar, the drawer, dialogs
and the floating calculator. Cards stay solid; making everything glass turns a
screen to soup.
