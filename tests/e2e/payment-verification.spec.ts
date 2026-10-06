import { test, expect } from "@playwright/test";
import { randomUUID, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { databaseConfig } from "../../src/config/database";
import { confirmPayment } from "../../src/modules/payments/confirmation";
if (existsSync(".env.local")) loadEnvFile(".env.local");
const url = process.env.MIGRATION_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw new Error("Browser fixtures require a loopback migration database");
const pool = new Pool(databaseConfig(url));
const origin = "http://127.0.0.1:3100";
const secret = "sk_test_syntheticbrowserfixture123";
test.afterAll(async () => {
  await pool.end();
});
test("signed webhook queues verification and the owning browser sees server-confirmed payment", async ({
  page,
  context,
}) => {
  const slug = `verify-${randomUUID()}`;
  const e = (
    await pool.query(
      "INSERT INTO events (slug,name,venue,timezone,starts_at,status) VALUES ($1,'Verification Test','Lagos','Africa/Lagos',now()+interval '1 day','published') RETURNING id",
      [slug],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO ticket_types (event_id,name,unit_price,capacity) VALUES ($1,'Test admission',100000,5)",
    [e.id],
  );
  try {
    await page.goto(`/checkout/${slug}`);
    await page.getByLabel("Quantity — Test admission").fill("1");
    await page.getByLabel("Full name", { exact: true }).fill("Test Buyer");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("buyer@example.test");
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/orders") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Reserve tickets", exact: true })
      .click();
    const o = await (await created).json();
    const reference = `ts-test-${randomUUID()}`;
    const p = (
      await pool.query(
        "INSERT INTO payments (order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,100000,'NGN') RETURNING id",
        [o.id, reference],
      )
    ).rows[0];
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference, domain: "test" },
    });
    const signature = createHmac("sha512", secret).update(body).digest("hex");
    expect(
      (
        await context.request.post("/api/paystack/webhook", {
          data: body,
          headers: {
            "Content-Type": "application/json",
            "x-paystack-signature": "bad",
          },
        })
      ).status(),
    ).toBe(401);
    const delivered = await context.request.post("/api/paystack/webhook", {
      data: body,
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": signature,
      },
    });
    expect(delivered.status()).toBe(200);
    expect(
      (
        await pool.query("SELECT state FROM payment_jobs WHERE payment_id=$1", [
          p.id,
        ])
      ).rows[0].state,
    ).toBe("pending");
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [o.id]))
        .rows[0].status,
    ).toBe("pending");
    const outsider = await context.browser()!.newContext();
    try {
      await outsider.request.post(`${origin}/api/checkout/session`, {
        data: {},
        headers: { Origin: origin },
      });
      expect(
        (
          await outsider.request.post(`${origin}/api/payments/verify`, {
            data: { reference },
            headers: { Origin: origin },
          })
        ).status(),
      ).toBe(404);
    } finally {
      await outsider.close();
    }
    // The real worker uses the same confirmation service; this fixture supplies a
    // synthetic provider result for this payment only, never other local jobs.
    await confirmPayment(pool, p.id, {
      reference,
      domain: "test",
      status: "success",
      amount: 100000,
      currency: "NGN",
      fees: 1500,
    });
    await page.goto(`/payments/return?reference=${reference}`);
    await expect(
      page.getByRole("heading", { name: "Payment confirmed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Your test payment is confirmed and inventory is secured.",
        { exact: false },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("payment-confirmed.png"),
      fullPage: true,
    });
    expect(
      (
        await pool.query(
          "SELECT reserved_units,sold_units FROM ticket_types WHERE event_id=$1",
          [e.id],
        )
      ).rows[0],
    ).toEqual({ reserved_units: 0, sold_units: 1 });
  } finally {
    for (const table of [
      "payment_webhook_receipts",
      "payment_fulfillments",
      "payment_exceptions",
      "payment_jobs",
      "payment_initializations",
    ])
      await pool.query(
        `DELETE FROM ${table} WHERE payment_id IN (SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.event_id=$1)`,
        [e.id],
      );
    await pool.query(
      "DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)",
      [e.id],
    );
    await pool.query(
      "DELETE FROM reservations WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)",
      [e.id],
    );
    await pool.query(
      "DELETE FROM checkout_requests WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)",
      [e.id],
    );
    await pool.query("DELETE FROM order_items WHERE event_id=$1", [e.id]);
    await pool.query("DELETE FROM orders WHERE event_id=$1", [e.id]);
    await pool.query("DELETE FROM ticket_types WHERE event_id=$1", [e.id]);
    await pool.query("DELETE FROM events WHERE id=$1", [e.id]);
  }
});
