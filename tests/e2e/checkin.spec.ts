import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { URI } from "otpauth";
import QRCode from "qrcode";
import { databaseConfig } from "../../src/config/database";
import { createOrder } from "../../src/modules/orders/service";
import { confirmPayment } from "../../src/modules/payments/confirmation";
import { guestTickets } from "../../src/modules/tickets/guest";
if (existsSync(".env.local")) loadEnvFile(".env.local");
process.env.TICKET_ACTIVE_KEY_ID = "browser";
process.env.TICKET_ENCRYPTION_KEYS = JSON.stringify({
  browser: "42".repeat(32),
});
const origin = "http://127.0.0.1:3100";
const url = process.env.MIGRATION_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw Error("Local browser fixture database required");
const pool = new Pool(databaseConfig(url));
test.afterAll(() => pool.end());
test("staff MFA, actual QR decoding, duplicate scans, manual admission and failure handling", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const userId = randomUUID(),
    email = `gate-${userId}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const {
    rows: [event],
  } = await pool.query(
    "INSERT INTO events(slug,name,venue,timezone,starts_at,status) VALUES ($1,'Gate test event','Lagos','Africa/Lagos',now()+interval '7 days','published') RETURNING id",
    [`gate-${randomUUID()}`],
  );
  const {
    rows: [other],
  } = await pool.query(
    "INSERT INTO events(slug,name,venue,timezone,starts_at,status) VALUES ($1,'Other event','Lagos','Africa/Lagos',now()+interval '7 days','published') RETURNING id",
    [`gate-${randomUUID()}`],
  );
  const post = (body: object) =>
    context.request.post(`/api/staff/events/${event.id}`, {
      data: body,
      headers: { Origin: origin },
    });
  try {
    await pool.query(
      "INSERT INTO auth_user(id,name,email,\"emailVerified\") VALUES ($1,'Gate staff',$2,true)",
      [userId, email],
    );
    await pool.query(
      'INSERT INTO auth_account(id,"accountId","providerId","userId",password) VALUES ($1,$2,\'credential\',$2,$3)',
      [randomUUID(), userId, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO event_staff(event_id,user_id) VALUES ($1,$2)",
      [event.id, userId],
    );
    const {
      rows: [type],
    } = await pool.query(
      "INSERT INTO ticket_types(event_id,name,unit_price,capacity,admissions_per_unit) VALUES ($1,'Group',100000,10,2) RETURNING id",
      [event.id],
    );
    const guest = randomBytes(32).toString("hex");
    const order = await createOrder(pool, guest, {
      eventId: event.id,
      requestKey: randomUUID(),
      buyerName: "Gate Synthetic Buyer",
      buyerEmail: `buyer-${userId}@example.test`,
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
    const wallet = await guestTickets(pool, guest, order.id);
    const qr = await QRCode.toDataURL(wallet.tickets[0]!.token!, {
      width: 400,
      margin: 4,
    });
    // Feed a real generated QR image into a synthetic camera stream. The actual UI decoder runs.
    await page.addInitScript(
      ({ qr }) => {
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async () => {
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 480;
            const ctx = canvas.getContext("2d")!;
            const image = new Image();
            image.src = qr;
            await image.decode();
            const draw = () => {
              ctx.fillStyle = "white";
              ctx.fillRect(0, 0, 640, 480);
              ctx.drawImage(image, 120, 40, 400, 400);
            };
            draw();
            const stream = canvas.captureStream(5);
            const timer = setInterval(draw, 200);
            const track = stream.getVideoTracks()[0]!;
            const stop = track.stop.bind(track);
            track.stop = () => {
              clearInterval(timer);
              stop();
            };
            return stream;
          },
        });
      },
      { qr },
    );
    expect((await post({ action: "lookup" })).status()).toBe(401);
    await page.goto("/staff/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Protect your account" }),
    ).toBeVisible();
    expect((await post({ action: "lookup" })).status()).toBe(403);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const enrollmentPromise = page.waitForResponse((r) =>
      r.url().endsWith("/two-factor/enable"),
    );
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const enrollment = await (await enrollmentPromise).json();
    await page
      .getByLabel("Authenticator code", { exact: true })
      .fill(URI.parse(enrollment.totpURI).generate());
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Event check-in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Other event", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await context.request.post(`/api/staff/events/${other.id}`, {
          data: { action: "lookup" },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.post("/api/admin/events", {
          data: {},
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post(`/api/staff/events/${event.id}`, {
          data: { action: "lookup" },
          headers: { Origin: "https://attacker.example" },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole("link", { name: "Gate test event", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Admitted — test check-in recorded" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Already checked in — do not admit again",
      }),
    ).toBeVisible();
    await page.getByLabel("Buyer or reference").fill(order.reference);
    await page.getByRole("button", { name: "Search admissions" }).click();
    await expect(
      page.getByText("1 admissions checked in.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review manual check-in" })
      .filter({ visible: true })
      .all()
      .then(async (buttons) => {
        for (const button of buttons) {
          if (await button.isEnabled()) {
            await button.click();
            break;
          }
        }
      });
    await page
      .getByLabel("Reason for manual check-in")
      .fill("Damaged QR verified by supervisor");
    await page
      .getByRole("button", { name: "Confirm manual admission" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Admitted — test check-in recorded" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Refresh check-in history" })
      .click();
    await expect(
      page.getByText("2 admissions checked in.", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("gate-check-in.png"),
      fullPage: true,
    });
    await page.route(`**/api/staff/events/${event.id}`, (route) =>
      route.abort(),
    );
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "QR scanner" }).getByRole("alert"),
    ).toContainText("Unable to confirm admission");
    await expect(
      page.getByRole("heading", { name: "Admitted — test check-in recorded" }),
    ).toHaveCount(0);
    await page.unroute(`**/api/staff/events/${event.id}`);
    await pool.query("UPDATE event_staff SET active=false WHERE user_id=$1", [
      userId,
    ]);
    expect(
      (await post({ method: "qr", token: wallet.tickets[0]!.token })).status(),
    ).toBe(404);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM check_ins WHERE event_id=$1",
          [event.id],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await pool.query("DELETE FROM admin_audit WHERE actor_id=$1", [userId]);
    await pool.query("DELETE FROM check_ins WHERE event_id=$1", [event.id]);
    await pool.query("DELETE FROM event_staff WHERE user_id=$1", [userId]);
    await pool.query(
      "DELETE FROM ticket_delivery_jobs WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)",
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
        `DELETE FROM ${table} WHERE payment_id IN (SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.event_id=$1)`,
        [event.id],
      );
    for (const table of ["payments", "reservations", "checkout_requests"])
      await pool.query(
        `DELETE FROM ${table} WHERE order_id IN (SELECT id FROM orders WHERE event_id=$1)`,
        [event.id],
      );
    for (const table of ["order_items", "orders", "ticket_types"])
      await pool.query(`DELETE FROM ${table} WHERE event_id=$1`, [event.id]);
    await pool.query("DELETE FROM events WHERE id IN ($1,$2)", [
      event.id,
      other.id,
    ]);
    for (const table of ["auth_session", "auth_two_factor", "auth_account"])
      await pool.query(`DELETE FROM ${table} WHERE "userId"=$1`, [userId]);
    await pool.query("DELETE FROM auth_user WHERE id=$1", [userId]);
  }
});
