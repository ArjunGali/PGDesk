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

## What it does

| Area | Capability |
|---|---|
| **Property** | Branches → floors → rooms → beds, all configurable. Availability is derived from beds and assignments, never stored as a flag. |
| **Tenants** | Tenant identity and Stay periods are separate; a tenant may have many stays and old ones are never destroyed. Custom fields need no migration. |
| **Occupancy** | Bed-level assignment history. Room switch, cross-branch moves and tenant swaps run in one transaction. Double booking and over-capacity are refused. |
| **Pricing** | Global → branch → sharing → room → tenant, most specific wins, every rule effective-dated. |
| **Billing** | Monthly and daily stays, part-month pro-rata, mid-month food and room changes billed correctly, E.B. folded in. |
| **Payments** | Receipts, allocation to specific bills, advances, and reversals that keep the original record. |
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

The seed creates an owner account. Set `SEED_OWNER_USERNAME` and
`SEED_OWNER_PASSWORD` before running it, or change the password immediately
after the first sign-in.

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
| Notice period | 30 days |

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
cd backend && npm test        # E.B. algorithm + billing invariants
npm run typecheck             # both workspaces, from the repo root
```

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the rules the code enforces
  and why, including the E.B. algorithm and the money model.
- [`docs/ANDROID.md`](docs/ANDROID.md) — building the APK and connecting to a
  self-hosted server.
