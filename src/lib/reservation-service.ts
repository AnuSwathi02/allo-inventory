// src/lib/reservation-service.ts
//
// THE CORE CONCURRENCY GUARANTEE
// ================================
// We use a two-layer approach:
//
// Layer 1 — Distributed mutex via Redis (fast path)
//   Before touching the DB, we acquire a per-(product, warehouse) Redis lock
//   using SET NX PX (atomic). This serialises concurrent reservation attempts
//   for the same SKU at the same warehouse without hammering the DB.
//
// Layer 2 — Optimistic check-and-update inside a Postgres transaction (safe path)
//   Even with Redis, we never blindly trust the lock (Redis can fail, TTLs can
//   race). Inside the transaction we re-read stock with SELECT FOR UPDATE, which
//   places a row-level exclusive lock in Postgres. We re-validate availability
//   and update reservedUnits atomically. If another transaction sneaked through
//   the Redis gap, the row lock makes them wait and then see the updated count.
//
// This gives us correctness (Postgres guarantees) + performance (Redis keeps
// most traffic away from the DB row lock).

import { prisma } from "./prisma";
import { redis } from "./redis";
import { Prisma } from "@prisma/client";

const RESERVATION_TTL_MINUTES = 10;
const REDIS_LOCK_TTL_MS = 5_000; // 5 s — long enough for one DB round-trip

// ── Helpers ──────────────────────────────────────────────────────────────────

function lockKey(productId: string, warehouseId: string) {
  return `lock:reserve:${productId}:${warehouseId}`;
}

async function acquireLock(key: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, "PX", REDIS_LOCK_TTL_MS, "NX");
  return result === "OK" ? token : null;
}

async function releaseLock(key: string, token: string): Promise<void> {
  // Lua script: only delete if we still own the lock (prevents releasing
  // a lock that expired and was acquired by another request)
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, key, token);
}

// ── Expiry cleanup (lazy + background) ───────────────────────────────────────

export async function releaseExpiredReservations(): Promise<number> {
  // Called lazily on read requests AND by the cron job.
  // Uses a Postgres UPDATE that touches only PENDING rows past their expiresAt,
  // then adjusts the denormalized reservedUnits counter in StockLevel.
  //
  // We run this as a raw SQL CTE for atomicity: find expired rows, update their
  // status to RELEASED, and decrement StockLevel.reservedUnits in one statement.
  const result = await prisma.$executeRaw`
    WITH expired AS (
      UPDATE "Reservation"
      SET    "status" = 'RELEASED', "updatedAt" = NOW()
      WHERE  "status" = 'PENDING'
        AND  "expiresAt" < NOW()
      RETURNING "productId", "warehouseId", "quantity"
    )
    UPDATE "StockLevel" sl
    SET    "reservedUnits" = sl."reservedUnits" - e.qty,
           "updatedAt"     = NOW()
    FROM (
      SELECT "productId", "warehouseId", SUM("quantity") AS qty
      FROM   expired
      GROUP  BY "productId", "warehouseId"
    ) AS e
    WHERE  sl."productId"   = e."productId"
      AND  sl."warehouseId" = e."warehouseId"
  `;
  return result;
}

// ── Create reservation ────────────────────────────────────────────────────────

export type CreateReservationResult =
  | { ok: true; reservation: Awaited<ReturnType<typeof findReservation>> }
  | { ok: false; reason: "insufficient_stock" | "lock_timeout" | "not_found" };

