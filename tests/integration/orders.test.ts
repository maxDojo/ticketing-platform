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

async function paymentFixture(capacity = 10) {
  const f = await fixture(capacity);
  const order = await createOrder(pool, f.guest, f.input);
  const { initializePayment } =
    await import("../../src/modules/payments/service");
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

it("issues separate group admissions once and protects credentials by browser ownership", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const { guestTickets } = await import("../../src/modules/tickets/guest");
  const f = await paymentFixture();
  await Promise.all(
    Array.from({ length: 6 }, () => confirmPayment(pool, f.p.id, f.verified)),
  );
  const wallet = await guestTickets(pool, f.guest, f.order.id);
  expect(wallet.tickets).toHaveLength(7);
  expect(new Set(wallet.tickets.map((t) => t.token)).size).toBe(7);
  const again = await guestTickets(pool, f.guest, f.order.id);
  expect(again.tickets).toEqual(wallet.tickets);
  await expect(
    guestTickets(pool, randomBytes(32).toString("hex"), f.order.id),
  ).rejects.toMatchObject({ status: 404 });
  const foreign = await paymentFixture();
  await confirmPayment(pool, foreign.p.id, foreign.verified);
  await expect(
    guestTickets(pool, foreign.guest, foreign.order.id, wallet.tickets[0]!.id),
  ).rejects.toMatchObject({ status: 404 });
  await pool.query("UPDATE tickets SET status='cancelled' WHERE id=$1", [
    wallet.tickets[0]!.id,
  ]);
  expect(
    (await guestTickets(pool, f.guest, f.order.id, wallet.tickets[0]!.id))
      .tickets[0]!.token,
  ).toBeNull();
  // Only this disposable test database permits controlled clock ageing.
  await pool.query(
    "ALTER TABLE checkout_requests DISABLE TRIGGER checkout_request_guard",
  );
  try {
    await pool.query(
      "UPDATE checkout_requests SET created_at=now()-interval '25 hours' WHERE order_id=$1",
      [f.order.id],
    );
  } finally {
    await pool.query(
      "ALTER TABLE checkout_requests ENABLE TRIGGER checkout_request_guard",
    );
  }
  await expect(guestTickets(pool, f.guest, f.order.id)).rejects.toMatchObject({
    status: 404,
  });
});

it("rolls back payment, sold inventory and all tickets if an admission insert fails", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const f = await paymentFixture();
  await pool.query(
    "CREATE FUNCTION test_ticket_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$",
  );
  await pool.query(
    `CREATE TRIGGER test_ticket_failure BEFORE INSERT ON tickets FOR EACH ROW WHEN (NEW.order_id='${f.order.id}'::uuid AND NEW.admission_ordinal=2) EXECUTE FUNCTION test_ticket_failure()`,
  );
  try {
    await expect(confirmPayment(pool, f.p.id, f.verified)).rejects.toThrow();
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [f.order.id]))
        .rows[0].status,
    ).toBe("pending");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM payment_fulfillments WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    for (const t of f.types) expect((await inventory(t.id)).sold_units).toBe(0);
  } finally {
    await pool.query("DROP TRIGGER test_ticket_failure ON tickets");
    await pool.query("DROP FUNCTION test_ticket_failure()");
  }
  expect(await confirmPayment(pool, f.p.id, f.verified)).toBe("confirmed");
});

it("recovers missing admissions without changing existing credentials or inventory", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const { recoverTickets } = await import("../../src/modules/tickets/issuance");
  const f = await paymentFixture();
  await confirmPayment(pool, f.p.id, f.verified);
  const { rows: before } = await pool.query(
    "SELECT id,credential_hash FROM tickets WHERE order_id=$1 ORDER BY id",
    [f.order.id],
  );
  await pool.query("DELETE FROM tickets WHERE id=$1", [before[0].id]);
  await Promise.all([recoverTickets(pool), recoverTickets(pool)]);
  const { rows: after } = await pool.query(
    "SELECT id,credential_hash FROM tickets WHERE order_id=$1",
    [f.order.id],
  );
  expect(after).toHaveLength(7);
  for (const t of before.slice(1)) expect(after).toContainEqual(t);
  for (const t of f.types) expect((await inventory(t.id)).sold_units).toBe(1);
});

