import { expect, it } from "vitest";
import {
  createOrder,
  accessOrder,
  expireReservations,
} from "../../src/modules/orders/service";
import { createOrderTestContext } from "./helpers/orders";

const { pool, fixture, inventory, ageOrder } = createOrderTestContext();

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
