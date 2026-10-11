import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../orders/service";
import type { RefundGateway, RefundResult } from "./provider";
export async function processRefundJobs(pool: Pool, gateway: RefundGateway) {
  let count = 0;
  for (let i = 0; i < 20; i++) {
    const lease = randomUUID();
    const job = await transaction(pool, async (db) => {
      const {
        rows: [r],
      } = await db.query(
        "SELECT r.*,p.provider_reference AS reference FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.state IN ('approved','processing') AND r.next_attempt_at<=now() AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=now()) ORDER BY r.next_attempt_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1",
      );
      if (!r) return null;
      await db.query(
        "UPDATE refunds SET lease_id=$2,lease_expires_at=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
        [r.id, lease],
      );
      return r;
    });
    if (!job) break;
    let result: RefundResult | null = null,
      state = "attention";
    try {
      result = await gateway.inspect(job);
      if (!result && !job.dispatch_started_at && !job.provider_id) {
        // Commit the dispatch fence before any external side effect. Never clear it.
        const fence = await pool.query(
          "UPDATE refunds SET dispatch_started_at=now() WHERE id=$1 AND lease_id=$2 AND lease_expires_at>now() AND dispatch_started_at IS NULL RETURNING id",
          [job.id, lease],
        );
        if (fence.rowCount) {
          const created = await gateway.create(job);
          result = await gateway.inspect(job);
          if (result && created.id !== result.id)
            throw new Error("Refund identity changed after creation");
        }
      }
      if (result) {
        if (job.provider_id && job.provider_id !== result.id)
          throw new Error("Refund identity changed");
        if (result.status === "processed") state = "processed";
        else if (
          ["pending", "processing"].includes(result.status) &&
          job.attempts < 23
        )
          state = "processing";
      }
    } catch {
      state = "attention";
      result = null;
    }
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [
        job.order_id,
      ]);
      const {
        rows: [current],
      } = await db.query("SELECT * FROM refunds WHERE id=$1 FOR UPDATE", [
        job.id,
      ]);
      if (current.lease_id !== lease) return;
      await db.query(
        "UPDATE refunds SET state=$3,provider_id=coalesce($4,provider_id),provider_status=coalesce($5,provider_status),processed_at=CASE WHEN $3='processed' THEN now() ELSE NULL END,lease_id=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '5 minutes' WHERE id=$1 AND lease_id=$2",
        [job.id, lease, state, result?.id ?? null, result?.status ?? null],
      );
      if (state === "processed") {
        if (job.kind === "fulfilled") {
          await db.query(
            "UPDATE tickets SET status='refunded' WHERE order_id=$1 AND status='cancelled'",
            [job.order_id],
          );
          await db.query("UPDATE orders SET status='refunded' WHERE id=$1", [
            job.order_id,
          ]);
        } else if (job.kind === "unfulfilled") {
          await db.query(
            "UPDATE orders SET status='refunded' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM payment_fulfillments WHERE order_id=$1)",
            [job.order_id],
          );
        }
        await db.query(
          "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,'refund.processed',$2)",
          [job.actor_id, job.id],
        );
      }
    });
    count++;
  }
  return count;
}
