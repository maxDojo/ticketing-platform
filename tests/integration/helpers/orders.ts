import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, afterAll } from "vitest";
import { databaseConfig } from "../../../src/config/database";
import { createOrder } from "../../../src/modules/orders/service";

// Call once per suite: each file owns a disposable database and its cleanup hooks.
export function createOrderTestContext() {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  process.env.TICKET_ACTIVE_KEY_ID = "integration";
  process.env.TICKET_ENCRYPTION_KEYS = JSON.stringify({
    integration: randomBytes(32).toString("hex"),
  });
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  )
    throw new Error("Order tests require a disposable loopback database");
  const admin = new Pool(databaseConfig(url));
  const name = `ts_orders_${randomUUID().replaceAll("-", "")}`;
  const isolated = new URL(url);
  isolated.pathname = `/${name}`;
  const pool = new Pool(databaseConfig(isolated.toString()));
  let created = false;
  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  });
  async function fixture(capacity = 10) {
    const {
      rows: [event],
    } = await pool.query(
      "INSERT INTO events (slug,name,venue,timezone,starts_at,status,reservation_minutes) VALUES ($1,'Test event','Lagos','Africa/Lagos',now()+interval '1 day','published',25) RETURNING id",
      [`test-${randomUUID()}`],
    );
    const { rows: types } = await pool.query(
      "INSERT INTO ticket_types (event_id,name,unit_price,capacity,admissions_per_unit) VALUES ($1,'Table',6000001,$2,6),($1,'Regular',100001,$2,1) RETURNING id",
      [event.id, capacity],
    );
    return {
      event,
      types,
      guest: randomBytes(32).toString("hex"),
      input: {
        eventId: event.id,
        requestKey: randomUUID(),
        buyerName: "Test Buyer",
        buyerEmail: "buyer@example.test",
        items: types.map((t) => ({ ticketTypeId: t.id, quantity: 1 })),
      },
    };
  }
  async function inventory(id: string) {
    return (
      await pool.query(
        "SELECT reserved_units,sold_units FROM ticket_types WHERE id=$1",
        [id],
      )
    ).rows[0];
  }
  async function ageOrder(id: string) {
    // Test-only clock advance in an isolated DB, keeping the commercial expiry relation.
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("ALTER TABLE orders DISABLE TRIGGER order_snapshot_guard");
      await db.query(
        "UPDATE orders SET reserved_at=reserved_at-interval '2 days',reservation_expires_at=reservation_expires_at-interval '2 days' WHERE id=$1",
        [id],
      );
      await db.query("ALTER TABLE orders ENABLE TRIGGER order_snapshot_guard");
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async function paymentFixture(capacity = 10) {
    const f = await fixture(capacity);
    const order = await createOrder(pool, f.guest, f.input);
    const { initializePayment } =
      await import("../../../src/modules/payments/service");
    await initializePayment(
      pool,
      f.guest,
      order.id,
      "http://localhost:3000",
      async () => "https://checkout.paystack.com/synthetic",
    );
    const p = (
      await pool.query("SELECT * FROM payments WHERE order_id=$1", [order.id])
    ).rows[0];
    return {
      ...f,
      order,
      p,
      verified: {
        reference: p.provider_reference,
        domain: "test",
        status: "success",
        currency: "NGN",
        amount: Number(p.expected_amount),
        fees: 100,
      },
    };
  }

  return { pool, fixture, inventory, ageOrder, paymentFixture };
}
