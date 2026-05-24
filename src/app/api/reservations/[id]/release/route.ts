// src/app/api/reservations/[id]/release/route.ts
import { NextRequest, NextResponse } from "next/server";
import { releaseReservation } from "@/lib/reservation-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await releaseReservation(params.id);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json(
        { error: "Reservation not found" },
        { status: 404 }
      );
    }
    if (result.reason === "already_settled") {
      return NextResponse.json(
        { error: "Reservation is already confirmed or released" },
        { status: 409 }
      );
    }
  }

if (!('reservation' in result)) return NextResponse.json({ error: 'Failed' }, { status: 500 });
const r = result.reservation!;
  return NextResponse.json({
    id: r.id,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
  });
}
