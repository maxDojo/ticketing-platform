import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "../orders/service";
import { createAccessToken, readAccessToken } from "./crypto";
import { ticketKeys, type Keyring } from "../tickets/credentials";
export type Mail = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};
export type Deliver = (mail: Mail) => Promise<void>;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function previewOrigin(origin: string) {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Preview delivery requires a local app URL");
  return url.origin;
}
export async function processDeliveryJobs(
  pool: Pool,
  deliver: Deliver,
  origin: string,
  keys: Keyring = ticketKeys(),
  limit = 20,
) {
  const base = previewOrigin(origin);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid delivery batch");
  // Repairs older paid orders. Never enqueue pending or incompletely issued orders.
  await pool.query(`INSERT INTO ticket_delivery_jobs (order_id,business_key)
    SELECT o.id,'initial:'||o.id FROM orders o JOIN payment_fulfillments f ON f.order_id=o.id JOIN events e ON e.id=o.event_id
    WHERE o.status='paid' AND e.status='published' AND e.starts_at>clock_timestamp()
    AND (SELECT count(*) FROM tickets t WHERE t.order_id=o.id)=(SELECT sum(i.quantity::bigint*i.admissions_per_unit) FROM order_items i WHERE i.order_id=o.id)
    ON CONFLICT (business_key) DO NOTHING`);
  let processed = 0;
  for (; processed < limit; processed++) {
    const job = await transaction(pool, async (db) => {
      const {
        rows: [row],
      } = await db.query(
        "SELECT * FROM ticket_delivery_jobs WHERE state='pending' AND next_attempt_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<=now()) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return null;
      const lease = randomUUID();
      await db.query(
        "UPDATE ticket_delivery_jobs SET lease_id=$2,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1 WHERE id=$1",
        [row.id, lease],
      );
      return { ...row, lease, attempts: row.attempts + 1 };
    });
    if (!job) break;
    let success = false;
    try {
      const mail = await transaction(pool, async (db) => {
        const {
          rows: [order],
        } = await db.query(
          `SELECT o.id,o.reference,o.buyer_email,e.name FROM orders o JOIN events e ON e.id=o.event_id
          WHERE o.id=$1 AND o.status='paid' AND e.status='published' AND e.starts_at>clock_timestamp()
          AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id=o.id AND t.status='valid') FOR SHARE OF o,e`,
          [job.order_id],
        );
        const held = await db.query(
          "SELECT id FROM ticket_delivery_jobs WHERE id=$1 AND lease_id=$2 FOR UPDATE",
          [job.id, job.lease],
        );
        if (!order || !held.rowCount) throw new Error("Delivery unavailable");
        const {
          rows: [existing],
        } = await db.query(
          "SELECT * FROM ticket_access_grants WHERE job_id=$1",
          [job.id],
        );
        let grant = existing;
        if (!grant) {
          const id = randomUUID();
          const token = createAccessToken(id, keys);
          const result = await db.query(
            "INSERT INTO ticket_access_grants (id,job_id,order_id,token_hash,ciphertext,key_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '24 hours') RETURNING *",
            [
              id,
              job.id,
              job.order_id,
              token.hash,
              token.ciphertext,
              token.keyId,
            ],
          );
          grant = result.rows[0];
        }
        const {
          rows: [clock],
        } = await db.query("SELECT clock_timestamp() AS now");
        if (grant.revoked_at || grant.expires_at <= clock.now)
          throw new Error("Delivery link expired");
        const link = `${base}/tickets/access#${readAccessToken(grant, keys)}`;
        const text = `Your test tickets for ${order.name}\nOrder: ${order.reference}\n\nOpen your tickets: ${link}\n\nThis private link can be used once within 24 hours. Keep it private: it gives access to every ticket in this order. Share only individual admission downloads with attendees. Test tickets do not grant entry.\n`;
        return {
          id: job.id,
          to: order.buyer_email,
          subject: "Your TicketSquare test tickets",
          text,
          html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Your test tickets</title><body><p>LOCAL PREVIEW — no email was sent.</p><p>To: ${escape(order.buyer_email)}</p><h1>Your test tickets for ${escape(order.name)}</h1><p>Order: ${escape(order.reference)}</p><p><a href="${escape(link)}">Open your tickets</a></p><p>This private link can be used once within 24 hours. It grants access to all tickets in this order. Share only individual admission downloads. Test tickets do not grant entry.</p></body></html>`,
        };
      });
      // Transport must have bounded runtime and use the job ID for idempotency.
      await deliver(mail);
      success = true;
    } catch {
      /* Never persist provider errors, email addresses or access links in logs. */
    }
    await pool.query(
      "UPDATE ticket_delivery_jobs SET state=$3,next_attempt_at=now()+$4*interval '1 second',lease_id=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_id=$2",
      [
        job.id,
        job.lease,
        success ? "done" : job.attempts >= 6 ? "attention" : "pending",
        Math.min(1800, 30 * 2 ** Math.min(job.attempts - 1, 6)),
      ],
    );
  }
  return processed;
}
