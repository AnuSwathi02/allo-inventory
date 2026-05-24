export const dynamic = 'force-dynamic';
// src/app/api/warehouses/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const warehouses = await prisma.warehouse.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(warehouses);
}
