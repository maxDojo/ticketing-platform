import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const path = "/api/paystack/webhook";
const limit = 65536;

function reply(response: ServerResponse, status: number) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(JSON.stringify({ received: status === 200 }));
}

function readBody(request: IncomingMessage, response: ServerResponse) {
  return new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (body: Buffer | null, status?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (status) reply(response, status);
      resolve(body);
    };
    const timer = setTimeout(() => finish(null, 408), 5000);
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) finish(null, 413);
      else chunks.push(chunk);
    });
    request.on("end", () => finish(Buffer.concat(chunks)));
    request.on("error", () => finish(null));
    request.on("aborted", () => finish(null));
  });
}

// Local test utility only. The destination host/path are deliberately fixed.
export function createTestWebhookProxy(secret: string, upstreamPort = 3000) {
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(secret))
    throw new Error("A test secret is required");
  if (
    !Number.isInteger(upstreamPort) ||
    upstreamPort < 1 ||
    upstreamPort > 65535
  )
    throw new Error("Invalid local port");
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    async function handle() {
      if (request.url !== path) return reply(response, 404);
      if (request.method !== "POST") return reply(response, 405);
      const signature = request.headers["x-paystack-signature"];
      if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature))
        return reply(response, 401);
      if (request.headers["content-encoding"]) return reply(response, 415);
      const body = await readBody(request, response);
      if (!body) return;
      const expected = createHmac("sha512", secret).update(body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
        return reply(response, 401);
      // Never forward cookies, authorization, Host or proxy headers from callers.
      const upstream = await fetch(`http://127.0.0.1:${upstreamPort}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
        body: new Uint8Array(body),
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      await upstream.body?.cancel();
      // No upstream response headers, payloads or redirects reach the public side.
      reply(response, upstream.status === 200 ? 200 : 502);
    }
    void handle().catch(() => {
      if (!response.headersSent && !response.destroyed) reply(response, 502);
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.timeout = 15000;
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 1;
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  return server;
}