it("rejects excessive admission counts before reserving inventory", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE ticket_types SET admissions_per_unit=1000 WHERE id=$1",
    [f.types[0].id],
  );
  await expect(createOrder(pool, f.guest, f.input)).rejects.toMatchObject({
    status: 400,
  });
  expect((await inventory(f.types[0].id)).reserved_units).toBe(0);
});
it("confirms duplicates concurrently exactly once and cannot regress paid state", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const f = await paymentFixture();
  await Promise.all(
    Array.from({ length: 8 }, () => confirmPayment(pool, f.p.id, f.verified)),
  );
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("paid");
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 0,
    sold_units: 1,
  });
  await confirmPayment(pool, f.p.id, { ...f.verified, status: "failed" });
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("paid");
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM payment_fulfillments WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT provider_fees::text AS fees FROM payments WHERE id=$1",
        [f.p.id],
      )
    ).rows[0].fees,
  ).toBe("100");
  await expect(
    pool.query("UPDATE payments SET status='failed' WHERE id=$1", [f.p.id]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("UPDATE orders SET status='expired' WHERE id=$1", [f.order.id]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("serializes confirmation against expiry and reacquires released stock without overselling", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const f = await paymentFixture(1);
  await ageOrder(f.order.id);
  await Promise.all([
    expireReservations(pool),
    confirmPayment(pool, f.p.id, f.verified),
  ]);
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("paid");
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 0,
    sold_units: 1,
  });
  expect(
    (
      await pool.query("SELECT state FROM reservations WHERE order_id=$1", [
        f.order.id,
      ])
    ).rows.every((r) => r.state === "committed"),
  ).toBe(true);
});
it("records paid-but-unfulfilled late payments without stealing another buyer's stock", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const f = await paymentFixture(1);
  await ageOrder(f.order.id);
  await expireReservations(pool);
  await createOrder(pool, "another-guest", {
    ...f.input,
    requestKey: randomUUID(),
  });
  expect(await confirmPayment(pool, f.p.id, f.verified)).toBe("attention");
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe(
    "payment_exception",
  );
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 1,
    sold_units: 0,
  });
  expect(
    (await pool.query("SELECT status FROM payments WHERE id=$1", [f.p.id]))
      .rows[0].status,
  ).toBe("succeeded");
  expect(
    (
      await pool.query(
        "SELECT reason FROM payment_exceptions WHERE payment_id=$1",
        [f.p.id],
      )
    ).rows[0].reason,
  ).toBe("inventory_unavailable");
});
it("rejects wrong amount, currency, reference or mode, releases holds and permits no tickets", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  for (const patch of [
    { amount: 1 },
    { currency: "USD" },
    { reference: "wrong-reference" },
    { domain: "live" },
  ]) {
    const f = await paymentFixture();
    expect(
      await confirmPayment(pool, f.p.id, { ...f.verified, ...patch }),
    ).toBe("attention");
    expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe(
      "payment_exception",
    );
    expect(await inventory(f.types[0].id)).toEqual({
      reserved_units: 0,
      sold_units: 0,
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(0);
  }
});
it("routes cancelled events to review and records excess successful payments only once", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const cancelled = await paymentFixture();
  await pool.query("UPDATE events SET status='cancelled' WHERE id=$1", [
    cancelled.event.id,
  ]);
  expect(await confirmPayment(pool, cancelled.p.id, cancelled.verified)).toBe(
    "attention",
  );
  expect(await inventory(cancelled.types[0].id)).toEqual({
    reserved_units: 0,
    sold_units: 0,
  });
  const f = await paymentFixture();
  await confirmPayment(pool, f.p.id, f.verified);
  const reference = `ts-test-${randomUUID()}`;
  const p = (
    await pool.query(
      "INSERT INTO payments (order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,$3,'NGN') RETURNING id",
      [f.order.id, reference, f.p.expected_amount],
    )
  ).rows[0];
  await Promise.all([
    confirmPayment(pool, p.id, { ...f.verified, reference }),
    confirmPayment(pool, p.id, { ...f.verified, reference }),
  ]);
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 0,
    sold_units: 1,
  });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM payment_exceptions WHERE payment_id=$1 AND reason='excess_payment'",
        [p.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("durably deduplicates signed raw webhooks, rejects tampering, and queues no foreign references", async () => {
  const { acceptWebhook } = await import("../../src/modules/payments/webhook");
  const { createHmac } = await import("node:crypto");
  const f = await paymentFixture();
  const secret = "sk_test_syntheticwebhook123";
  const body = Buffer.from(
    JSON.stringify({
      event: "charge.success",
      data: { reference: f.p.provider_reference, domain: "test" },
    }),
  );
  const signature = createHmac("sha512", secret).update(body).digest("hex");
  await Promise.all([
    acceptWebhook(pool, body, signature, secret),
    acceptWebhook(pool, body, signature, secret),
  ]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM payment_webhook_receipts WHERE payment_id=$1",
        [f.p.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    acceptWebhook(
      pool,
      Buffer.concat([body, Buffer.from(" ")]),
      signature,
      secret,
    ),
  ).rejects.toMatchObject({ status: 401 });
  await expect(acceptWebhook(pool, body, "zz", secret)).rejects.toMatchObject({
    status: 401,
  });
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("pending");
  const foreign = Buffer.from(
    JSON.stringify({
      event: "charge.success",
      data: { reference: "other-application", domain: "test" },
    }),
  );
  await acceptWebhook(
    pool,
    foreign,
    createHmac("sha512", secret).update(foreign).digest("hex"),
    secret,
  );
});
it("queues guest verification only for its owner", async () => {
  const { requestGuestVerification } =
    await import("../../src/modules/payments/guest");
  const f = await paymentFixture();
  await expect(
    requestGuestVerification(pool, "wrong-guest", f.p.provider_reference),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await requestGuestVerification(pool, f.guest, f.p.provider_reference)).id,
  ).toBe(f.order.id);
});
it("recovers a crashed worker lease and retries outages without changing inventory", async () => {
  const { processPaymentJobs } =
    await import("../../src/modules/payments/jobs");
  const f = await paymentFixture();
  // Keep unrelated fixtures out of this deterministic worker batch.
  await pool.query(
    "UPDATE payment_jobs SET next_attempt_at=now()+interval '1 day'",
  );
  await pool.query(
    "UPDATE payment_jobs SET next_attempt_at=now(),lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE payment_id=$1",
    [f.p.id, randomUUID()],
  );
  expect(await processPaymentJobs(pool, async () => f.verified, 1)).toBe(0);
  await pool.query(
    "UPDATE payment_jobs SET lease_expires_at=now()-interval '1 second' WHERE payment_id=$1",
    [f.p.id],
  );
  expect(
    await processPaymentJobs(
      pool,
      async () => {
        throw new Error("provider down");
      },
      1,
    ),
  ).toBe(1);
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("pending");
  expect(
    (
      await pool.query(
        "SELECT state,last_outcome FROM payment_jobs WHERE payment_id=$1",
        [f.p.id],
      )
    ).rows[0],
  ).toEqual({ state: "pending", last_outcome: "retry" });
  await pool.query(
    "UPDATE payment_jobs SET next_attempt_at=now() WHERE payment_id=$1",
    [f.p.id],
  );
  await processPaymentJobs(pool, async () => f.verified, 1);
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("paid");
});
it("does not lose a webhook signal received during a pending verification", async () => {
  const { processPaymentJobs } =
    await import("../../src/modules/payments/jobs");
  const { acceptWebhook } = await import("../../src/modules/payments/webhook");
  const { createHmac } = await import("node:crypto");
  const f = await paymentFixture();
  await pool.query(
    "UPDATE payment_jobs SET next_attempt_at=now()+interval '1 day'",
  );
  await pool.query(
    "UPDATE payment_jobs SET next_attempt_at=now() WHERE payment_id=$1",
    [f.p.id],
  );
  const secret = "sk_test_syntheticwebhook123";
  const body = Buffer.from(
    JSON.stringify({
      event: "charge.success",
      data: { reference: f.p.provider_reference, domain: "test" },
    }),
  );
  await processPaymentJobs(
    pool,
    async () => {
      await acceptWebhook(
        pool,
        body,
        createHmac("sha512", secret).update(body).digest("hex"),
        secret,
      );
      return { ...f.verified, status: "pending" };
    },
    1,
  );
  expect(
    (
      await pool.query(
        "SELECT state,next_attempt_at<=now() AS due FROM payment_jobs WHERE payment_id=$1",
        [f.p.id],
      )
    ).rows[0],
  ).toEqual({ state: "pending", due: true });
  await processPaymentJobs(pool, async () => f.verified, 1);
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("paid");
});
it("allows a new attempt after verified failure and records a later second success as excess", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const { initializePayment } =
    await import("../../src/modules/payments/service");
  const f = await paymentFixture();
  await confirmPayment(pool, f.p.id, { ...f.verified, status: "failed" });
  await initializePayment(
    pool,
    f.guest,
    f.order.id,
    "http://localhost:3000",
    async () => "https://checkout.paystack.com/retry",
  );
  const retry = (
    await pool.query("SELECT * FROM payments WHERE order_id=$1 AND id<>$2", [
      f.order.id,
      f.p.id,
    ])
  ).rows[0];
  await confirmPayment(pool, retry.id, {
    ...f.verified,
    reference: retry.provider_reference,
  });
  await confirmPayment(pool, f.p.id, f.verified);
  expect(await inventory(f.types[0].id)).toEqual({
    reserved_units: 0,
    sold_units: 1,
  });
  expect(
    (
      await pool.query(
        "SELECT reason FROM payment_exceptions WHERE payment_id=$1",
        [f.p.id],
      )
    ).rows[0].reason,
  ).toBe("excess_payment");
});

