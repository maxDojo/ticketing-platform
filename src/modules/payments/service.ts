import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { digest, transaction } from "../orders/service";
import { OrderError } from "../orders/input";
import { checkoutUrl, type PaymentGateway } from "./paystack";
export async function initializePayment(
  pool: Pool,
  guest: string,
  id: string,
  origin: string,
  gateway: PaymentGateway,
) {
  if (!z.uuid().safeParse(id).success)
    throw new OrderError(404, "Order not found.");
  const attempt = await transaction(pool, async (db) => {
    // Match the inventory worker's order-first locking. Network I/O happens after commit.
    const {
      rows: [o],
    } = await db.query(
      "SELECT o.*,e.status AS event_status,e.starts_at FROM orders o JOIN checkout_requests c ON c.order_id=o.id JOIN events e ON e.id=o.event_id WHERE o.id=$1 AND c.guest_hash=$2 AND c.created_at>clock_timestamp()-interval '24 hours' FOR UPDATE OF o",
      [id, digest(guest)],
    );
    if (!o) throw new OrderError(404, "Order not found.");
    const {
      rows: [clock],
    } = await db.query("SELECT clock_timestamp() AS now");
    if (
      o.status !== "pending" ||
      o.reservation_expires_at <= clock.now ||
      o.event_status !== "published" ||
      o.starts_at <= clock.now
    )
      throw new OrderError(
        409,
        "This reservation is not available for payment.",
      );
    if (
      o.currency !== "NGN" ||
      BigInt(o.total) <= 0n ||
      BigInt(o.total) > BigInt(Number.MAX_SAFE_INTEGER) ||
      BigInt(o.fees) !== 0n
    )
      throw new OrderError(
        400,
        "This order is not eligible for this payment flow.",
      );
    const {
      rows: [existing],
    } = await db.query(
      "SELECT i.state,i.authorization_url,p.status AS payment_status,p.verified_at FROM payment_initializations i JOIN payments p ON p.id=i.payment_id WHERE i.order_id=$1",
      [id],
    );
    const retryFailed =
      existing?.payment_status === "failed" && !!existing.verified_at;
    if (existing && !retryFailed) {
      if (existing.state === "ready")
        return { url: checkoutUrl(existing.authorization_url) };
      throw new OrderError(
        409,
        "Payment initialization is unresolved. Use Check payment status; do not start another payment.",
      );
    }
    if (
      !retryFailed &&
      (await db.query("SELECT 1 FROM payments WHERE order_id=$1 LIMIT 1", [id]))
        .rowCount
    )
      throw new OrderError(409, "An existing payment requires review.");
    const reference = `ts-test-${randomUUID()}`;
    const {
      rows: [p],
    } = await db.query(
      "INSERT INTO payments (order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,$3,'NGN') RETURNING id",
      [id, reference, o.total],
    );
    await db.query(
      "INSERT INTO payment_initializations (order_id,payment_id) VALUES ($1,$2) ON CONFLICT (order_id) DO UPDATE SET payment_id=EXCLUDED.payment_id,state='initializing',authorization_url=NULL,created_at=now()",
      [id, p.id],
    );
    await db.query(
      "INSERT INTO payment_jobs (payment_id,next_attempt_at) VALUES ($1,now()+interval '30 seconds')",
      [p.id],
    );
    return {
      paymentId: p.id as string,
      reference,
      amount: String(o.total),
      email: String(o.buyer_email),
      callbackUrl: `${origin}/payments/return`,
    };
  });
  if ("url" in attempt) return { authorizationUrl: attempt.url };
  let url: string;
  try {
    url = checkoutUrl(await gateway(attempt));
  } catch {
    await pool.query(
      "UPDATE payment_initializations SET state='unknown' WHERE order_id=$1 AND state='initializing' AND payment_id=$2",
      [id, attempt.paymentId],
    );
    throw new OrderError(
      503,
      "Payment initialization could not be confirmed. Verification is queued; use Check payment status before trying again.",
    );
  }
  const saved = await pool.query(
    "UPDATE payment_initializations SET state='ready',authorization_url=$2 WHERE order_id=$1 AND state='initializing' AND payment_id=$3",
    [id, url, attempt.paymentId],
  );
  if (saved.rowCount !== 1)
    throw new OrderError(
      409,
      "This attempt was superseded. Check your payment status.",
    );
  // Expiry or cancellation can win while the network request is in flight.
  const {
    rows: [current],
  } = await pool.query(
    "SELECT status,reservation_expires_at>clock_timestamp() AS active FROM orders WHERE id=$1",
    [id],
  );
  if (current.status !== "pending" || !current.active)
    throw new OrderError(
      409,
      "Your reservation expired while payment was being prepared. Do not pay using this attempt.",
    );
  return { authorizationUrl: url };
}
