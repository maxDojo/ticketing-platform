import { getAuth } from "@/modules/auth/server";
import { getPool } from "@/db/client";
import { consumeLimit } from "@/modules/auth/throttle";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { requireOrganizer } from "@/modules/auth/access";
const paths = new Set([
  "sign-in/email",
  "sign-out",
  "get-session",
  "two-factor/enable",
  "two-factor/verify-totp",
  "two-factor/verify-backup-code",
  "change-password",
  "revoke-sessions",
]);
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname.replace("/api/auth/", "");
    if (
      !paths.has(path) ||
      (request.method === "GET" && path !== "get-session")
    )
      return new Response(null, { status: 404 });
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
        const actor = await requireOrganizer(request.headers, true);
        if (actor.twoFactorEnabled) await requireOrganizer(request.headers);
      }
      if (["change-password", "revoke-sessions"].includes(path))
        await requireOrganizer(request.headers);
      body.trustDevice = false;
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
      });
    }
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return failure(error);
  }
}
export const GET = handle;
export const POST = handle;
