import "server-only";
import { getPool } from "@/db/client";
import { requireOrganizer, AccessError } from "@/modules/auth/access";
import { z } from "zod";
import { transaction } from "@/modules/orders/service";
export async function eventPayments(headers: Headers, eventId: string) {
  const actor = await requireOrganizer(headers);
  if (!z.uuid().safeParse(eventId).success)
    throw new AccessError(404, "Event not found.");
  const { rows } = await getPool().query(
    `SELECT p.id,p.provider_reference,p.status,p.expected_amount::text,p.provider_fees::text,j.state AS job_state,j.last_outcome,
   ARRAY(SELECT reason FROM payment_exceptions x WHERE x.payment_id=p.id ORDER BY created_at) AS exceptions
   FROM payments p JOIN orders o ON o.id=p.order_id JOIN events e ON e.id=o.event_id LEFT JOIN payment_jobs j ON j.payment_id=p.id
   WHERE e.id=$1 AND e.organizer_id=$2 ORDER BY p.created_at DESC,p.id DESC LIMIT 50`,
    [eventId, actor.userId],
  );
  return rows;
}
export async function retryEventPayment(
  headers: Headers,
  eventId: string,
  paymentId: string,
) {
  const actor = await requireOrganizer(headers);
  if (
    !z.uuid().safeParse(eventId).success ||
    !z.uuid().safeParse(paymentId).success
  )
    throw new AccessError(404, "Payment not found.");
  await transaction(getPool(), async (db) => {
    const owned = await db.query(
      "SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id JOIN events e ON e.id=o.event_id WHERE p.id=$1 AND e.id=$2 AND e.organizer_id=$3",
      [paymentId, eventId, actor.userId],
    );
    if (!owned.rowCount) throw new AccessError(404, "Payment not found.");
    await db.query(
      "INSERT INTO payment_jobs (payment_id) VALUES ($1) ON CONFLICT (payment_id) DO UPDATE SET state='pending',attempts=0,next_attempt_at=now(),generation=payment_jobs.generation+1",
      [paymentId],
    );
    await db.query(
      "INSERT INTO admin_audit (actor_id,action,resource_id) VALUES ($1,'PAYMENT_RECHECK_REQUESTED',$2)",
      [actor.userId, paymentId],
    );
  });
}
