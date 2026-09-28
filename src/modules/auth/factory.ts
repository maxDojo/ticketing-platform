import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";

export function createAuth(pool: Pool, baseURL: string, secret: string) {
  return betterAuth({
    appName: "TicketSquare",
    baseURL,
    secret,
    database: pool,
    trustedOrigins: [baseURL],
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 14,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 15,
      cookieCache: { enabled: false },
      additionalFields: {
        mfaVerified: { type: "boolean", defaultValue: false, input: false },
      },
    },
    advanced: {
      useSecureCookies: baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: [] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 60,
      // Until deployment establishes a trusted proxy, this is a shared bucket.
      // The HTTP adapter separately enforces atomic per-identity limits.
      customRules: {
        "/sign-in/email": { window: 60, max: 60 },
        "/two-factor/*": { window: 60, max: 60 },
      },
    },
    plugins: [
      twoFactor({
        issuer: "TicketSquare",
        schema: { twoFactor: { modelName: "auth_two_factor" } },
      }),
    ],
    logger: { disabled: true },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (
          ![
            "/two-factor/verify-totp",
            "/two-factor/verify-backup-code",
          ].includes(ctx.path)
        )
          return;
        const result = ctx.context.returned as
          { token?: string; user?: { id: string } } | undefined;
        if (!result?.token || !result.user) return;
        const verified = ctx.context.newSession ?? ctx.context.session;
        if (!verified || verified.user.id !== result.user.id) return;
        // A verified account flag alone is insufficient: each session must finish MFA.
        await pool.query(
          'UPDATE auth_session SET "mfaVerified"=true WHERE token=$1 AND "userId"=$2',
          [verified.session.token, result.user.id],
        );
      }),
    },
  });
}