export async function createReservation(
  productId: string,
  warehouseId: string,
  quantity: number,
  idempotencyKey?: string
): Promise<CreateReservationResult> {
  // ── Idempotency check ──────────────────────────────────────────────────────
  if (idempotencyKey) {
    const existing = await prisma.reservation.findUnique({
      where: { idempotencyKey },
      include: { product: true, warehouse: true },
    });
    if (existing) {
      return { ok: true, reservation: existing };
    }
  }

  // ── Lazy expiry release ────────────────────────────────────────────────────
  await releaseExpiredReservations();

  // ── Redis distributed lock ─────────────────────────────────────────────────
  const key = lockKey(productId, warehouseId);
  const token = await acquireLock(key);
  if (!token) {
    // Another request holds the lock. Return 409 — client can retry.
    return { ok: false, reason: "lock_timeout" };
  }

  try {
    // ── Postgres transaction with row-level lock ────────────────────────────
    const expiresAt = new Date(
      Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000
    );

    const reservation = await prisma.$transaction(async (tx) => {
      // SELECT FOR UPDATE locks this row; concurrent transactions must wait.
      const [stock] = await tx.$queryRaw<
        Array<{ id: string; totalUnits: number; reservedUnits: number }>
      >`
        SELECT id, "totalUnits", "reservedUnits"
        FROM   "StockLevel"
        WHERE  "productId"   = ${productId}
          AND  "warehouseId" = ${warehouseId}
        FOR UPDATE
      `;

      if (!stock) {
        throw new Error("NOT_FOUND");
      }

      const available = stock.totalUnits - stock.reservedUnits;
      if (available < quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // Atomically increment reserved count
      await tx.stockLevel.update({
        where: { id: stock.id },
        data: { reservedUnits: { increment: quantity } },
      });

      // Create reservation record
      return tx.reservation.create({
        data: {
          productId,
          warehouseId,
          quantity,
          expiresAt,
          status: "PENDING",
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        include: { product: true, warehouse: true },
      });
    }, { timeout: 4_000 }); // fail fast if DB is slow — don't hold Redis lock

    return { ok: true, reservation };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "INSUFFICIENT_STOCK") {
      return { ok: false, reason: "insufficient_stock" };
    }
    if (msg === "NOT_FOUND") {
      return { ok: false, reason: "not_found" };
    }
    throw err; // unexpected — let the API layer return 500
  } finally {
    await releaseLock(key, token);
  }
}

// ── Confirm reservation ───────────────────────────────────────────────────────

export async function confirmReservation(reservationId: string): Promise<
  | { ok: true; reservation: Awaited<ReturnType<typeof findReservation>> }
  | { ok: false; reason: "not_found" | "expired" | "already_settled" }
> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });

  if (!reservation) return { ok: false, reason: "not_found" };
  if (reservation.status === "CONFIRMED")
    return { ok: false, reason: "already_settled" };
  if (reservation.status === "RELEASED")
    return { ok: false, reason: "expired" };
  if (reservation.expiresAt < new Date()) {
    // Lazy expire this one
    await prisma.$transaction([
      prisma.reservation.update({
        where: { id: reservationId },
        data: { status: "RELEASED" },
      }),
      prisma.stockLevel.updateMany({
        where: {
          productId: reservation.productId,
          warehouseId: reservation.warehouseId,
        },
        data: { reservedUnits: { decrement: reservation.quantity } },
      }),
    ]);
    return { ok: false, reason: "expired" };
  }

  // Confirm: decrement reservedUnits AND totalUnits (permanent sale)
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CONFIRMED" },
      include: { product: true, warehouse: true },
    });

    await tx.stockLevel.updateMany({
      where: {
        productId: reservation.productId,
        warehouseId: reservation.warehouseId,
      },
      data: {
        totalUnits: { decrement: reservation.quantity },
        reservedUnits: { decrement: reservation.quantity },
      },
    });

    return updated;
  });

  return { ok: true, reservation: updated };
}

// ── Release reservation ───────────────────────────────────────────────────────

export async function releaseReservation(reservationId: string): Promise<
  | { ok: true; reservation: Awaited<ReturnType<typeof findReservation>> }
  | { ok: false; reason: "not_found" | "already_settled" }
> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });

  if (!reservation) return { ok: false, reason: "not_found" };
  if (reservation.status !== "PENDING")
    return { ok: false, reason: "already_settled" };

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "RELEASED" },
      include: { product: true, warehouse: true },
    });

    await tx.stockLevel.updateMany({
      where: {
        productId: reservation.productId,
        warehouseId: reservation.warehouseId,
      },
      data: { reservedUnits: { decrement: reservation.quantity } },
    });

    return updated;
  });

  return { ok: true, reservation: updated };
}

// ── Find reservation (shared helper for response shaping) ─────────────────────

async function findReservation(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    include: { product: true, warehouse: true },
  });
}
