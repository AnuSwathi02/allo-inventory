# Allo Inventory — Take-Home Exercise

A Next.js inventory and reservation platform for multi-warehouse retail. Customers can browse products, reserve units at a specific warehouse for 10 minutes, and confirm or cancel their reservation.

## Live Demo

> **URL:** `https://allo-inventory.vercel.app` *(replace with your deployed URL)*

Seed data includes 5 products across 3 warehouses with varying stock levels, including scarce (1 unit) and out-of-stock items to make the race-condition behaviour easy to demonstrate.

---

## Running Locally

### 1. Prerequisites

- Node.js 20+
- A hosted Postgres instance (Supabase / Neon / Railway all have free tiers)
- A Redis instance (Upstash free tier works)

### 2. Clone & install

```bash
git clone https://github.com/your-username/allo-inventory.git
cd allo-inventory
npm install
```

### 3. Environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → Connection string (URI mode) |
| `REDIS_URL` | Upstash → Database → REST URL (use the `redis://` endpoint, not REST) |
| `CRON_SECRET` | `openssl rand -hex 32` |

### 4. Run migrations and seed

```bash
npx prisma migrate dev --name init   # creates schema
npm run db:seed                       # inserts demo data
```

### 5. Start dev server

```bash
npm run dev
# → http://localhost:3000
```

---

## Architecture

### Data model

```
Product (id, name, sku, price)
    │
    └── StockLevel (productId, warehouseId, totalUnits, reservedUnits)
                                                  │
                                           Warehouse (id, name, location)

Reservation (id, productId, warehouseId, quantity, status, expiresAt)
    status: PENDING | CONFIRMED | RELEASED
```

`availableUnits = totalUnits − reservedUnits` (derived on read, stored for fast queries)

### Concurrency guarantee

The reservation endpoint must be correct when two simultaneous requests compete for the last unit. We use two layers:

**Layer 1 — Redis distributed lock (fast path)**

Before touching the database, we acquire a per-`(productId, warehouseId)` Redis lock via `SET NX PX` (atomic). This serialises concurrent requests for the same SKU at the same warehouse without hammering the database row lock. Lock TTL is 5 s — long enough for one Postgres round-trip. If the lock is taken, we return 409 immediately.

**Layer 2 — `SELECT FOR UPDATE` inside a Postgres transaction (safe path)**

We never trust the Redis lock alone (it can expire, fail, or be bypassed). Inside the transaction we re-read the `StockLevel` row with `SELECT FOR UPDATE`, which places an exclusive row-level lock in Postgres. Any concurrent transaction that passed the Redis check must wait here and then re-validate availability against the updated `reservedUnits`. This guarantees exactly-once semantics at the database level.

```
Request A ──► acquires Redis lock ──► SELECT FOR UPDATE ──► increment reservedUnits ──► COMMIT ──► release Redis lock
Request B ──► waits for Redis lock ──► (lock released) ──► SELECT FOR UPDATE ──► see updated reservedUnits ──► 409
```

### Reservation expiry

Two complementary mechanisms keep expired reservations cleaned up:

**1. Vercel Cron (primary)**

`vercel.json` schedules `/api/cron/expire-reservations` every minute. The handler runs a single atomic SQL `UPDATE … WHERE status = 'PENDING' AND expiresAt < NOW()` that sets `status = 'RELEASED'` and decrements `StockLevel.reservedUnits` in one CTE. No stale data persists longer than ~1 minute.

**2. Lazy cleanup on read (fallback)**

`GET /api/products` and `POST /api/reservations` call `releaseExpiredReservations()` before querying. This means correctness does not depend on the cron running — even if the cron is disabled, stock becomes accurate on the next read.

**Why not a background worker?**

Vercel's serverless model doesn't support long-running processes. The cron + lazy cleanup combination gives equivalent behaviour within the platform's constraints. On a VPS/ECS setup I'd prefer a dedicated worker (e.g. BullMQ) that processes a priority queue and avoids the 1-minute latency.

### Idempotency (bonus)

The `POST /api/reservations` and `POST /api/reservations/:id/confirm` endpoints support an `Idempotency-Key` header. On first receipt we store the key on the `Reservation` row itself (`idempotencyKey` unique column). On retry, we find the existing reservation by key and return it unchanged — no double-decrement, no duplicate reservation.

The frontend generates a `crypto.randomUUID()` per modal open and sends it on every attempt, so retries after a network drop are safe.

---

## Trade-offs & What I'd Do Differently

### What I cut for time

- **No authentication** — reservations aren't tied to a user session. In production you'd require a user ID and prevent one user from confirming another's reservation.
- **No email/webhook notification** when a reservation expires.
- **No pagination** on `GET /api/products` — fine for demo scale, would add cursor-based pagination in production.
- **Cron secret is a shared secret** — a Vercel OIDC token would be more secure.

### If I had more time

- **Optimistic UI updates** — after confirming, immediately re-fetch product list so stock counts are fresh.
- **WebSocket or SSE** — push expiry events to the checkout page so the user sees the timer expire in real-time even if they're on a different device.
- **Reservation queue** — for very high concurrency (flash sales), a Redis-based queue would distribute load better than per-row locking.
- **Better Redis fallback** — if Redis is unavailable, the current code returns 409 for all reservations. A circuit-breaker that falls back to Postgres-only locking would be more resilient.
- **Structured logging** — add request IDs and log reservation state transitions for ops observability.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/products` | List products with available stock per warehouse |
| GET | `/api/warehouses` | List warehouses |
| POST | `/api/reservations` | Reserve units. Returns 409 if insufficient stock. |
| GET | `/api/reservations/:id` | Get reservation details |
| POST | `/api/reservations/:id/confirm` | Confirm (payment succeeded). Returns 410 if expired. |
| POST | `/api/reservations/:id/release` | Release (cancelled or failed). |

### Reserve endpoint

```http
POST /api/reservations
Content-Type: application/json
Idempotency-Key: <uuid>   (optional, for retry safety)

{
  "productId": "clx...",
  "warehouseId": "clx...",
  "quantity": 1
}
```

**Responses:**
- `201` — reservation created with `expiresAt` 10 min from now
- `400` — validation error
- `404` — product or warehouse not found
- `409` — insufficient stock (or lock contention, safe to retry)
