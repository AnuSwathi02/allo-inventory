"use client";
// src/app/checkout/[id]/page.tsx — Reservation checkout page

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ReservationDTO } from "@/lib/schemas";

function formatINR(amount: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    function tick() {
      const diff = Math.max(
        0,
        Math.floor((new Date(expiresAt!).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diff);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return secondsLeft;
}

function CountdownRing({ secondsLeft }: { secondsLeft: number | null }) {
  const total = 600; // 10 minutes
  const pct =
    secondsLeft === null ? 1 : Math.max(0, secondsLeft) / total;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  const mins = secondsLeft === null ? "--" : Math.floor(secondsLeft / 60);
  const secs =
    secondsLeft === null
      ? "--"
      : String(secondsLeft % 60).padStart(2, "0");

  const color =
    secondsLeft === null
      ? "#6366f1"
      : secondsLeft < 60
      ? "#ef4444"
      : secondsLeft < 180
      ? "#f59e0b"
      : "#6366f1";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="128" height="128" className="-rotate-90">
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
        />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.5s, stroke 0.5s" }}
        />
      </svg>
      <div className="text-center -mt-20 mb-12 pointer-events-none">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {mins}:{secs}
        </span>
        <p className="text-xs text-gray-500 mt-0.5">remaining</p>
      </div>
    </div>
  );
}

// ── Status display ────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: {
      label: "Pending",
      cls: "bg-amber-100 text-amber-700 border-amber-200",
    },
    CONFIRMED: {
      label: "✓ Confirmed",
      cls: "bg-green-100 text-green-700 border-green-200",
    },
    RELEASED: {
      label: "Released",
      cls: "bg-gray-100 text-gray-600 border-gray-200",
    },
    EXPIRED: {
      label: "Expired",
      cls: "bg-red-100 text-red-700 border-red-200",
    },
  };
  const { label, cls } = map[status] ?? map.PENDING;
  return (
    <span
      className={`px-3 py-1 text-sm font-semibold rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CheckoutPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [reservation, setReservation] = useState<ReservationDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const secondsLeft = useCountdown(
    reservation?.status === "PENDING" ? reservation.expiresAt ?? null : null
  );

  // Auto-expire in UI when timer hits 0
  useEffect(() => {
    if (secondsLeft === 0 && reservation?.status === "PENDING") {
      setReservation((r) => r ? { ...r, status: "RELEASED" } : r);
    }
  }, [secondsLeft, reservation?.status]);

  // Load reservation details
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/reservations/${params.id}`);
        if (!res.ok) throw new Error("Reservation not found");
        const data = await res.json();
        setReservation(data);
      } catch {
        setError("Could not load reservation");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  const handleConfirm = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${params.id}/confirm`, {
        method: "POST",
      });
      if (res.status === 410) {
        setReservation((r) => r ? { ...r, status: "RELEASED" } : r);
        setError(
          "⏰ Your reservation expired before we could confirm it. The hold has been released."
        );
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not confirm reservation");
        return;
      }
      setReservation((r) => r ? { ...r, status: "CONFIRMED" } : r);
      showToast("🎉 Purchase confirmed! Thank you.");
    } catch {
      setError("Network error — please try again");
    } finally {
      setActionLoading(false);
    }
  }, [params.id]);

  const handleCancel = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${params.id}/release`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not cancel reservation");
        return;
      }
      setReservation((r) => r ? { ...r, status: "RELEASED" } : r);
      showToast("Reservation cancelled. Stock released.");
    } catch {
      setError("Network error — please try again");
    } finally {
      setActionLoading(false);
    }
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!reservation && error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="text-indigo-600 underline text-sm"
          >
            Back to products
          </button>
        </div>
      </div>
    );
  }

  const isPending = reservation?.status === "PENDING";
  const isConfirmed = reservation?.status === "CONFIRMED";

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in">
          {toastMsg}
        </div>
      )}

      <header className="bg-white border-b border-gray-200">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            ← Back
          </button>
          <h1 className="font-bold text-gray-900">Checkout</h1>
          {reservation && <StatusPill status={reservation.status} />}
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        {/* Timer — only while pending */}
        {isPending && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center">
            <p className="text-sm text-gray-500 mb-3 text-center">
              Your items are reserved. Complete your purchase before the timer runs out.
            </p>
            <CountdownRing secondsLeft={secondsLeft} />
          </div>
        )}

        {/* Reservation details */}
        {reservation && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Order Summary</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Product</span>
                <span className="font-medium text-right max-w-[60%]">
                  {reservation.product?.name ?? reservation.productId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">SKU</span>
                <span className="font-mono">
                  {reservation.product?.sku ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Warehouse</span>
                <span>{reservation.warehouse?.name ?? reservation.warehouseId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Quantity</span>
                <span>{reservation.quantity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Unit price</span>
                <span>
                  {reservation.product?.price
                    ? formatINR(reservation.product.price)
                    : "—"}
                </span>
              </div>
              {reservation.product?.price && (
                <div className="flex justify-between font-semibold text-base border-t border-gray-100 pt-3">
                  <span>Total</span>
                  <span className="text-indigo-700">
                    {formatINR(
                      (
                        Number(reservation.product.price) * reservation.quantity
                      ).toString()
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reservation ID + expiry */}
        {reservation && (
          <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1 font-mono">
            <div>ID: {reservation.id}</div>
            <div>
              Reserved: {new Date(reservation.createdAt).toLocaleString()}
            </div>
            {isPending && (
              <div>Expires: {new Date(reservation.expiresAt).toLocaleString()}</div>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        {isPending && (
          <div className="space-y-3">
            <button
              onClick={handleConfirm}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-xl bg-indigo-600 text-white font-bold text-base hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {actionLoading ? "Processing…" : "✓ Confirm Purchase"}
            </button>
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="w-full py-3 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              Cancel & Release
            </button>
          </div>
        )}

        {isConfirmed && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center space-y-3">
            <div className="text-4xl">🎉</div>
            <h3 className="font-bold text-green-800 text-lg">Order Confirmed!</h3>
            <p className="text-green-700 text-sm">
              Your purchase is confirmed and stock has been permanently decremented.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-2 text-sm text-indigo-600 underline"
            >
              Continue shopping
            </button>
          </div>
        )}

        {!isPending && !isConfirmed && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center space-y-3">
            <div className="text-3xl">⏰</div>
            <h3 className="font-semibold text-gray-700">Reservation Released</h3>
            <p className="text-gray-500 text-sm">
              The hold has been released and the items are available again.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-2 text-sm text-indigo-600 underline"
            >
              Back to products
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
