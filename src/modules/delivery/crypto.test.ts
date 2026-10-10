import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createAccessToken, readAccessToken } from "./crypto";
import { previewOrigin } from "./worker";
it("encrypts access links separately and rejects identity or envelope tampering", () => {
  const keys = {
    active: "one",
    keys: { one: randomBytes(32).toString("hex") },
  };
  const id = randomUUID();
  const sealed = createAccessToken(id, keys);
  const row = {
    id,
    key_id: sealed.keyId,
    ciphertext: sealed.ciphertext,
    token_hash: sealed.hash,
  };
  const token = readAccessToken(row, keys);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(sealed.ciphertext).not.toContain(token);
  expect(
    readAccessToken(row, {
      active: "two",
      keys: { ...keys.keys, two: randomBytes(32).toString("hex") },
    }),
  ).toBe(token);
  expect(() => readAccessToken({ ...row, id: randomUUID() }, keys)).toThrow();
  expect(() =>
    readAccessToken({ ...row, token_hash: "0".repeat(64) }, keys),
  ).toThrow();
  expect(() =>
    readAccessToken(
      { ...row, ciphertext: row.ciphertext.slice(0, -2) + "zz" },
      keys,
    ),
  ).toThrow();
});
it("permits only local HTTP preview origins", () => {
  expect(previewOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  for (const url of [
    "https://example.com",
    "http://localhost.evil",
    "http://user:pass@localhost:3000",
    "http://localhost:3000/path",
    "http://localhost:3000/#x",
  ])
    expect(() => previewOrigin(url)).toThrow();
});
