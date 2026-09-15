# PG Management

An Android application for running PG / hostel properties: branches, floors,
rooms, beds, tenants, rent, food, electricity, payments, deposits,
settlements, expenses and reports.

One APK adapts to phones and tablets, portrait and landscape. Dark is the
primary theme, with a designed light theme alongside it.

```
Android APK  →  React + TypeScript (Capacitor)  →  HTTPS REST  →  NestJS  →  PostgreSQL
```

---

## Launch flow

```
APP OPEN  →  PROFILE SELECTION  →  APP PIN  →  HOME
```

There is no username/password screen anywhere in the app.

## What it does

| Area | Capability |
|---|---|
| **Property** | Branches → floors → rooms → beds, all configurable. Availability is derived from beds and assignments, never stored as a flag. |
| **Tenants** | Tenant identity and Stay periods are separate; a tenant may have many stays and old ones are never destroyed. Custom fields need no migration. |
| **Occupancy** | Bed-level assignment history. Room switch, cross-branch moves and tenant swaps run in one transaction. Double booking and over-capacity are refused. |
| **Pricing** | Global → branch → sharing → room → tenant, most specific wins, every rule effective-dated. |
| **Billing** | Monthly and daily stays, part-month pro-rata, mid-month food and room changes billed correctly, E.B. folded in. |
| **Access** | No login page. The app opens on a profile list and unlocks with an app-managed PIN (not device biometrics). Owner / Admin / Manager / Staff, with fully configurable permissions. |
| **Payments** | Collect-then-approve workflow, cash / UPI / split with an on-device UPI QR, backdating allowed and future dates refused, duplicate detection, allocation to specific bills, and reversals that keep the original record. |
| **Retention** | Export a former tenant's full record, then irreversibly erase their personal data while every financial and audit record survives. |
| **Deposits** | Append-only ledger with refund, adjustment and forfeit states. |
| **Vacating** | Notice with shortfall calculation, final settlement, refund or amount payable. |
| **E.B.** | Meter readings, per-cycle calculation, split between occupants by days occupied. |
| **Admin** | Expenses, reports, exports (PDF / Excel / CSV), notifications, users, roles, permissions and a full audit trail. |

---

## Running it

Nothing here needs a paid service. The whole stack runs on the owner's own
machine or a LAN server.

### 1. Database

With Docker:

```bash
cp .env.example .env
docker compose up -d postgres
```

Or use an existing PostgreSQL 14+ instance and point `DATABASE_URL` at it.

### 2. Backend

```bash
cd backend
cp .env.example .env          # set JWT secrets before exposing this anywhere
npm install
npx prisma migrate deploy     # or: npx prisma migrate dev
npm run db:seed               # initial branches, rooms, prices and settings
npm run start:dev
```

The API listens on `http://0.0.0.0:3000/api`. `GET /api/health` reports
database connectivity.

The seed creates four profiles — Owner, Admin, Manager and Staff. Only the
Owner is given a PIN, from `SEED_OWNER_PIN`; the others choose their own the
first time they tap their name. Set that variable before seeding, or change the
PIN from Settings straight afterwards.

### 3. App (development)

```bash
cd app
npm install
npm run dev                   # http://localhost:5173
```

### 4. Android APK

```bash
cd app
npm run build
npx cap add android           # first time only
npm run android:sync
npm run android:build         # android/app/build/outputs/apk/debug/
```

Requires Android Studio or a JDK 17 + Android SDK installation.

**Talking to a server on your LAN.** Android blocks plaintext HTTP by default.
For a self-hosted backend without TLS, allow your server's host explicitly —
see [`docs/ANDROID.md`](docs/ANDROID.md). The app's own server address is set
from the sign-in screen (the icon top right), so one APK works against any
deployment.

---

## Configuration, not code

Rents, the E.B. rate per unit, the common charge, the food difference and the
notice period are **rows in the database**, edited from Settings. The backend
reads them when it needs them and refuses to start a calculation if a key is
missing — it never falls back to a number written in code.

The values the specification gives are seed data for a fresh install:

| Setting | Initial value |
|---|---|
| Food difference (per month) | ₹2,000 |
| Common charge (per month) | ₹150 |
| E.B. rate per unit | ₹12.50 |
| E.B. split rule | Room capacity (one bed's share per tenant) |
| Notice period | 30 days |
| Payments need approval | On |

Changing any of them affects future calculations only. Bills, E.B. cycles and
settlements already recorded keep the values they were produced with, and every
change is written to the setting's history with who made it and why.

### Initial property data

Seeded from the specification, and all editable in the app afterwards:

- **Ekkatuthangal** — 9 rooms across two floors (31 beds), AC only.
  Ground: 6, 5, 3, 3, 1 sharing. First: 5, 4, 3, 1 sharing.
  Prices: 1→₹14,000 · 3→₹12,000 · 4→₹9,500 · 5→₹9,000 · 6→₹9,000.
- **Alandur** — three floors plus a terrace, with prices for 2/3/4/5 sharing in
  AC and non-AC, including the 2-sharing big room at ₹15,000. Rooms are entered
  in the app.

---

## Testing

```bash
cd backend
npm test                 # unit tests: E.B. algorithm, billing split, money, PINs
npm run test:integration # against a real PostgreSQL schema, dropped afterwards
npm run test:all         # both

npm run typecheck        # both workspaces, from the repo root
```

Integration tests create their own schema (`test_<pid>`) from
`schema.prisma`, so they never touch development data. Point them elsewhere
with `TEST_DATABASE_URL` if you prefer a separate database.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the rules the code enforces
  and why, including the E.B. algorithm and the money model.
- [`docs/ANDROID.md`](docs/ANDROID.md) — building the APK and connecting to a
  self-hosted server.
