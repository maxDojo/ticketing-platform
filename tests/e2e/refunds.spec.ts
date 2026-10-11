import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { URI } from "otpauth";
import { databaseConfig } from "../../src/config/database";
import { createOrder } from "../../src/modules/orders/service";
import { confirmPayment } from "../../src/modules/payments/confirmation";
if (existsSync(".env.local")) loadEnvFile(".env.local");
process.env.TICKET_ACTIVE_KEY_ID = "browser";
process.env.TICKET_ENCRYPTION_KEYS = JSON.stringify({
  browser: "42".repeat(32),
});
const origin = "http://127.0.0.1:3100",
  url = process.env.MIGRATION_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw Error("Local browser database required");
const pool = new Pool(databaseConfig(url));
test.afterAll(() => pool.end());
test("organizer approves a full refund and permanently cancels an event", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const id = randomUUID(),
    email = `reports-${id}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const {
    rows: [event],
  } = await pool.query(
    "INSERT INTO events(slug,name,venue,timezone,starts_at,status) VALUES ($1,'Reporting test event','Lagos','Africa/Lagos',now()+interval '7 days','published') RETURNING id",
    [`report-${id}`],
  );
  const api = `/api/admin/events/${event.id}/refunds`;
  const post = (path: string, data: object) =>
    context.request.post(path, { data, headers: { Origin: origin } });
  try {
    await pool.query(
      "INSERT INTO auth_user(id,name,email,\"emailVerified\") VALUES ($1,'Report organizer',$2,true)",
      [id, email],
    );
    await pool.query(
      'INSERT INTO auth_account(id,"accountId","providerId","userId",password) VALUES ($1,$2,\'credential\',$2,$3)',
      [randomUUID(), id, await hashPassword(password)],
    );
    await pool.query("INSERT INTO organizers(user_id) VALUES ($1)", [id]);
    await pool.query("UPDATE events SET organizer_id=$1 WHERE id=$2", [
      id,
      event.id,
    ]);
    const {
      rows: [type],
    } = await pool.query(
      "INSERT INTO ticket_types(event_id,name,unit_price,capacity,admissions_per_unit) VALUES ($1,'Group',100000,10,2) RETURNING id",
      [event.id],
    );
    const order = await createOrder(pool, randomBytes(32).toString("hex"), {
      eventId: event.id,
      requestKey: randomUUID(),
      buyerName: "=1+1",
      buyerEmail: "synthetic-report@example.test",
      items: [{ ticketTypeId: type.id, quantity: 1 }],
    });
    const reference = `ts-test-${randomUUID()}`;
    const {
      rows: [payment],
    } = await pool.query(
      "INSERT INTO payments(order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,100000,'NGN') RETURNING id",
      [order.id, reference],
    );
    await confirmPayment(pool, payment.id, {
      reference,
      status: "success",
      domain: "test",
      amount: 100000,
      currency: "NGN",
      fees: 1500,
    });
    expect((await post(api, { action: "view" })).status()).toBe(401);
    expect(
      (
        await post("/api/auth/sign-in/email", {
          email,
          password,
          rememberMe: false,
        })
      ).status(),
    ).toBe(200);
    expect((await post(api, { action: "view" })).status()).toBe(403);
    const enrollment = await (
      await post("/api/auth/two-factor/enable", { password })
    ).json();
    expect(
      (
        await post("/api/auth/two-factor/verify-totp", {
          code: URI.parse(enrollment.totpURI).generate(),
          trustDevice: false,
        })
      ).status(),
    ).toBe(200);
    await page.goto(`/admin/events/${event.id}/refunds`);
    await expect(
      page.getByRole("button", { name: "Review full refund" }),
    ).toBeVisible();
    expect(
      (
        await context.request.post(api, {
          data: { action: "view" },
          headers: { Origin: "https://attacker.example" },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole("button", { name: "Review full refund" }).click();
    await page.getByLabel("Type the payment reference").fill(reference);
    await page.getByLabel("Internal reason").fill("Synthetic browser refund");
    await page
      .getByLabel("I approve the full refund", { exact: false })
      .check();
    await page
      .getByRole("button", { name: "Approve full refund", exact: true })
      .click();
    await expect(
      page.getByText("Refund: approved", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1 AND status='cancelled'",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(2);
    await page
      .getByLabel("Cancellation reason")
      .fill("Synthetic venue cancellation");
    await page.getByLabel("Permanently cancel", { exact: false }).check();
    await page
      .getByRole("button", { name: "Cancel event permanently" })
      .click();
    await expect(
      page.getByText("Event status: cancelled.", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("refunds-cancellation.png"),
      fullPage: true,
    });
    await pool.query("UPDATE organizers SET active=false WHERE user_id=$1", [
      id,
    ]);
    expect((await post(api, { action: "view" })).status()).toBe(404);
  } finally {
    await pool.query("DELETE FROM refunds WHERE event_id=$1", [event.id]);
    await pool.query("DELETE FROM event_cancellations WHERE event_id=$1", [
      event.id,
    ]);
    await pool.query("DELETE FROM admin_audit WHERE actor_id=$1", [id]);
    await pool.query("DELETE FROM event_staff WHERE user_id=$1", [id]);
    await pool.query(
      "DELETE FROM ticket_delivery_jobs WHERE order_id IN(SELECT id FROM orders WHERE event_id=$1)",
      [event.id],
    );
    await pool.query("DELETE FROM tickets WHERE event_id=$1", [event.id]);
    for (const table of [
      "payment_webhook_receipts",
      "payment_fulfillments",
      "payment_exceptions",
      "payment_jobs",
      "payment_initializations",
    ])
      await pool.query(
        `DELETE FROM ${table} WHERE payment_id IN(SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.event_id=$1)`,
        [event.id],
      );
    for (const table of ["payments", "reservations", "checkout_requests"])
      await pool.query(
        `DELETE FROM ${table} WHERE order_id IN(SELECT id FROM orders WHERE event_id=$1)`,
        [event.id],
      );
    for (const table of ["order_items", "orders", "ticket_types"])
      await pool.query(`DELETE FROM ${table} WHERE event_id=$1`, [event.id]);
    await pool.query("DELETE FROM events WHERE id=$1", [event.id]);
    await pool.query("DELETE FROM organizers WHERE user_id=$1", [id]);
    for (const table of ["auth_session", "auth_two_factor", "auth_account"])
      await pool.query(`DELETE FROM ${table} WHERE "userId"=$1`, [id]);
    await pool.query("DELETE FROM auth_user WHERE id=$1", [id]);
  }
});
