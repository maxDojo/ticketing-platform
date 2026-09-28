import { AccessError } from "./access";
import { env } from "@/config/server";
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== env.APP_URL)
    throw new AccessError(403, "Request origin rejected.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AccessError(415, "Send JSON.");
}
export async function readJson(request: Request) {
  // Bound actual streamed bytes; Content-Length is not trusted.
  if (!request.body) throw new AccessError(400, "Request body is required.");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      throw new AccessError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AccessError(400, "Invalid JSON.");
  }
}
export function failure(error: unknown) {
  const status = error instanceof AccessError ? error.status : 500;
  return Response.json(
    {
      error:
        error instanceof AccessError
          ? error.message
          : "Unable to complete this request. Please try again.",
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
