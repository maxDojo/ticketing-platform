import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
test("organizer reports show exact sales and attendance and download protected filtered CSV", async ({
  page,
  context,
  browser,
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
  const api = `/api/admin/events/${event.id}/reports`;
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
    expect((await post(api, {})).status()).toBe(401);
    expect(
      (
        await post("/api/auth/sign-in/email", {
          email,
          password,
          rememberMe: false,
        })
      ).status(),
    ).toBe(200);
    expect((await post(api, {})).status()).toBe(403);
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
    const response = await post(api, {});
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await response.json()).summary.money[0].gross_sales_minor).toBe(
      "100000",
    );
    expect(
      (
        await context.request.post(api, {
          data: { export: true },
          headers: { Origin: "https://attacker.example" },
        })
      ).status(),
    ).toBe(403);
    const stranger = await browser.newContext();
    try {
      expect(
        (
          await stranger.request.post(origin + api, {
            data: { export: true },
            headers: { Origin: origin },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await stranger.close();
    }
    await page.goto(`/admin/events/${event.id}/reports`);
    await expect(
      page.getByRole("heading", {
        name: "Reporting test event — organizer reports",
      }),
    ).toBeVisible();
    await expect(page.getByText("NGN 1,000.00 · 1 orders")).toBeVisible();
    await expect(
      page.getByText("2 issued admissions", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toContainText(order.reference);
    await page.getByRole("combobox").nth(0).selectOption("admissions");
    await page.getByRole("combobox").nth(1).selectOption("not_checked_in");
    await page
      .getByLabel("Buyer name, exact email or reference")
      .fill("synthetic-report@example.test");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      page.getByText("2 matching admissions.", { exact: false }),
    ).toBeVisible();
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export all matching admissions (CSV)" })
      .click();
    const download = await pending;
    const path = await download.path();
    expect(path).not.toBeNull();
    const contents = await readFile(path!, "utf8");
    expect(contents).toContain('"Text: =1+1"');
    expect(contents).toContain('"synthetic-report@example.test"');
    expect(contents).not.toContain("tsq_test_v1_");
    expect(contents.split("\r\n")).toHaveLength(4);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM admin_audit WHERE actor_id=$1 AND action='report.export.admissions'",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.screenshot({
      path: test.info().outputPath("organizer-report.png"),
      fullPage: true,
    });
    // A staff assignment alone never authorizes reports, even with the same verified session.
    await pool.query(
      "INSERT INTO event_staff(event_id,user_id) VALUES ($1,$2)",
      [event.id, id],
    );
    await pool.query("UPDATE organizers SET active=false WHERE user_id=$1", [
      id,
    ]);
    expect((await post(api, { export: true })).status()).toBe(404);
  } finally {
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
