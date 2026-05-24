// src/lib/schemas.ts
import { z } from "zod";

// ── Request schemas ────────────────────────────────────────────────────────

export const CreateReservationSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  warehouseId: z.string().min(1, "warehouseId is required"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;

// ── Response shapes (shared with frontend) ─────────────────────────────────

export const ReservationStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "RELEASED",
]);

export const ReservationSchema = z.object({
  id: z.string(),
  productId: z.string(),
  warehouseId: z.string(),
  quantity: z.number(),
  status: ReservationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  product: z
    .object({
      name: z.string(),
      sku: z.string(),
      price: z.string(),
    })
    .optional(),
  warehouse: z
    .object({
      name: z.string(),
      location: z.string(),
    })
    .optional(),
});

export type ReservationDTO = z.infer<typeof ReservationSchema>;

export const StockLevelSchema = z.object({
  warehouseId: z.string(),
  warehouseName: z.string(),
  location: z.string(),
  totalUnits: z.number(),
  reservedUnits: z.number(),
  availableUnits: z.number(),
});

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  description: z.string().nullable(),
  price: z.string(),
  stockLevels: z.array(StockLevelSchema),
});

export type ProductDTO = z.infer<typeof ProductSchema>;
