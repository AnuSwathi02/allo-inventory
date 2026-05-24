// src/app/api/cron/expire-reservations/route.ts
//
// Vercel Cron — add this to vercel.json:
// {
//   "crons": [{ "path": "/api/cron/expire-reservations", "schedule": "* * * * *" }]
// }
//
// This endpoint runs every minute and releases all PENDING reservations
// whose expiresAt has passed. The same SQL runs lazily on GET /api/products
// so correctness doesn't depend on the cron; the cron just keeps the DB clean
// and reservedUnits accurate even if nobody is browsing.

import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredReservations } from "@/lib/reservation-service";

export async function GET(req: NextRequest) {
  // Protect cron endpoint — Vercel adds this header automatically,
  // but we verify it in case someone calls the URL manually.
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const released = await releaseExpiredReservations();
  return NextResponse.json({ released, timestamp: new Date().toISOString() });
}
