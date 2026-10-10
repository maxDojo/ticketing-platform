import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

export type Keyring = { active: string; keys: Record<string, string> };
const keyId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
export function ticketKeys(
  env: Record<string, string | undefined> = process.env,
): Keyring {
  const keys = z
    .record(keyId, z.string().regex(/^[a-f0-9]{64}$/))
    .parse(JSON.parse(env.TICKET_ENCRYPTION_KEYS ?? "{}"));
  const active = keyId.parse(env.TICKET_ACTIVE_KEY_ID);
  if (!Object.hasOwn(keys, active)) throw new Error("Ticket key unavailable");
  return { active, keys };
}
export const credentialHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function sealCredential(
  token: string,
  ticketId: string,
  keyring: Keyring,
) {
  const key = keyring.keys[keyring.active];
  if (!key || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Ticket key unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(
    Buffer.from(`ticketsquare:test:v1:${ticketId}:${keyring.active}`),
  );
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    hash: credentialHash(token),
    keyId: keyring.active,
    ciphertext: [
      "v1",
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      encrypted.toString("hex"),
    ].join(":"),
  };
}
export function openCredential(
  ciphertext: string,
  ticketId: string,
  id: string,
  hash: string,
  keyring: Keyring,
) {
  const parts = /^v1:([a-f0-9]{24}):([a-f0-9]{32}):([a-f0-9]+)$/.exec(
    ciphertext,
  );
  const key = Object.hasOwn(keyring.keys, id) ? keyring.keys[id] : undefined;
  if (!parts || !key) throw new Error("Ticket credential unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(parts[1]!, "hex"),
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(`ticketsquare:test:v1:${ticketId}:${id}`));
  decipher.setAuthTag(Buffer.from(parts[2]!, "hex"));
  const token = Buffer.concat([
    decipher.update(Buffer.from(parts[3]!, "hex")),
    decipher.final(),
  ]).toString("utf8");
  if (
    !/^tsq_test_v1_[A-Za-z0-9_-]{43}$/.test(token) ||
    credentialHash(token) !== hash
  )
    throw new Error("Ticket credential unavailable");
  return token;
}
export function newCredential(ticketId: string, keys: Keyring) {
  return sealCredential(
    `tsq_test_v1_${randomBytes(32).toString("base64url")}`,
    ticketId,
    keys,
  );
}
