import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { accessOrder } from "../../src/modules/orders/service";
import { createOrderTestContext } from "./helpers/orders";

const { pool, paymentFixture } = createOrderTestContext();

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
