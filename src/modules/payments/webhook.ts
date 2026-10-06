import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "../orders/service";
import { OrderError } from "../orders/input";
export async function acceptWebhook(
  pool: Pool,
  body: Buffer,
  signature: string | null,
  secret: string,
) {
  if (body.length > 65536) throw new OrderError(413, "Payload too large.");
  if (
    !signature ||
    !/^[a-f0-9]{128}$/i.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      createHmac("sha512", secret).update(body).digest(),
    )
  )
    throw new OrderError(401, "Invalid signature.");
  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    throw new OrderError(400, "Invalid event.");
  }
  const envelope = z.object({ event: z.string().max(100) }).safeParse(json);
  if (!envelope.success) throw new OrderError(400, "Invalid event.");
  if (envelope.data.event !== "charge.success") return;
  const event = z
    .object({
      data: z.object({
        reference: z.string().regex(/^[A-Za-z0-9.=-]{1,100}$/),
        domain: z.literal("test"),
      }),
    })
    .safeParse(json);
  if (!event.success) throw new OrderError(400, "Invalid test payment event.");
  const hash = createHash("sha256").update(body).digest("hex");
  await transaction(pool, async (db) => {
    const {
      rows: [p],
    } = await db.query("SELECT id FROM payments WHERE provider_reference=$1", [
      event.data.data.reference,
    ]);
    if (!p) return; // This merchant account may also serve other applications.
    const inserted = await db.query(
      "INSERT INTO payment_webhook_receipts (digest,payment_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING digest",
      [hash, p.id],
    );
    if (!inserted.rowCount) return;
    // Only minimal routing metadata is stored, never the original payload.
    await db.query(
      `INSERT INTO payment_jobs (payment_id) VALUES ($1) ON CONFLICT (payment_id) DO UPDATE SET state='pending',next_attempt_at=now(),generation=payment_jobs.generation+1`,
      [p.id],
    );
  });
}
