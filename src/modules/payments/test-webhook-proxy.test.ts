import { afterEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestWebhookProxy } from "./test-webhook-proxy";

const secret = `sk_test_${randomBytes(16).toString("hex")}`;
const body = '{"event":"charge.success","data":{"domain":"test"}}';
const sign = (value: string) =>
  createHmac("sha512", secret).update(value).digest("hex");
const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});
async function setup(status = 200) {
  const received: {
    url: string | undefined;
    body: string;
    headers: Record<string, unknown>;
  }[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({
      url: req.url,
      body: Buffer.concat(chunks).toString(),
      headers: req.headers,
    });
    res.writeHead(status, {
      "Set-Cookie": "private=value",
      Location: "/admin",
    });
    res.end("private upstream details");
  });
  const port = await listen(upstream);
  const proxyPort = await listen(createTestWebhookProxy(secret, port));
  const url = `http://127.0.0.1:${proxyPort}`;
  return { url, received, upstream };
}
describe("local webhook-only test proxy", () => {
  it("rejects live keys and invalid ports", () => {
    expect(() => createTestWebhookProxy("sk_live_notallowed123")).toThrow();
    expect(() => createTestWebhookProxy(secret, 0)).toThrow();
  });
  it("forwards unchanged signed bytes only, strips sensitive headers and response data", async () => {
    const { url, received } = await setup();
    const response = await fetch(`${url}/api/paystack/webhook`, {
      method: "POST",
      body,
      headers: {
        "x-paystack-signature": sign(body),
        Cookie: "session=secret",
        Authorization: "Bearer secret",
        "X-Forwarded-Host": "attacker.example",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(received).toHaveLength(1);
    expect(received[0]?.body).toBe(body);
    expect(received[0]?.url).toBe("/api/paystack/webhook");
    for (const header of ["cookie", "authorization", "x-forwarded-host"])
      expect(received[0]?.headers[header]).toBeUndefined();
  });
  it("blocks other paths, query strings and methods before contacting upstream", async () => {
    const { url, received } = await setup();
    for (const path of [
      "/",
      "/admin",
      "/api/auth/session",
      "/api/paystack/webhook/",
      "/api/paystack/webhook?x=1",
      "/api/paystack/%77ebhook",
    ])
      expect(
        (
          await fetch(url + path, {
            method: "POST",
            body,
            headers: { "x-paystack-signature": sign(body) },
          })
        ).status,
      ).toBe(404);
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT"])
      expect(
        (await fetch(`${url}/api/paystack/webhook`, { method })).status,
      ).toBe(405);
    expect(received).toHaveLength(0);
  });
  it("rejects absent, malformed and tampered signatures", async () => {
    const { url, received } = await setup();
    for (const headers of [
      new Headers(),
      new Headers({ "x-paystack-signature": "bad" }),
      new Headers({ "x-paystack-signature": sign(body + " ") }),
    ])
      expect(
        (
          await fetch(`${url}/api/paystack/webhook`, {
            method: "POST",
            body,
            headers,
          })
        ).status,
      ).toBe(401);
    expect(received).toHaveLength(0);
  });
  it("rejects oversized and encoded bodies without forwarding", async () => {
    const { url, received } = await setup();
    const large = "a".repeat(65537);
    expect(
      (
        await fetch(`${url}/api/paystack/webhook`, {
          method: "POST",
          body: large,
          headers: { "x-paystack-signature": sign(large) },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await fetch(`${url}/api/paystack/webhook`, {
          method: "POST",
          body,
          headers: {
            "x-paystack-signature": sign(body),
            "content-encoding": "gzip",
          },
        })
      ).status,
    ).toBe(415);
    expect(received).toHaveLength(0);
  });
  it("times out an unfinished body without forwarding", async () => {
    const { url, received } = await setup();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${url}/api/paystack/webhook`,
        {
          method: "POST",
          headers: { "x-paystack-signature": sign(body) },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
          request.destroy();
        },
      );
      request.on("error", reject);
      request.write("{");
    });
    expect(status).toBe(408);
    expect(received).toHaveLength(0);
  }, 8000);
  it.each([302, 400, 500])(
    "does not acknowledge upstream status %i or follow redirects",
    async (status) => {
      const { url, received } = await setup(status);
      const response = await fetch(`${url}/api/paystack/webhook`, {
        method: "POST",
        body,
        headers: { "x-paystack-signature": sign(body) },
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ received: false });
      expect(received).toHaveLength(1);
    },
  );
});
