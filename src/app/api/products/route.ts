export const dynamic = 'force-dynamic';
// src/app/api/products/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/reservation-service";

export async function GET() {
  // Lazy expiry cleanup on reads so available stock is always accurate
  await releaseExpiredReservations();

  const products = await prisma.product.findMany({
    include: {
      stockLevels: {
        include: { warehouse: true },
        orderBy: { warehouse: { name: "asc" } },
      },
    },
    orderBy: { name: "asc" },
  });

  const response = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    price: p.price.toString(),
    stockLevels: p.stockLevels.map((sl) => ({
      warehouseId: sl.warehouseId,
      warehouseName: sl.warehouse.name,
      location: sl.warehouse.location,
      totalUnits: sl.totalUnits,
      reservedUnits: sl.reservedUnits,
      availableUnits: sl.totalUnits - sl.reservedUnits,
    })),
  }));

  return NextResponse.json(response);
}
