import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { credentialHash } from "../tickets/credentials";
import { transaction } from "../orders/service";
import { OrderError } from "../orders/input";
import { consumeLimit } from "../auth/throttle";

export async function enqueueDelivery(
  db: PoolClient,
  orderId: string,
  businessKey = `initial:${orderId}`,
) {
  await db.query(
    "INSERT INTO ticket_delivery_jobs (order_id,business_key) VALUES ($1,$2) ON CONFLICT (business_key) DO NOTHING",
    [orderId, businessKey],
  );
}
export async function requestResend(
  pool: Pool,
  email: string,
  reference: string,
) {
  // Same response and limits for existing and unknown details. No provider I/O here.
  const global = await consumeLimit(pool, "ticket-resend-global", 60, 60);
  if (!global) return;
  const emailLimit = await consumeLimit(
    pool,
    `ticket-resend-email:${email}`,
    3,
    3600,
  );
  const refLimit = await consumeLimit(
    pool,
    `ticket-resend-order:${reference}`,
    3,
    3600,
  );
  if (!global || !emailLimit || !refLimit) return;
  await transaction(pool, async (db) => {
    const {
      rows: [order],
    } = await db.query(
      `SELECT o.id FROM orders o JOIN events e ON e.id=o.event_id JOIN payment_fulfillments f ON f.order_id=o.id
      WHERE o.reference=$1 AND lower(o.buyer_email)=$2 AND o.status='paid' AND e.status='published'
      AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id=o.id AND t.status='valid') FOR SHARE OF o,e`,
      [reference, email],
    );
    if (order)
      await enqueueDelivery(db, order.id, `resend:${order.id}:${randomUUID()}`);
  });
}
export async function redeemAccess(pool: Pool, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new OrderError(
      404,
      "This link is invalid or expired. Request a new link.",
    );
  return transaction(pool, async (db) => {
    const {
      rows: [scope],
    } = await db.query(
      "SELECT order_id FROM ticket_access_grants WHERE token_hash=$1",
      [credentialHash(token)],
    );
    if (!scope)
      throw new OrderError(
        404,
        "This link is invalid or expired. Request a new link.",
      );
    const {
      rows: [order],
    } = await db.query(
      "SELECT o.id FROM orders o JOIN events e ON e.id=o.event_id WHERE o.id=$1 AND o.status='paid' AND e.status='published' FOR SHARE OF o,e",
      [scope.order_id],
    );
    const {
      rows: [grant],
    } = await db.query(
      "UPDATE ticket_access_grants SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING id",
      [credentialHash(token)],
    );
    if (!order || !grant)
      throw new OrderError(
        404,
        "This link is invalid or expired. Request a new link.",
      );
    const session = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO ticket_access_sessions (token_hash,grant_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '24 hours')",
      [credentialHash(session), grant.id],
    );
    return { orderId: order.id, session };
  });
}
