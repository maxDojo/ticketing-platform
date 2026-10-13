import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createOrder,
  accessOrder,
  expireReservations,
} from "../../src/modules/orders/service";
import { createOrderTestContext } from "./helpers/orders";

const { pool, inventory, ageOrder, paymentFixture } = createOrderTestContext();

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
