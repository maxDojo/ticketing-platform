import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { newCredential, openCredential, ticketKeys } from "./credentials";
const keys = { active: "one", keys: { one: randomBytes(32).toString("hex") } };
it("uses unique random credentials and preserves them across key rotation", () => {
  const id = randomUUID();
  const a = newCredential(id, keys);
  const b = newCredential(id, keys);
  expect(a.hash).not.toBe(b.hash);
  expect(a.ciphertext).not.toContain(a.hash);
  const token = openCredential(a.ciphertext, id, a.keyId, a.hash, keys);
  expect(token).toMatch(/^tsq_test_v1_/);
  expect(
    openCredential(a.ciphertext, id, a.keyId, a.hash, {
      active: "two",
      keys: { ...keys.keys, two: randomBytes(32).toString("hex") },
    }),
  ).toBe(token);
});
it("rejects changed ciphertext, swapped ticket identity, missing keys and hash mismatch", () => {
  const id = randomUUID();
  const a = newCredential(id, keys);
  expect(() =>
    openCredential(a.ciphertext, randomUUID(), a.keyId, a.hash, keys),
  ).toThrow();
  expect(() =>
    openCredential(a.ciphertext, id, a.keyId, "0".repeat(64), keys),
  ).toThrow();
  expect(() =>
    openCredential(a.ciphertext, id, a.keyId, a.hash, {
      active: "two",
      keys: { two: randomBytes(32).toString("hex") },
    }),
  ).toThrow();
  const changed =
    a.ciphertext.slice(0, -2) + (a.ciphertext.endsWith("ff") ? "00" : "ff");
  expect(() => openCredential(changed, id, a.keyId, a.hash, keys)).toThrow();
});
it("fails closed without a dedicated, valid active key", () => {
  expect(() => ticketKeys({})).toThrow();
  expect(() =>
    ticketKeys({
      TICKET_ACTIVE_KEY_ID: "one",
      TICKET_ENCRYPTION_KEYS: JSON.stringify({ one: "bad" }),
    }),
  ).toThrow();
});
