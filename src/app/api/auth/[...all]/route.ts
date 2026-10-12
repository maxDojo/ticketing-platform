import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError } from "@/modules/auth/access";
import { getAuth } from "@/modules/auth/server";
import { getPool } from "@/db/client";
import { consumeLimit } from "@/modules/auth/throttle";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { requireStaffAccount } from "@/modules/checkin/http";
const paths = new Set([
  "sign-in/email",
  "sign-out",
  "get-session",
  "two-factor/enable",
  "two-factor/verify-totp",
  "two-factor/verify-backup-code",
  "change-password",
  "revoke-sessions",
  "revoke-other-sessions",
]);
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname.replace("/api/auth/", "");
    if (
      !paths.has(path) ||
      (request.method === "GET" && path !== "get-session")
    )
      return new Response(null, { status: 404 });
    let securityAudit:
      { actor: string; operation: string; path: string } | undefined;
    if (request.method === "POST") {
      checkOrigin(request);
      const body = (await readJson(request)) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body))
        return Response.json({ error: "Invalid request." }, { status: 400 });
      if (!(await consumeLimit(getPool(), "auth-global", 300, 60)))
        return Response.json(
          { error: "Too many attempts. Try again later." },
          { status: 429 },
        );
      const identity =
        typeof body.email === "string"
          ? body.email.trim().toLowerCase()
          : (request.headers.get("cookie") ?? "anonymous");
      if (!(await consumeLimit(getPool(), `auth:${path}:${identity}`, 10, 900)))
        return Response.json(
          { error: "Too many attempts. Try again later." },
          { status: 429 },
        );
      if (path === "two-factor/enable") {
        const actor = await requireStaffAccount(request.headers, true);
        if (actor.twoFactorEnabled) await requireStaffAccount(request.headers);
      }
      if (
        [
          "change-password",
          "revoke-sessions",
          "revoke-other-sessions",
        ].includes(path)
      ) {
        const actor = await requireStaffAccount(request.headers);
        if (path === "change-password") {
          const parsed = z
            .object({
              currentPassword: z.string().min(1).max(128),
              newPassword: z.string().min(14).max(128),
              revokeOtherSessions: z.boolean().optional(),
            })
            .strict()
            .safeParse(body);
          if (!parsed.success)
            throw new AccessError(
              400,
              "Use a password between 14 and 128 characters.",
            );
          // The caller cannot opt out of revoking old sessions on a password change.
          body.revokeOtherSessions = true;
        } else if (Object.keys(body).length)
          throw new AccessError(400, "Invalid request.");
        securityAudit = { actor: actor.userId, operation: randomUUID(), path };
        await getPool().query(
          "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,$2,$3)",
          [actor.userId, `security.${path}.requested`, securityAudit.operation],
        );
      }
      body.trustDevice = false;
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
      });
    }
    const response = await getAuth().handler(request);
    if (securityAudit && response.ok) {
      await getPool().query(
        "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,$2,$3)",
        [
          securityAudit.actor,
          `security.${securityAudit.path}.completed`,
          securityAudit.operation,
        ],
      );
      // Preserve auth cookies but never expose the rotated session token in JSON.
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("content-length");
      responseHeaders.set("Cache-Control", "private, no-store");
      return Response.json({ success: true }, { headers: responseHeaders });
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return failure(error);
  }
}
export const GET = handle;
export const POST = handle;
