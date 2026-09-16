# Security

What this application protects, how, and what an operator has to do for any of
it to hold. Everything here runs on hardware the property owner controls —
there is no cloud service to lean on and nothing to pay for.

---

## 1. Aadhaar is encrypted at rest

A tenant's Aadhaar number is the one piece of data in this system that is
valuable to someone else. It is never written to PostgreSQL in readable form.

### What is stored

The `Tenant` table holds three columns instead of a number:

| Column | Contents | Why |
|---|---|---|
| `aadhaarCiphertext` | `v1.<iv>.<tag>.<ciphertext>`, base64 parts | The number itself, AES-256-GCM |
| `aadhaarIndex` | HMAC-SHA256 of the digits | Exact-match search without storing anything readable |
| `aadhaarLast4` | four digits | So `•••• •••• 4321` can be shown without decrypting |

Four digits on their own identify nobody, which is why the masked form costs
no decryption and no key access.

### The scheme

- **AES-256-GCM**, a fresh 96-bit IV for every value, authentication tag stored
  alongside. GCM is authenticated: a tampered ciphertext fails to decrypt
  rather than returning plausible rubbish.
- The same number encrypted twice produces **different ciphertext**, because
  the IV is fresh each time.
- The `v1.` prefix is the **rotation seam** (see below).
- The blind index is keyed with a *separate* key derived from the configured
  secret — `HMAC-SHA256(secret, "aadhaar-blind-index")` — so the index key is
  never the encryption key itself.

Implementation: [`backend/src/common/crypto/field-encryption.ts`](../backend/src/common/crypto/field-encryption.ts).

### Required environment variable

```
AADHAAR_ENCRYPTION_KEY
```

A 32-byte key, supplied as base64 or as 64 hex characters. Generate one:

```bash
openssl rand -base64 32     # e.g. 8Jm1s...=   (44 chars)
openssl rand -hex 32        # e.g. 4f9c...     (64 chars)
```

Set it in `backend/.env`, or in the environment of the container. It is never
compiled in, never defaulted, and never committed. `docker-compose.yml`
refuses to start the stack if it is absent rather than falling back to a value
published in this repository.

> **Losing this key means losing every stored Aadhaar number.** There is no
> recovery path — that is what "encrypted at rest" means. Back it up the way
> you would back up a door key, separately from the database dump. A backup
> and the key stored together protects against nothing.

### Who can read the real number

Decryption happens only when a caller holds the `tenant.view_sensitive`
permission. Everyone else — including every code path that does not explicitly
ask — gets the masked form. There is exactly one call site in the codebase that
decrypts, and it is reached only through that check.

- `GET /api/tenants/:id` returns `aadhaarNumber` **masked** for Staff and
  Manager, **full** for Owner and Admin.
- The ciphertext, the blind index and the last-four column are stripped from
  every API response. They exist only inside the server.
- Decrypted values are **never logged**. The encryption service logs
  configuration problems only, never a value or a ciphertext.
- The audit trail records *that* a tenant record changed, never the number.
- The number appears in exactly one export — the archive taken before a
  tenant's data is erased, which has to be readable to be useful — and that
  route requires `tenant.view_sensitive` as well as `export.run`. The tenant
  list export and the A4 information sheet do not carry it at all.

Search still works for those who can use it: type a full Aadhaar number and
the blind index finds it; type the last four digits and `aadhaarLast4` finds
it. Neither path decrypts anything.

### Key rotation

The stored format carries its version, so rotation does not need a flag day:

1. Add the new key as `v2` alongside `v1` in
   `field-encryption.ts` (`CURRENT_VERSION` and the key lookup).
2. New writes are tagged `v2`; existing `v1` values keep decrypting.
3. Re-save tenant records at leisure — each save re-encrypts under the current
   version. The blind index is rewritten at the same time.
4. Retire `v1` once nothing reports it.

Rotating the key also rotates the blind index key, so step 3 is not optional if
search is to keep finding old records by full number. Search by last four is
unaffected.

### If the key is unavailable

The service **fails closed**. It does not fall back to plaintext and it does
not invent a key.

| Situation | Behaviour |
|---|---|
| Variable not set | Warning at boot. Reading or writing an Aadhaar number raises `503 Service Unavailable`. |
| Variable malformed (wrong length, not base64/hex) | Error at boot, same behaviour. |
| Key set but wrong (rotated without migrating) | Decryption of old values fails; the API degrades to the masked form rather than erroring the whole tenant. |
| Key correct | Normal operation. |

The rest of the application keeps working throughout: rent is still collected,
bills are still raised, reports still run. A configuration mistake must not
stop a property from operating — it must only stop sensitive data being
mishandled.

### Erasure

`POST /api/retention/tenants/:id/erase` nulls all three columns together: the
ciphertext, the index that could confirm a guess, and the last four digits.
Financial and audit records survive untouched. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the export-then-erase workflow.

---

## 2. Access: profiles and PINs

