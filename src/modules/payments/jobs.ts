import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "../orders/service";
import { confirmPayment } from "./confirmation";
import type { VerifyGateway } from "./verification";
export async function queuePayment(pool: Pool, paymentId: string) {
  await pool.query(
    "INSERT INTO payment_jobs (payment_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [paymentId],
  );
}
export async function processPaymentJobs(
  pool: Pool,
  verify: VerifyGateway,
  limit = 20,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid batch size");
  // Repairs missed initialization queues, including attempts predating this migration.
  await pool.query(
    "INSERT INTO payment_jobs (payment_id) SELECT id FROM payments WHERE status IN ('initialized','pending','failed') ON CONFLICT DO NOTHING",
  );
  let processed = 0;
  for (; processed < limit; processed++) {
    const job = await transaction(pool, async (db) => {
      const {
        rows: [j],
      } = await db.query(
        "SELECT j.*,p.provider_reference FROM payment_jobs j JOIN payments p ON p.id=j.payment_id WHERE j.state='pending' AND j.next_attempt_at<=now() AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=now()) ORDER BY j.next_attempt_at,j.payment_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED",
      );
      if (!j) return null;
      const lease = randomUUID();
      await db.query(
        "UPDATE payment_jobs SET lease_id=$2,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1 WHERE payment_id=$1",
        [j.payment_id, lease],
      );
      return { ...j, lease, attempts: j.attempts + 1 };
    });
    if (!job) break;
    let outcome = "retry";
    try {
      outcome = await confirmPayment(
        pool,
        job.payment_id,
        await verify(job.provider_reference),
      );
    } catch {
      /* Only a fixed outcome is persisted; provider/SQL errors may contain PII. */
    }
    const finished = ["confirmed", "failed"].includes(outcome);
    const attention =
      outcome === "attention" || (!finished && job.attempts >= 24);
    const delay = Math.min(3600, 30 * 2 ** Math.min(job.attempts - 1, 7));
    await transaction(pool, async (db) => {
      const {
        rows: [current],
      } = await db.query(
        "SELECT generation FROM payment_jobs WHERE payment_id=$1 AND lease_id=$2 FOR UPDATE",
        [job.payment_id, job.lease],
      );
      if (!current) return; // Another worker reclaimed the expired lease.
      const signaled = current.generation !== job.generation;
      await db.query(
        "UPDATE payment_jobs SET state=$3,next_attempt_at=now()+$4*interval '1 second',lease_id=NULL,lease_expires_at=NULL,last_outcome=$5 WHERE payment_id=$1 AND lease_id=$2",
        [
          job.payment_id,
          job.lease,
          signaled
            ? "pending"
            : attention
              ? "attention"
              : finished
                ? "done"
                : "pending",
          signaled ? 0 : delay,
          outcome,
        ],
      );
      if (attention && outcome !== "attention")
        await db.query(
          "INSERT INTO payment_exceptions (payment_id,reason) VALUES ($1,'verification_unresolved') ON CONFLICT DO NOTHING",
          [job.payment_id],
        );
    });
  }
  return processed;
}
