import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env";

describe("environment validation", () => {
  it("requires explicit application origin", () => {
    expect(() => parseEnvironment({})).toThrow("APP_URL");
  });
  it.each([
    "not-a-url-containing-secret",
    "",
    "javascript:alert(1)",
    "https://example.com/path",
    "https://example.com?token=secret",
    "https://user:secret@example.com",
    "https://example.com/#fragment",
  ])("rejects unsafe or non-origin URL %s", (APP_URL) => {
    expect(() => parseEnvironment({ NODE_ENV: "production", APP_URL })).toThrow(
      /^Invalid environment configuration: APP_URL$/,
    );
  });
  it("rejects insecure remote production origins without leaking values", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        APP_URL: "http://private.example.com",
      }),
    ).toThrow(/^Invalid environment configuration: APP_URL$/);
  });
  it("allows production HTTPS and loopback production smoke testing", () => {
    expect(
      parseEnvironment({
        NODE_ENV: "production",
        APP_URL: "https://ticketsquare.ng",
      }).APP_URL,
    ).toBe("https://ticketsquare.ng");
    expect(
      parseEnvironment({
        NODE_ENV: "production",
        APP_URL: "http://127.0.0.1:3000",
      }).NODE_ENV,
    ).toBe("production");
  });
});
