import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { databaseConfig } from "../../src/config/database";
import { URI } from "otpauth";
if (existsSync(".env.local")) loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3100";
const adminUrl = process.env.MIGRATION_DATABASE_URL;
if (
  !adminUrl ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)
)
  throw new Error(
    "Browser fixtures require an explicit local migration database",
  );
const pool = new Pool(databaseConfig(adminUrl));

test.afterAll(async () => {
  await pool.end();
});
test("organizer MFA, private drafts, ticket management, publishing and ownership", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const id = randomUUID();
  const otherId = randomUUID();
  const email = `test-${id}@example.test`;
  const password = `Synthetic-only-${randomUUID()}`;
  const slug = `test-${id}`;
  await pool.query(
    "INSERT INTO auth_user (id,name,email,\"emailVerified\") VALUES ($1,'Test Organizer',$2,true),($3,'Other Organizer',$4,true)",
    [id, email, otherId, `test-${otherId}@example.test`],
  );
  await pool.query(
    'INSERT INTO auth_account (id,"accountId","providerId","userId",password) VALUES ($1,$2,\'credential\',$2,$3)',
    [randomUUID(), id, await hashPassword(password)],
  );
  await pool.query("INSERT INTO organizers (user_id) VALUES ($1),($2)", [
    id,
    otherId,
  ]);
  const post = (path: string, data: object) =>
    context.request.post(path, { data, headers: { Origin: origin } });
  try {
    expect(
      (
        await post("/api/auth/sign-up/email", {
          email,
          password,
          name: "Bypass",
        })
      ).status(),
    ).toBe(404);
    expect((await post("/api/admin/events", {})).status()).toBe(401);
    await page.goto("/admin/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Protect your account" }),
    ).toBeVisible();
    expect((await post("/api/admin/events", {})).status()).toBe(403);
    const preEnrollmentCookies = await context.cookies();
    await page.getByLabel("Password", { exact: true }).fill(password);
    const enrollmentPromise = page.waitForResponse((r) =>
      r.url().endsWith("/two-factor/enable"),
    );
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const enrollment = await (await enrollmentPromise).json();
    const code = URI.parse(enrollment.totpURI).generate();
    await page.getByLabel("Authenticator code", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Your events", exact: true }),
    ).toBeVisible();
    const stale = await context.browser()!.newContext();
    try {
      await stale.addCookies(preEnrollmentCookies);
      for (const [path, data] of [
        ["/api/admin/events", {}],
        ["/api/auth/two-factor/enable", { password }],
      ] as const) {
        const response = await stale.request.post(`${origin}${path}`, {
          data,
          headers: { Origin: origin },
        });
        // Better Auth may revoke the enrollment session when rotating its token.
        expect([401, 403]).toContain(response.status());
      }
    } finally {
      await stale.close();
    }
    await page.getByRole("link", { name: "Create event", exact: true }).click();
    await page
      .getByLabel("Event name", { exact: true })
      .fill("Lagos After Hours");
    await page.getByLabel("Public URL slug").fill(slug);
    await page
      .getByLabel("Description", { exact: true })
      .fill("An evening of music and shared experiences.");
    await page
      .getByLabel("Venue and location")
      .fill("Harbour Hall, Victoria Island, Lagos");
    await page
      .getByLabel("Starts at (event local time)")
      .fill("2030-12-19T18:00");
    await page.getByLabel("Reservation duration (minutes)").fill("25");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(
      page.getByRole("heading", { name: "Lagos After Hours", exact: true }),
    ).toBeVisible();
    const eventId = page.url().split("/").pop()!;
    const outsider = await context.browser()!.newContext();
    try {
      expect(
        (await outsider.request.get(`${origin}/events/${slug}`)).status(),
      ).toBe(404);
    } finally {
      await outsider.close();
    }
    await page.getByLabel("Ticket name", { exact: true }).fill("Table for six");
    await page.getByLabel("Price per unit (₦)").fill("60000.01");
    await page.getByLabel("People admitted per unit").fill("6");
    await page
      .getByRole("button", { name: "Add ticket type", exact: true })
      .click();
    await expect(page.getByText(/Table for six · 0 sold/)).toBeVisible();
    await page
      .getByRole("button", { name: "Publish event", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unpublish event", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("organizer.png"),
      fullPage: true,
    });
    const publicPage = await context.newPage();
    await publicPage.goto(`/events/${slug}`);
    await publicPage.screenshot({
      path: test.info().outputPath("public-event.png"),
      fullPage: true,
    });
    await publicPage.close();
    const publicResponse = await context.request.get(`/events/${slug}`);
    expect(publicResponse.status()).toBe(200);
    const html = await publicResponse.text();
    expect(html).toContain("60,000.01");
    expect(html).toContain("Includes");
    expect(html).toContain("separate admissions");
    const crossEvent = (
      await pool.query(
        "INSERT INTO events (slug,name,venue,timezone,starts_at,organizer_id) VALUES ($1,'Other private event','Lagos','Africa/Lagos',now()+interval '1 day',$2) RETURNING id",
        [`test-${otherId}`, otherId],
      )
    ).rows[0].id;
    expect(
      (
        await post(`/api/admin/events/${crossEvent}/publish`, { publish: true })
      ).status(),
    ).toBe(404);
    expect(
      (await context.request.get(`/admin/events/${crossEvent}`)).status(),
    ).toBe(404);
    expect(
      (
        await context.request.get(
          `/events/test-${otherId}?preview=${crossEvent}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.post(`/api/admin/events/${eventId}/publish`, {
          data: { publish: false },
          headers: { Origin: "https://evil.example" },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "Unpublish event", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Publish event", exact: true }),
    ).toBeVisible();
    expect((await context.request.get(`/events/${slug}`)).status()).toBe(404);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in/);
    // Password alone must never regain organizer access after MFA enrollment.
    const login = await post("/api/auth/sign-in/email", {
      email,
      password,
      rememberMe: false,
    });
    expect(login.status()).toBe(200);
    expect((await login.json()).twoFactorRedirect).toBe(true);
    expect(
      (
        await post(`/api/admin/events/${eventId}/publish`, { publish: true })
      ).status(),
    ).toBe(401);
    expect(
      (
        await post("/api/auth/two-factor/verify-backup-code", {
          code: enrollment.backupCodes[0],
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await post(`/api/admin/events/${eventId}/publish`, { publish: true })
      ).ok(),
    ).toBe(true);
    // Revocation is checked at every service boundary, not cached in a browser token.
    await pool.query("UPDATE organizers SET active=false WHERE user_id=$1", [
      id,
    ]);
    expect(
      (
        await post(`/api/admin/events/${eventId}/publish`, { publish: false })
      ).status(),
    ).toBe(403);
  } finally {
    await pool.query("DELETE FROM admin_audit WHERE actor_id=ANY($1::text[])", [
      [id, otherId],
    ]);
    await pool.query(
      "DELETE FROM ticket_types WHERE event_id IN (SELECT id FROM events WHERE organizer_id=ANY($1::text[]))",
      [[id, otherId]],
    );
    await pool.query("DELETE FROM events WHERE organizer_id=ANY($1::text[])", [
      [id, otherId],
    ]);
    await pool.query("DELETE FROM organizers WHERE user_id=ANY($1::text[])", [
      [id, otherId],
    ]);
    await pool.query("DELETE FROM auth_user WHERE id=ANY($1::text[])", [
      [id, otherId],
    ]);
  }
});
