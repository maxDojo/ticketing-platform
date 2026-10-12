import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "../orders/service";
import { gateSession, type GateActor } from "../checkin/service";
export class RefundError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function owned(
  db: PoolClient,
  actor: GateActor,
  eventId: string,
  exclusive = false,
) {
  if (!z.uuid().safeParse(eventId).success)
    throw new RefundError(404, "Event not found.");
  await gateSession(db, actor);
  const {
    rows: [event],
  } = await db.query(
    `SELECT e.id,e.name,e.status FROM events e JOIN organizers o ON o.user_id=e.organizer_id WHERE e.id=$1 AND o.user_id=$2 AND o.active=true FOR ${exclusive ? "UPDATE" : "SHARE"} OF e`,
    [eventId, actor.userId],
  );
  if (!event) throw new RefundError(404, "Event not found.");
  return event;
}
export async function refundView(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  search = "",
) {
  if (search.length > 200) throw new RefundError(400, "Search is too long.");
  return transaction(pool, async (db) => {
    const event = await owned(db, actor, eventId);
    const { rows } = await db.query(
      `SELECT p.id,p.provider_reference,p.status AS payment_status,p.expected_amount::text AS amount,p.currency,o.reference AS order_reference,o.buyer_name,o.status AS order_status,r.id AS refund_id,r.state AS refund_state,r.kind,r.provider_status,r.processed_at,EXISTS(SELECT 1 FROM payment_fulfillments f WHERE f.payment_id=p.id) AS fulfills_order,(SELECT count(*)::int FROM check_ins c JOIN tickets t ON t.id=c.ticket_id WHERE t.order_id=o.id) AS checked_in FROM payments p JOIN orders o ON o.id=p.order_id LEFT JOIN refunds r ON r.payment_id=p.id WHERE o.event_id=$1 AND ($2='' OR p.provider_reference=$2 OR o.reference=$2 OR lower(o.buyer_email)=lower($2)) ORDER BY p.created_at DESC,p.id DESC LIMIT 50`,
      [eventId, search.trim()],
    );
    return { event, payments: rows };
  });
}
export const refundRequest = z
  .object({
    action: z.literal("refund"),
    paymentId: z.uuid(),
    reference: z.string().min(1).max(100),
    reason: z.string().trim().min(5).max(200),
    confirm: z.literal(true),
  })
  .strict();
export async function approveRefund(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  raw: unknown,
) {
  const v = refundRequest.safeParse(raw);
  if (!v.success)
    throw new RefundError(
      400,
      "Confirm the payment reference and provide a reason.",
    );
  const input = v.data;
  return transaction(pool, async (db) => {
    await owned(db, actor, eventId);
    const {
      rows: [scope],
    } = await db.query("SELECT order_id FROM payments WHERE id=$1", [
      input.paymentId,
    ]);
    if (!scope) throw new RefundError(404, "Payment not found.");
    const {
      rows: [order],
    } = await db.query(
      "SELECT id,event_id,status FROM orders WHERE id=$1 FOR UPDATE",
      [scope.order_id],
    );
    if (order.event_id !== eventId)
      throw new RefundError(404, "Payment not found.");
    const {
      rows: [p],
    } = await db.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
      input.paymentId,
    ]);
    if (p.provider_reference !== input.reference)
      throw new RefundError(409, "Payment reference does not match.");
    const {
      rows: [existing],
    } = await db.query("SELECT id,state FROM refunds WHERE payment_id=$1", [
      p.id,
    ]);
    if (existing) return existing;
    if (
      p.status !== "succeeded" ||
      BigInt(p.verified_amount ?? 0) <= 0n ||
      p.verified_currency !== p.currency
    )
      throw new RefundError(
        409,
        "A verified successful nonzero payment is required.",
      );
    const {
      rows: [fulfillment],
    } = await db.query(
      "SELECT payment_id FROM payment_fulfillments WHERE order_id=$1",
      [order.id],
    );
    const kind = fulfillment
      ? fulfillment.payment_id === p.id
        ? "fulfilled"
        : "excess"
      : "unfulfilled";
    if (kind === "fulfilled") {
      await db.query(
        "SELECT id FROM tickets WHERE order_id=$1 ORDER BY id FOR UPDATE",
        [order.id],
      );
      if (
        (
          await db.query(
            "SELECT c.id FROM check_ins c JOIN tickets t ON t.id=c.ticket_id WHERE t.order_id=$1 LIMIT 1",
            [order.id],
          )
        ).rowCount
      )
        throw new RefundError(
          409,
          "An admission has already checked in. This refund requires a separate exception review.",
        );
      await db.query(
        "UPDATE tickets SET status='cancelled' WHERE order_id=$1 AND status='valid'",
        [order.id],
      );
    }
    const {
      rows: [refund],
    } = await db.query(
      "INSERT INTO refunds(payment_id,order_id,event_id,actor_id,amount,currency,kind,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,state",
      [
        p.id,
        order.id,
        eventId,
        actor.userId,
        p.verified_amount,
        p.currency,
        kind,
        input.reason,
      ],
    );
    await db.query(
      "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,'refund.approved',$2)",
      [actor.userId, refund.id],
    );
    return refund;
  });
}
export async function recheckRefund(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  id: string,
) {
  if (!z.uuid().safeParse(id).success)
    throw new RefundError(404, "Refund not found.");
  return transaction(pool, async (db) => {
    await owned(db, actor, eventId);
    const result = await db.query(
      "UPDATE refunds SET state=CASE WHEN dispatch_started_at IS NULL THEN 'approved' ELSE 'processing' END,attempts=0,next_attempt_at=now() WHERE id=$1 AND event_id=$2 AND state='attention' AND (lease_expires_at IS NULL OR lease_expires_at<=now()) RETURNING id",
      [id, eventId],
    );
    if (!result.rowCount)
      throw new RefundError(
        409,
        "Only an unleased refund needing attention can be rechecked.",
      );
    await db.query(
      "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,'refund.recheck',$2)",
      [actor.userId, id],
    );
    return { queued: true };
  });
}
export async function cancelEvent(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  reason: string,
) {
  if (reason.trim().length < 5 || reason.length > 200)
    throw new RefundError(400, "Provide a cancellation reason.");
  return transaction(pool, async (db) => {
    const event = await owned(db, actor, eventId, true);
    if (event.status !== "cancelled") {
      await db.query(
        "INSERT INTO event_cancellations(event_id,actor_id,reason) VALUES ($1,$2,$3)",
        [eventId, actor.userId, reason.trim()],
      );
      await db.query("UPDATE events SET status='cancelled' WHERE id=$1", [
        eventId,
      ]);
      await db.query(
        "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,'event.cancelled',$2)",
        [actor.userId, eventId],
      );
    }
    return { cancelled: true };
  });
}
