import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  credentialHash,
  ticketKeys,
  type Keyring,
} from "../tickets/credentials";
function key(keys: Keyring, id: string) {
  const material = Object.hasOwn(keys.keys, id) ? keys.keys[id] : undefined;
  if (!material || !/^[a-f0-9]{64}$/.test(material))
    throw new Error("Access key unavailable");
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(material, "hex"),
      Buffer.from("ticketsquare-access-v1"),
      Buffer.from("delivery-link-encryption"),
      32,
    ),
  );
}
export function createAccessToken(
  grantId: string,
  keys: Keyring = ticketKeys(),
) {
  const token = randomBytes(32).toString("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keys, keys.active), iv);
  cipher.setAAD(Buffer.from(`access:v1:${grantId}:${keys.active}`));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    hash: credentialHash(token),
    keyId: keys.active,
    ciphertext: [
      "v1",
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      encrypted.toString("hex"),
    ].join(":"),
  };
}
export function readAccessToken(
  grant: { id: string; key_id: string; ciphertext: string; token_hash: string },
  keys: Keyring = ticketKeys(),
) {
  const parts = /^v1:([a-f0-9]{24}):([a-f0-9]{32}):([a-f0-9]{128})$/.exec(
    grant.ciphertext,
  );
  if (!parts) throw new Error("Access credential unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(keys, grant.key_id),
    Buffer.from(parts[1]!, "hex"),
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(`access:v1:${grant.id}:${grant.key_id}`));
  decipher.setAuthTag(Buffer.from(parts[2]!, "hex"));
  const token = Buffer.concat([
    decipher.update(Buffer.from(parts[3]!, "hex")),
    decipher.final(),
  ]).toString("utf8");
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    credentialHash(token) !== grant.token_hash
  )
    throw new Error("Access credential unavailable");
  return token;
}
