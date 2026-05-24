// src/app/api/reservations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { CreateReservationSchema } from "@/lib/schemas";
import { createReservation } from "@/lib/reservation-service";

export async function POST(req: NextRequest) {
  // ── Parse + validate ─────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // ── Idempotency-Key header (bonus) ───────────────────────────────────────
  const idempotencyKey = req.headers.get("Idempotency-Key") ?? undefined;

  const { productId, warehouseId, quantity } = parsed.data;

  const result = await createReservation(
    productId,
    warehouseId,
    quantity,
    idempotencyKey
  );

  if (!result.ok) {
    if (result.reason === "insufficient_stock") {
      return NextResponse.json(
        { error: "Not enough stock available for this product/warehouse" },
        { status: 409 }
      );
    }
    if (result.reason === "lock_timeout") {
      return NextResponse.json(
        { error: "Service is busy, please retry in a moment" },
        { status: 409 }
      );
    }
    if (result.reason === "not_found") {
      return NextResponse.json(
        { error: "Product or warehouse not found" },
        { status: 404 }
      );
    }
  }

  if (!('reservation' in result)) return NextResponse.json({ error: 'Failed' }, { status: 500 });
  const r = result.reservation!;
  return NextResponse.json(
    {
      id: r.id,
      productId: r.productId,
      warehouseId: r.warehouseId,
      quantity: r.quantity,
      status: r.status,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      product: r.product
        ? { name: r.product.name, sku: r.product.sku, price: r.product.price.toString() }
        : undefined,
      warehouse: r.warehouse
        ? { name: r.warehouse.name, location: r.warehouse.location }
        : undefined,
    },
    { status: 201 }
  );
}
