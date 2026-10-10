import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../orders/service";
import { newCredential, ticketKeys, type Keyring } from "./credentials";
import { enqueueDelivery } from "../delivery/access";

// Caller holds the order lock. New confirmation and recovery use identical issuance.
export async function issueTickets(
  db: PoolClient,
  orderId: string,
  keys: Keyring = ticketKeys(),
) {
  const {
    rows: [order],
  } = await db.query(
    "SELECT o.id FROM orders o JOIN payment_fulfillments f ON f.order_id=o.id JOIN payments p ON p.id=f.payment_id WHERE o.id=$1 AND o.status='paid' AND p.status='succeeded'",
    [orderId],
  );
  if (!order) throw new Error("Verified fulfillment required");
  const { rows: items } = await db.query(
    "SELECT id,event_id,quantity,admissions_per_unit FROM order_items WHERE order_id=$1 ORDER BY id",
    [orderId],
  );
  if (
    items.reduce(
      (sum, item) => sum + item.quantity * item.admissions_per_unit,
      0,
    ) > 500
  )
    throw new Error("Admission batch exceeds safety limit");
  let inserted = 0;
  for (const item of items) {
    const total = item.quantity * item.admissions_per_unit;
    if (!Number.isSafeInteger(total) || total < 1 || total > 10000)
      throw new Error("Invalid admission count");
    const { rows: existing } = await db.query(
      "SELECT admission_ordinal FROM tickets WHERE order_item_id=$1",
      [item.id],
    );
    const ordinals = new Set(existing.map((t) => t.admission_ordinal));
    for (let ordinal = 1; ordinal <= total; ordinal++) {
      if (ordinals.has(ordinal)) continue;
      const id = randomUUID();
      const credential = newCredential(id, keys);
      await db.query(
        "INSERT INTO tickets (id,reference,order_id,order_item_id,event_id,admission_ordinal,credential_hash,credential_ciphertext,credential_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          `TST-${randomUUID()}`,
          orderId,
          item.id,
          item.event_id,
          ordinal,
          credential.hash,
          credential.ciphertext,
          credential.keyId,
        ],
      );
      inserted++;
    }
  }
  await enqueueDelivery(db, orderId);
  return inserted;
}
export async function recoverTickets(pool: Pool, keys: Keyring = ticketKeys()) {
  const { rows } =
    await pool.query(`SELECT o.id FROM orders o JOIN payment_fulfillments f ON f.order_id=o.id WHERE o.status='paid'
    AND (SELECT count(*) FROM tickets t WHERE t.order_id=o.id) < (SELECT sum(i.quantity::bigint*i.admissions_per_unit) FROM order_items i WHERE i.order_id=o.id)
    ORDER BY o.created_at LIMIT 20`);
  let issued = 0;
  for (const order of rows)
    issued += await transaction(pool, async (db) => {
      await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [
        order.id,
      ]);
      return issueTickets(db, order.id, keys);
    });
  return issued;
}
