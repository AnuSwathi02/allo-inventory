"use client";
// src/app/page.tsx — Product listing page

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductDTO } from "@/lib/schemas";

// ── Utility ──────────────────────────────────────────────────────────────────
function formatINR(amount: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

function totalAvailable(product: ProductDTO): number {
  return product.stockLevels.reduce((sum, sl) => sum + sl.availableUnits, 0);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StockBadge({ units }: { units: number }) {
  if (units === 0)
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        Out of stock
      </span>
    );
  if (units <= 3)
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
        Only {units} left
      </span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
      {units} available
    </span>
  );
}

function ReserveModal({
  product,
  onClose,
  onSuccess,
}: {
  product: ProductDTO;
  onClose: () => void;
  onSuccess: (reservationId: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(
    product.stockLevels.find((sl) => sl.availableUnits > 0)?.warehouseId ?? ""
  );
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWarehouse = product.stockLevels.find(
    (sl) => sl.warehouseId === warehouseId
  );
  const maxQty = selectedWarehouse?.availableUnits ?? 0;

  async function handleReserve() {
    setLoading(true);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID(); // bonus: idempotency
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ productId: product.id, warehouseId, quantity }),
      });
      if (res.status === 409) {
        const data = await res.json();
        setError(data.error ?? "Not enough stock — someone may have just bought it!");
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        return;
      }
      const data = await res.json();
      onSuccess(data.id);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{product.name}</h2>
          <p className="text-sm text-gray-500 font-mono">{product.sku}</p>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Select Warehouse
          </label>
          <div className="space-y-2">
            {product.stockLevels.map((sl) => (
              <label
                key={sl.warehouseId}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                  warehouseId === sl.warehouseId
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                } ${sl.availableUnits === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="radio"
                  name="warehouse"
                  value={sl.warehouseId}
                  checked={warehouseId === sl.warehouseId}
                  disabled={sl.availableUnits === 0}
                  onChange={() => {
                    setWarehouseId(sl.warehouseId);
                    setQuantity(1);
                  }}
                  className="accent-indigo-600"
                />
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{sl.warehouseName}</p>
                  <p className="text-xs text-gray-500">{sl.location}</p>
                </div>
                <StockBadge units={sl.availableUnits} />
              </label>
            ))}
          </div>
        </div>

        {maxQty > 0 && (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-8 h-8 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold"
              >
                −
              </button>
              <span className="w-8 text-center font-semibold text-gray-900">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                className="w-8 h-8 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold"
              >
                +
              </button>
              <span className="text-xs text-gray-500">of {maxQty} available</span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleReserve}
            disabled={loading || maxQty === 0 || !warehouseId}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {loading ? "Reserving…" : `Reserve · ${formatINR(product.price)}`}
          </button>
        </div>

        <p className="text-xs text-center text-gray-400">
          Your reservation holds for 10 minutes. No charge until you confirm.
        </p>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  onReserve,
}: {
  product: ProductDTO;
  onReserve: () => void;
}) {
  const available = totalAvailable(product);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
      {/* Colour accent based on stock */}
      <div
        className={`h-1.5 ${
          available === 0
            ? "bg-red-400"
            : available <= 5
            ? "bg-amber-400"
            : "bg-green-400"
        }`}
      />
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-900 leading-tight">
              {product.name}
            </h3>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{product.sku}</p>
          </div>
          <p className="text-lg font-bold text-indigo-700 whitespace-nowrap">
            {formatINR(product.price)}
          </p>
        </div>

        {product.description && (
          <p className="text-sm text-gray-500">{product.description}</p>
        )}

        {/* Warehouse breakdown */}
        <div className="space-y-1.5">
          {product.stockLevels.map((sl) => (
            <div
              key={sl.warehouseId}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-gray-600">{sl.warehouseName}</span>
              <StockBadge units={sl.availableUnits} />
            </div>
          ))}
        </div>

        <button
          onClick={onReserve}
          disabled={available === 0}
          className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {available === 0 ? "Out of Stock" : "Reserve"}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<ProductDTO | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => {
        setProducts(data);
        setLoading(false);
      });
  }, []);

  function handleReserveSuccess(reservationId: string) {
    setSelectedProduct(null);
    router.push(`/checkout/${reservationId}`);
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Allo Inventory</h1>
            <p className="text-xs text-gray-500">Multi-warehouse fulfillment</p>
          </div>
          <span className="text-xs bg-indigo-100 text-indigo-700 font-medium px-3 py-1 rounded-full">
            Live Stock
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-gray-100 h-52 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-5">
              {products.length} products across 3 warehouses
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onReserve={() => setSelectedProduct(p)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selectedProduct && (
        <ReserveModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onSuccess={handleReserveSuccess}
        />
      )}
    </main>
  );
}
