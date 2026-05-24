// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.reservation.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  // Create warehouses
  const [mumbai, delhi, bangalore] = await Promise.all([
    prisma.warehouse.create({
      data: { name: "Mumbai Central", location: "Mumbai, MH" },
    }),
    prisma.warehouse.create({
      data: { name: "Delhi North", location: "Delhi, DL" },
    }),
    prisma.warehouse.create({
      data: { name: "Bangalore Hub", location: "Bangalore, KA" },
    }),
  ]);

  // Create products
  const [headphones, keyboard, monitor, mouse, webcam] = await Promise.all([
    prisma.product.create({
      data: {
        name: "Wireless Noise-Cancelling Headphones",
        sku: "WNC-HP-001",
        description: "Premium over-ear headphones with 30hr battery",
        price: new Decimal("8999.00"),
      },
    }),
    prisma.product.create({
      data: {
        name: "Mechanical Keyboard TKL",
        sku: "MK-TKL-002",
        description: "Tenkeyless mechanical keyboard, Cherry MX Blue switches",
        price: new Decimal("5499.00"),
      },
    }),
    prisma.product.create({
      data: {
        name: '27" 4K IPS Monitor',
        sku: "MON-4K-003",
        description: "27-inch 4K display, 144Hz, HDR400",
        price: new Decimal("34999.00"),
      },
    }),
    prisma.product.create({
      data: {
        name: "Ergonomic Wireless Mouse",
        sku: "ERG-MS-004",
        description: "Vertical ergonomic mouse, 6-button, silent click",
        price: new Decimal("2299.00"),
      },
    }),
    prisma.product.create({
      data: {
        name: "1080p Webcam Pro",
        sku: "WEB-CAM-005",
        description: "Full HD webcam with built-in ring light",
        price: new Decimal("3799.00"),
      },
    }),
  ]);

  // Seed stock levels
  const stockData = [
    // Headphones
    { product: headphones, warehouse: mumbai, total: 10 },
    { product: headphones, warehouse: delhi, total: 5 },
    { product: headphones, warehouse: bangalore, total: 3 },
    // Keyboard
    { product: keyboard, warehouse: mumbai, total: 20 },
    { product: keyboard, warehouse: delhi, total: 1 }, // scarce!
    { product: keyboard, warehouse: bangalore, total: 8 },
    // Monitor
    { product: monitor, warehouse: mumbai, total: 4 },
    { product: monitor, warehouse: delhi, total: 0 }, // out of stock
    { product: monitor, warehouse: bangalore, total: 6 },
    // Mouse
    { product: mouse, warehouse: mumbai, total: 50 },
    { product: mouse, warehouse: delhi, total: 30 },
    { product: mouse, warehouse: bangalore, total: 25 },
    // Webcam
    { product: webcam, warehouse: mumbai, total: 15 },
    { product: webcam, warehouse: delhi, total: 12 },
    { product: webcam, warehouse: bangalore, total: 0 }, // out of stock
  ];

  await Promise.all(
    stockData.map(({ product, warehouse, total }) =>
      prisma.stockLevel.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          totalUnits: total,
          reservedUnits: 0,
        },
      })
    )
  );

  console.log(
    `Seeded: 3 warehouses, 5 products, ${stockData.length} stock levels`
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