There is no username/password screen anywhere in the app. The launch flow is:

```
APP OPEN  →  PROFILE SELECTION  →  APP PIN  →  HOME
```

The PIN is **application-managed**. It is not Android biometrics, not the
device fingerprint sensor, and not any Google identity service.

| Control | Implementation |
|---|---|
| Storage | bcrypt, cost 10. The plaintext PIN is never stored and never logged. |
| Strength | 4–8 digits; one repeated digit (`1111`) and running sequences (`1234`, `4321`) are refused — [`common/utils/pin.ts`](../backend/src/common/utils/pin.ts) |
| Rate limiting | 5 wrong attempts locks that profile for 5 minutes. The counter is per profile and lives in the database, so restarting the app does not reset it. |
| Wrong PIN | Shows the error and the remaining attempts **on the PIN screen**. It does not bounce back to profile selection. |
| Profile list | Returns name, role, avatar and lock state. It never returns a PIN hash. |
| Sessions | Short-lived JWT access token plus a rotating refresh token. Refresh tokens are stored **hashed**, so a database leak grants no sessions. |

`SEED_OWNER_PIN` sets the Owner's initial PIN at seed time and is the only
credential the setup process takes. It is validated against the same rules as
any other PIN — the seed refuses `1234`. Leave it blank and the seed generates
a six-digit PIN from the OS random source and prints it once; there is no
default PIN written into the code, because a default would be the Owner PIN of
every installation that never changed it. The other three profiles start with
no PIN and choose one the first time they are tapped.

> On a shared LAN, set the Owner PIN before seeding and have each person set
> theirs at first use, so an unclaimed profile is not left available to whoever
> reaches it first.

---

## 3. Authorisation is enforced on the server

The UI hides what a role cannot do. That is convenience, not security — every
restriction is enforced again in the API, so calling the endpoint directly
achieves nothing.

- `PermissionsGuard` runs on every guarded route and re-reads the caller's
  permissions **from the database on each request**. Revoking a permission
  takes effect immediately, not at next sign-in.
- Permissions are declared per route with `@RequirePermissions(...)`.
- The Owner bypasses the permission table by design; every other role,
  including Admin, is checked.
- Anything not explicitly permitted is refused: `403`, with no hint about
  whether the record exists.

Public by design (and only these): the health check, the profile list, PIN
unlock, first-time PIN set, and token refresh.

---

## 4. Secrets

No secret has a working default anywhere in this repository.

| Secret | Where it comes from |
|---|---|
| `DATABASE_URL` / `POSTGRES_PASSWORD` | `.env`, no default — `docker compose up` fails without it |
| `JWT_SECRET` | `.env`, no default |
| `AADHAAR_ENCRYPTION_KEY` | `.env`, no default |
| `SEED_OWNER_PIN` | `.env`, seed-time only |

`.env` is git-ignored; `.env.example` carries empty values and the command to
generate each one. If you have ever run this stack with a placeholder secret,
regenerate `JWT_SECRET` (which invalidates existing sessions) and change the
database password.

---

## 5. Transport

The backend speaks plain HTTP by default because the intended deployment is a
machine on the property's own LAN, where there is no certificate authority to
issue a certificate for `192.168.1.20`.

That is a deliberate trade-off with a bounded blast radius:

- The Android app permits cleartext **only to the hosts listed** in
  `res/xml/network_security_config.xml`. Everything else keeps Android's
  HTTPS-only default. `android:usesCleartextTraffic="true"`, which would
  disable the protection globally, is not used.
- The server should not be exposed to the internet. If it must be, put it
  behind a reverse proxy with TLS and remove the cleartext exception — nothing
  in the app needs to change beyond the server address.
- CORS is restricted to the Capacitor origins and whatever `CORS_ORIGINS` adds.

See [`ANDROID.md`](ANDROID.md) for the network topology.

---

## 6. Data safety

Financial history does not change when configuration changes. Rates, food
difference, common charge and notice period are effective-dated rows; every
invoice line stores the snapshot it was calculated from; deposit entries and
audit records are append-only; reversals write a new record rather than editing
the old one. Tenant data is never hard-deleted without an explicit
export-then-erase workflow. The reasoning is in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 7. What is not covered

Stated plainly, so nobody assumes otherwise:

- **No TLS by default.** Anyone with access to the LAN segment can read traffic
  between the app and the server. Treat the LAN as trusted, or add a proxy.
- **Encryption protects the database, not a running server.** Someone with
  shell access to the machine has the key in the process environment.
- **Documents and photos are stored as files, not encrypted.** Only the Aadhaar
  number is encrypted at rest.
- **No 2FA.** A PIN on a shared device is the security model. It is appropriate
  for a handful of staff in one building and nothing more.
- **Backups are the operator's job**, including keeping the encryption key
  somewhere other than beside the dump.

---

## Reporting

This is a self-hosted application with no vendor. If you find a problem, fix it
in your own deployment first, then open an issue.
