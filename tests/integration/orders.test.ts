import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, afterAll, expect, it } from "vitest";
import { databaseConfig } from "../../src/config/database";
import {
  createOrder,
  accessOrder,
  expireReservations,
} from "../../src/modules/orders/service";
if (existsSync(".env.local")) loadEnvFile(".env.local");
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
it("calculates exact server prices and freezes group entitlement and event duration", async () => {
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  expect(o.total).toBe("6100002");
  expect(o.discount).toBe("0");
  expect(o.fees).toBe("0");
  expect(
    o.items.reduce(
      (n: number, i: { quantity: number; admissions_per_unit: number }) =>
        n + i.quantity * i.admissions_per_unit,
      0,
    ),
  ).toBe(7);
  const row = (
    await pool.query(
      "SELECT reservation_minutes,extract(epoch from reservation_expires_at-reserved_at)::int AS seconds FROM orders WHERE id=$1",
      [o.id],
    )
  ).rows[0];
  expect(row).toEqual({ reservation_minutes: 25, seconds: 1500 });
  await pool.query(
    "UPDATE ticket_types SET unit_price=1,admissions_per_unit=1 WHERE event_id=$1",
    [f.event.id],
  );
  await pool.query("UPDATE events SET reservation_minutes=1 WHERE id=$1", [
    f.event.id,
  ]);
  expect((await accessOrder(pool, f.guest, o.id)).total).toBe("6100002");
  expect(
    (await accessOrder(pool, f.guest, o.id)).items.some(
      (i: { admissions_per_unit: number }) => i.admissions_per_unit === 6,
    ),
  ).toBe(true);
});
it("serializes concurrent retries and rejects key reuse with changed details", async () => {
  const f = await fixture();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => createOrder(pool, f.guest, f.input)),
  );
  expect(new Set(results.map((o) => o.id)).size).toBe(1);
  expect((await inventory(f.types[0].id)).reserved_units).toBe(1);
  await expect(
    createOrder(pool, f.guest, { ...f.input, buyerName: "Changed" }),
  ).rejects.toMatchObject({ status: 409 });
});
it("allows exactly one buyer to reserve the final package under contention", async () => {
  const f = await fixture(1);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      createOrder(pool, randomBytes(32).toString("hex"), {
        ...f.input,
        requestKey: randomUUID(),
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 1,
    sold_units: 0,
  });
  expect(await inventory(f.types[1].id)).toEqual({
    reserved_units: 1,
    sold_units: 0,
  });
});
it("rolls back every category when a later category lacks inventory", async () => {
  const f = await fixture();
  const sorted = f.types.map((t) => t.id).sort();
  await pool.query("UPDATE ticket_types SET capacity=0 WHERE id=$1", [
    sorted[1],
  ]);
  await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
    status: 409,
  });
  expect((await inventory(sorted[0])).reserved_units).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM orders WHERE event_id=$1",
        [f.event.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("rejects client totals, duplicate categories, cross-event categories and invalid quantities", async () => {
  const f = await fixture();
  const other = await fixture();
  for (const input of [
    { ...f.input, total: 1 },
    { ...f.input, items: [f.input.items[0], f.input.items[0]] },
    { ...f.input, items: [{ ticketTypeId: other.types[0].id, quantity: 1 }] },
    { ...f.input, items: [{ ticketTypeId: f.types[0].id, quantity: 0 }] },
    { ...f.input, items: [{ ticketTypeId: f.types[0].id, quantity: 1.5 }] },
  ])
    await expect(createOrder(pool, f.guest, input)).rejects.toMatchObject({
      status: 400,
    });
  await pool.query(
    "UPDATE ticket_types SET minimum_quantity=2,maximum_quantity=3 WHERE id=$1",
    [f.types[0].id],
  );
  await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    createOrder(pool, f.guest, {
      ...f.input,
      items: [{ ticketTypeId: f.types[0].id, quantity: 4 }],
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("rejects unpublished, started, inactive and out-of-sale inventory", async () => {
  const f = await fixture();
  await pool.query("UPDATE events SET status='draft' WHERE id=$1", [
    f.event.id,
  ]);
  await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
    status: 409,
  });
  await pool.query(
    "UPDATE events SET status='published',starts_at=now()-interval '1 hour' WHERE id=$1",
    [f.event.id],
  );
  await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
    status: 409,
  });
  await pool.query(
    "UPDATE events SET starts_at=now()+interval '1 day' WHERE id=$1",
    [f.event.id],
  );
  for (const clause of [
    "active=false",
    "active=true,sale_starts_at=now()+interval '1 hour'",
    "sale_starts_at=null,sale_ends_at=now()-interval '1 hour'",
  ]) {
    await pool.query(`UPDATE ticket_types SET ${clause} WHERE id=$1`, [
      f.types[0].id,
    ]);
    await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
      status: 409,
    });
  }
  expect((await inventory(f.types[0].id)).reserved_units).toBe(0);
});
it("denies order access and cancellation to a different guest", async () => {
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  await expect(accessOrder(pool, "another-guest", o.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    accessOrder(pool, "another-guest", o.id, true),
  ).rejects.toMatchObject({ status: 404 });
  expect((await accessOrder(pool, f.guest, o.id)).status).toBe("pending");
  expect(o).not.toHaveProperty("buyer_email");
  expect(o).not.toHaveProperty("guest_hash");
});
it("cancels once despite concurrent calls and does not resurrect retries", async () => {
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  await Promise.all(
    Array.from({ length: 5 }, () => accessOrder(pool, f.guest, o.id, true)),
  );
  expect((await inventory(f.types[0].id)).reserved_units).toBe(0);
  expect((await createOrder(pool, f.guest, f.input)).status).toBe("cancelled");
  expect((await inventory(f.types[0].id)).reserved_units).toBe(0);
});
it("expires once when concurrent sweepers and cancellation compete and lets a new buyer reserve", async () => {
  const f = await fixture(1);
  const o = await createOrder(pool, f.guest, f.input);
  await ageOrder(o.id);
  await Promise.all([
    expireReservations(pool),
    expireReservations(pool),
    accessOrder(pool, f.guest, o.id, true),
  ]);
  expect((await accessOrder(pool, f.guest, o.id)).status).toBe("expired");
  expect((await createOrder(pool, f.guest, f.input)).status).toBe("expired");
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 0,
    sold_units: 0,
  });
  expect(
    (await createOrder(pool, f.guest, { ...f.input, requestKey: randomUUID() }))
      .status,
  ).toBe("pending");
  await expect(
    pool.query("UPDATE reservations SET state='held' WHERE order_id=$1", [
      o.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rejects reservation scope mismatch and immutable checkout identity edits", async () => {
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  await expect(
    pool.query("UPDATE reservations SET quantity=2 WHERE order_id=$1", [o.id]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("UPDATE checkout_requests SET guest_hash=$2 WHERE order_id=$1", [
      o.id,
      "0".repeat(64),
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});

it("normalizes UUID input and preserves zero-price orders without issuing tickets", async () => {
  const f = await fixture();
  await pool.query("UPDATE ticket_types SET unit_price=0 WHERE event_id=$1", [
    f.event.id,
  ]);
  const o = await createOrder(pool, f.guest, {
    ...f.input,
    eventId: f.event.id.toUpperCase(),
    items: f.input.items.map((i) => ({
      ...i,
      ticketTypeId: i.ticketTypeId.toUpperCase(),
    })),
  });
  expect(o.total).toBe("0");
  expect(o.status).toBe("pending");
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("rolls back totals outside the safe payment amount boundary", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE ticket_types SET unit_price=9007199254740992 WHERE event_id=$1",
    [f.event.id],
  );
  await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
    status: 400,
  });
  expect((await inventory(f.types[0].id)).reserved_units).toBe(0);
});

it("initializes once from saved prices and blocks cancellation after initialization", async () => {
  const { initializePayment } =
    await import("../../src/modules/payments/service");
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  let calls = 0;
  const gateway = async (input: {
    amount: string;
    email: string;
    reference: string;
  }) => {
    calls++;
    expect(input.amount).toBe("6100002");
    expect(input.email).toBe("buyer@example.test");
    return "https://checkout.paystack.com/synthetic";
  };
  const result = await initializePayment(
    pool,
    f.guest,
    o.id,
    "http://localhost:3000",
    gateway,
  );
  expect(result.authorizationUrl).toBe(
    "https://checkout.paystack.com/synthetic",
  );
  expect(
    await initializePayment(
      pool,
      f.guest,
      o.id,
      "http://localhost:3000",
      gateway,
    ),
  ).toEqual(result);
  expect(calls).toBe(1);
  await expect(accessOrder(pool, f.guest, o.id, true)).rejects.toMatchObject({
    status: 409,
  });
  expect((await accessOrder(pool, f.guest, o.id)).status).toBe("pending");
  expect((await inventory(f.types[0].id)).sold_units).toBe(0);
});
it("serializes simultaneous payment starts without holding locks during network calls", async () => {
  const { initializePayment } =
    await import("../../src/modules/payments/service");
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  let finish!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const gateway = async () => {
    calls++;
    started();
    await waiting;
    return "https://checkout.paystack.com/synthetic";
  };
  const first = initializePayment(
    pool,
    f.guest,
    o.id,
    "http://localhost:3000",
    gateway,
  );
  await startedPromise;
  try {
    await expect(
      initializePayment(pool, f.guest, o.id, "http://localhost:3000", gateway),
    ).rejects.toMatchObject({ status: 409 });
    await ageOrder(o.id);
    await expireReservations(pool);
  } finally {
    finish();
  }
  await expect(first).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(1);
  expect((await accessOrder(pool, f.guest, o.id)).status).toBe("expired");
});
it("preserves uncertain attempts and denies cross-guest, zero-price and expired starts", async () => {
  const { initializePayment } =
    await import("../../src/modules/payments/service");
  const f = await fixture();
  const o = await createOrder(pool, f.guest, f.input);
  let calls = 0;
  const gateway = async () => {
    calls++;
    throw new Error("simulated lost response");
  };
  await expect(
    initializePayment(pool, "other", o.id, "http://localhost:3000", gateway),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    initializePayment(pool, f.guest, o.id, "http://localhost:3000", gateway),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    initializePayment(pool, f.guest, o.id, "http://localhost:3000", gateway),
  ).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT state FROM payment_initializations WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].state,
  ).toBe("unknown");
  const free = await fixture();
  await pool.query("UPDATE ticket_types SET unit_price=0 WHERE event_id=$1", [
    free.event.id,
  ]);
  const freeOrder = await createOrder(pool, free.guest, free.input);
  await expect(
    initializePayment(
      pool,
      free.guest,
      freeOrder.id,
      "http://localhost:3000",
      gateway,
    ),
  ).rejects.toMatchObject({ status: 400 });
  const expired = await fixture();
  const expiredOrder = await createOrder(pool, expired.guest, expired.input);
  await ageOrder(expiredOrder.id);
  await expect(
    initializePayment(
      pool,
      expired.guest,
      expiredOrder.id,
      "http://localhost:3000",
      gateway,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(1);
});
