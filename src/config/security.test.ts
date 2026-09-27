import { expect, it } from "vitest";
import { contentSecurityPolicy } from "./security";
it("restricts production scripts to a nonce without eval or inline-script bypasses", () => {
  const policy = contentSecurityPolicy("test-nonce", false);
  const scripts = policy
    .split("; ")
    .find((part) => part.startsWith("script-src"));
  expect(scripts).toContain("'nonce-test-nonce'");
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).not.toContain("'unsafe-eval'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
});
it("limits development-only eval to development", () => {
  expect(contentSecurityPolicy("test-nonce", true)).toContain("'unsafe-eval'");
});
