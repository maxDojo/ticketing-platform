import { test, expect, type BrowserContext } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { URI } from "otpauth";
import { databaseConfig } from "../../src/config/database";
if (existsSync(".env.local")) loadEnvFile(".env.local");
const url = process.env.MIGRATION_DATABASE_URL,
  origin = "http://127.0.0.1:3100";
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw Error("Local browser database required");
const pool = new Pool(databaseConfig(url));
test.afterAll(() => pool.end());
for (const role of ["organizer", "staff"] as const)
  test(`${role} can manage sessions and change password without bypassing MFA`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(150000);
    const id = randomUUID(),
      outsider = randomUUID(),
      email = `security-${id}@example.test`,
      password = `Synthetic-${randomUUID()}`,
      nextPassword = `Updated-${randomUUID()}`;
    const area = role === "staff" ? "/staff" : "/admin";
    let eventId: string | undefined;
    const post = async (c: BrowserContext, path: string, data: object) => {
      for (let attempt = 0; ; attempt++) {
        const response = await c.request.post(`${origin}/api/auth/${path}`, {
          data,
          headers: { Origin: origin },
        });
        if (
          response.status() !== 429 ||
          path !== "change-password" ||
          attempt >= 5
        )
          return response;
        // Browser projects share loopback; honor the provider's stricter shared limit.
        const retry = Number(response.headers()["retry-after"] ?? 10);
        await delay((Math.min(15, Math.max(1, retry)) + 1) * 1000);
      }
    };
    const other = await browser.newContext();
    try {
      await pool.query(
        "INSERT INTO auth_user(id,name,email,\"emailVerified\") VALUES ($1,'Security test',$2,true),($3,'Unrelated test',$4,true)",
        [id, email, outsider, `${outsider}@example.test`],
      );
      await pool.query(
        'INSERT INTO auth_account(id,"accountId","providerId","userId",password) VALUES ($1,$2,\'credential\',$2,$3)',
        [randomUUID(), id, await hashPassword(password)],
      );
      await pool.query(
        'INSERT INTO auth_session(id,token,"userId","expiresAt") VALUES ($1,$2,$3,now()+interval \'1 hour\')',
        [randomUUID(), randomUUID(), outsider],
      );
      if (role === "organizer")
        await pool.query("INSERT INTO organizers(user_id) VALUES ($1)", [id]);
      else {
        eventId = (
          await pool.query(
            "INSERT INTO events(slug,name,venue,timezone,starts_at) VALUES ($1,'Security fixture','Local','Africa/Lagos',now()+interval '7 days') RETURNING id",
            [randomUUID()],
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO event_staff(user_id,event_id) VALUES ($1,$2)",
          [id, eventId],
        );
      }
      expect((await post(context, "revoke-other-sessions", {})).status()).toBe(
        401,
      );
      expect(
        (
          await post(context, "sign-in/email", {
            email,
            password,
            rememberMe: false,
          })
        ).status(),
      ).toBe(200);
      for (const [path, body] of [
        ["revoke-other-sessions", {}],
        ["revoke-sessions", {}],
        [
          "change-password",
          { currentPassword: password, newPassword: nextPassword },
        ],
      ] as const) {
        expect((await post(context, path, body)).status()).toBe(403);
      }
      const enrollment = await (
        await post(context, "two-factor/enable", { password })
      ).json();
      expect(
        (
          await post(context, "two-factor/verify-totp", {
            code: URI.parse(enrollment.totpURI).generate(),
          })
        ).status(),
      ).toBe(200);
      await page.goto(`${area}/security`);
      await expect(
        page.getByRole("heading", { name: "Account security", exact: true }),
      ).toBeVisible();
      expect(
        (
          await context.request.post(
            `${origin}/api/auth/revoke-other-sessions`,
            { data: {}, headers: { Origin: "https://attacker.example" } },
          )
        ).status(),
      ).toBe(403);
      expect(
        (
          await post(context, "revoke-other-sessions", { userId: outsider })
        ).status(),
      ).toBe(400);
      expect(
        (
          await post(other, "sign-in/email", {
            email,
            password,
            rememberMe: false,
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await post(other, "two-factor/verify-backup-code", {
            code: enrollment.backupCodes[0],
          })
        ).status(),
      ).toBe(200);
      await page
        .getByRole("button", { name: "Sign out other sessions", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Other sessions have been signed out",
      );
      expect((await post(other, "revoke-sessions", {})).status()).toBe(401);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM auth_session WHERE "userId"=$1',
            [outsider],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await post(other, "sign-in/email", {
            email,
            password,
            rememberMe: false,
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await post(other, "two-factor/verify-backup-code", {
            code: enrollment.backupCodes[1],
          })
        ).status(),
      ).toBe(200);
      // The server forces revocation even if a modified client requests false.
      const rejected = await post(context, "change-password", {
        currentPassword: "Incorrect-password",
        newPassword: nextPassword,
        revokeOtherSessions: false,
      });
      expect(rejected.status()).toBe(400);
      await page.getByLabel("Current password", { exact: true }).fill(password);
      await page.getByLabel("New password", { exact: true }).fill(nextPassword);
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill(nextPassword);
      let response;
      for (let attempt = 0; attempt < 6; attempt++) {
        const resultPromise = page.waitForResponse((r) =>
          r.url().endsWith("/change-password"),
        );
        await page
          .getByRole("button", { name: "Change password", exact: true })
          .click();
        response = await resultPromise;
        if (response.status() !== 429) break;
        await delay(
          (Math.min(
            15,
            Math.max(1, Number(response.headers()["retry-after"] ?? 10)),
          ) +
            1) *
            1000,
        );
      }
      if (!response) throw Error("No password change response");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      await expect(page.getByRole("status")).toContainText("Password changed");
      expect((await post(other, "revoke-sessions", {})).status()).toBe(401);
      expect((await post(context, "revoke-other-sessions", {})).status()).toBe(
        403,
      );
      await page
        .getByRole("button", { name: "Use a recovery code", exact: true })
        .click();
      await page
        .getByLabel("Recovery code", { exact: true })
        .fill(enrollment.backupCodes[2]);
      await page.getByRole("button", { name: "Verify and continue" }).click();
      await expect(page).toHaveURL(
        new RegExp(`${area}${role === "organizer" ? "/events" : ""}$`),
      );
      await page.goto(`${area}/security`);
      // Exercise a caller-supplied false directly as well as the real browser form.
      const rotated = await post(context, "change-password", {
        currentPassword: nextPassword,
        newPassword: password,
        revokeOtherSessions: false,
      });
      expect(rotated.status()).toBe(200);
      expect(await rotated.json()).toEqual({ success: true });
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM auth_session WHERE "userId"=$1',
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect((await post(context, "revoke-sessions", {})).status()).toBe(403);
      expect(
        (
          await post(context, "two-factor/verify-backup-code", {
            code: enrollment.backupCodes[3],
          })
        ).status(),
      ).toBe(200);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Account security", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`${role}-security.png`),
        fullPage: true,
      });
      await page
        .getByLabel("I understand this will also sign me out of this browser.")
        .check();
      await page
        .getByRole("button", { name: "Sign out everywhere", exact: true })
        .click();
      await expect(page).toHaveURL(`${origin}${area}/sign-in`);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM auth_session WHERE "userId"=$1',
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM admin_audit WHERE actor_id=$1 AND action='security.change-password.completed'",
            [id],
          )
        ).rows[0].n,
      ).toBe(2);
      expect(
        (
          await post(other, "sign-in/email", {
            email,
            password: nextPassword,
            rememberMe: false,
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await post(other, "sign-in/email", {
            email,
            password,
            rememberMe: false,
          })
        ).status(),
      ).toBe(200);
    } finally {
      await other.close().catch(() => {});
      await pool.query("DELETE FROM admin_audit WHERE actor_id=$1", [id]);
      await pool.query("DELETE FROM event_staff WHERE user_id=$1", [id]);
      if (eventId)
        await pool.query("DELETE FROM events WHERE id=$1", [eventId]);
      await pool.query("DELETE FROM organizers WHERE user_id=$1", [id]);
      for (const table of ["auth_session", "auth_two_factor", "auth_account"])
        await pool.query(`DELETE FROM ${table} WHERE "userId" IN($1,$2)`, [
          id,
          outsider,
        ]);
      await pool.query("DELETE FROM auth_user WHERE id IN($1,$2)", [
        id,
        outsider,
      ]);
    }
  });