it("rolls back payment and inventory together if fulfillment persistence fails", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const f = await paymentFixture();
  await pool.query(
    "CREATE FUNCTION test_fail_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$",
  );
  await pool.query(
    `CREATE TRIGGER test_fail_fulfillment BEFORE INSERT ON payment_fulfillments FOR EACH ROW WHEN (NEW.order_id='${f.order.id}'::uuid) EXECUTE FUNCTION test_fail_fulfillment()`,
  );
  try {
    await expect(confirmPayment(pool, f.p.id, f.verified)).rejects.toThrow();
    expect(await inventory(f.types[0].id)).toEqual({
      reserved_units: 1,
      sold_units: 0,
    });
    expect(
      (await pool.query("SELECT status FROM payments WHERE id=$1", [f.p.id]))
        .rows[0].status,
    ).toBe("initialized");
  } finally {
    await pool.query(
      "DROP TRIGGER test_fail_fulfillment ON payment_fulfillments",
    );
    await pool.query("DROP FUNCTION test_fail_fulfillment()");
  }
  expect(await confirmPayment(pool, f.p.id, f.verified)).toBe("confirmed");
});
it("escalates exhausted verification retries instead of silently dropping the payment", async () => {
  const { processPaymentJobs } =
    await import("../../src/modules/payments/jobs");
  const f = await paymentFixture();
  await pool.query(
    "UPDATE payment_jobs SET next_attempt_at=now()+interval '1 day'",
  );
  await pool.query(
    "UPDATE payment_jobs SET attempts=23,next_attempt_at=now() WHERE payment_id=$1",
    [f.p.id],
  );
  await processPaymentJobs(
    pool,
    async () => {
      throw new Error("provider unavailable");
    },
    1,
  );
  expect(
    (
      await pool.query("SELECT state FROM payment_jobs WHERE payment_id=$1", [
        f.p.id,
      ])
    ).rows[0].state,
  ).toBe("attention");
  expect(
    (
      await pool.query(
        "SELECT reason FROM payment_exceptions WHERE payment_id=$1",
        [f.p.id],
      )
    ).rows[0].reason,
  ).toBe("verification_unresolved");
  expect((await accessOrder(pool, f.guest, f.order.id)).status).toBe("pending");
});
