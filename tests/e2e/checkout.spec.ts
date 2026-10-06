import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { databaseConfig } from "../../src/config/database";
if (existsSync(".env.local")) loadEnvFile(".env.local");
const url = process.env.MIGRATION_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw new Error("Checkout fixtures require a loopback migration database");
const pool = new Pool(databaseConfig(url));
const origin = "http://127.0.0.1:3100";
test.afterAll(async () => {
  await pool.end();
});
test("guest checkout reserves exact inventory, survives reload, protects access and cancels", async ({
  page,
  context,
}) => {
  const slug = `checkout-${randomUUID()}`;
  const {
    rows: [event],
  } = await pool.query(
    "INSERT INTO events (slug,name,venue,timezone,starts_at,status,reservation_minutes) VALUES ($1,'Lagos Live','Lagos','Africa/Lagos',now()+interval '10 days','published',25) RETURNING id",
    [slug],
  );
  const {
    rows: [type],
  } = await pool.query(
    "INSERT INTO ticket_types (event_id,name,unit_price,capacity,admissions_per_unit) VALUES ($1,'Table for six',6000001,5,6) RETURNING id",
    [event.id],
  );
  try {
    await page.goto(`/events/${slug}`);
    await page
      .getByRole("link", { name: "Choose tickets", exact: true })
      .click();
    await page.getByLabel("Quantity — Table for six").fill("2");
    await page.getByLabel("Full name", { exact: true }).fill("Test Buyer");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("buyer@example.test");
    await page.screenshot({
      path: test.info().outputPath("checkout.png"),
      fullPage: true,
    });
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/orders") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Reserve tickets", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(200);
    const order = await response.json();
    expect(order.total).toBe("12000002");
    await expect(
      page.getByRole("heading", { name: "Tickets reserved", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("12 separate admission(s)", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("timer")).toContainText(/2[45]:/);
    const cookie = (await context.cookies()).find(
      (c) => c.name === "ts-checkout",
    )!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "ts-checkout",
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Tickets reserved", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("reservation.png"),
      fullPage: true,
    });
    // Exercise the redirect UI with an intercepted response; no real provider call.
    await page.route(`**/api/orders/${order.id}/payment`, (route) =>
      route.fulfill({
        json: { authorizationUrl: "https://checkout.paystack.com/synthetic" },
      }),
    );
    await page.route("https://checkout.paystack.com/synthetic", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Mock Paystack checkout</h1>",
      }),
    );
    await page
      .getByRole("button", { name: "Continue to Paystack (test)", exact: true })
      .click();
    await expect(page).toHaveURL("https://checkout.paystack.com/synthetic");
    await page.goto("/payments/return?reference=forged&status=success");
    await expect(
      page.getByText("This return does not confirm payment.", { exact: false }),
    ).toBeVisible();
    expect(
      (await context.request.get(`/api/orders/${order.id}`)).status(),
    ).toBe(200);
    await page.goto(`/checkout/${slug}`);
    await expect(
      page.getByRole("heading", { name: "Tickets reserved", exact: true }),
    ).toBeVisible();
    expect(
      (
        await context.request.post(`/api/orders/${order.id}/payment`, {
          data: { amount: 1 },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(`/api/orders/${order.id}/payment`, {
          data: {},
          headers: { Origin: "https://evil.example" },
        })
      ).status(),
    ).toBe(403);
    const payload = response.request().postDataJSON();
    const retried = await context.request.post("/api/orders", {
      data: payload,
      headers: { Origin: origin },
    });
    expect(retried.status()).toBe(200);
    expect((await retried.json()).id).toBe(order.id);
    expect(
      (
        await pool.query(
          "SELECT reserved_units FROM ticket_types WHERE id=$1",
          [type.id],
        )
      ).rows[0].reserved_units,
    ).toBe(2);
    const outsider = await context.browser()!.newContext();
    try {
      expect(
        (
          await outsider.request.get(`${origin}/api/orders/${order.id}`)
        ).status(),
      ).toBe(401);
      await outsider.request.post(`${origin}/api/checkout/session`, {
        data: {},
        headers: { Origin: origin },
      });
      expect(
        (
          await outsider.request.get(`${origin}/api/orders/${order.id}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await outsider.request.post(
            `${origin}/api/orders/${order.id}/cancel`,
            { data: {}, headers: { Origin: origin } },
          )
        ).status(),
      ).toBe(404);
    } finally {
      await outsider.close();
    }
    expect(
      (
        await context.request.post(`/api/orders/${order.id}/cancel`, {
          data: {},
          headers: { Origin: "https://evil.example" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post("/api/orders", {
          data: { ...payload, total: 1 },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post("/api/orders", {
          data: { payload: "x".repeat(33000) },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(413);
    expect(
      (await context.request.get(`/api/orders/${order.id}`)).headers()[
        "cache-control"
      ],
    ).toContain("no-store");
    await page
      .getByRole("button", { name: "Cancel reservation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Reservation cancelled", exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT reserved_units,sold_units FROM ticket_types WHERE id=$1",
          [type.id],
        )
      ).rows[0],
    ).toEqual({ reserved_units: 0, sold_units: 0 });
  } finally {
    await pool.query(
      "DELETE FROM reservations WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)",
      [event.id],
    );
    await pool.query(
      "DELETE FROM checkout_requests WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)",
      [event.id],
    );
    await pool.query("DELETE FROM order_items WHERE event_id=$1", [event.id]);
    await pool.query("DELETE FROM orders WHERE event_id=$1", [event.id]);
    await pool.query("DELETE FROM ticket_types WHERE event_id=$1", [event.id]);
    await pool.query("DELETE FROM events WHERE id=$1", [event.id]);
  }
});
