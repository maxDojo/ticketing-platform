import type { Pool } from "pg";

// Fixed identifiers only; this SQL never contains caller-supplied table names.
const queueChecks = [
  { name: "payments", table: "payment_jobs", states: "'pending'" },
  { name: "delivery", table: "ticket_delivery_jobs", states: "'pending'" },
  { name: "refunds", table: "refunds", states: "'approved','processing'" },
] as const;

const queries = queueChecks.flatMap(({ name, table, states }) => [
  `SELECT '${name}_overdue' AS check, count(*)::text AS count FROM ${table}
   WHERE state IN (${states}) AND next_attempt_at < now() - $1 * interval '1 second'
   AND (lease_expires_at IS NULL OR lease_expires_at <= now())`,
  `SELECT '${name}_attention' AS check, count(*)::text AS count FROM ${table}
   WHERE state = 'attention'`,
]);
queries.push(
  `SELECT 'reservations_overdue' AS check, count(*)::text AS count FROM orders
   WHERE status = 'pending' AND reservation_expires_at < now() - $1 * interval '1 second'`,
  `SELECT 'paid_orders_missing_tickets' AS check, count(*)::text AS count FROM orders o
   WHERE o.status = 'paid' AND
   (SELECT count(*) FROM tickets t WHERE t.order_id = o.id) <
   (SELECT coalesce(sum(i.quantity::bigint * i.admissions_per_unit), 0)
    FROM order_items i WHERE i.order_id = o.id)`,
  `SELECT 'paid_orders_missing_fulfillment' AS check, count(*)::text AS count FROM orders o
   WHERE o.status = 'paid' AND NOT EXISTS
   (SELECT 1 FROM payment_fulfillments f WHERE f.order_id = o.id)`,
);

export type OperationsHealth = {
  status: "ok" | "attention";
  overdueAfterSeconds: number;
  checks: { name: string; count: number }[];
};

// A single SELECT gives all checks one database snapshot. No provider calls or writes.
export async function operationsHealth(
  pool: Pool,
  overdueAfterSeconds = 300,
): Promise<OperationsHealth> {
  if (
    !Number.isSafeInteger(overdueAfterSeconds) ||
    overdueAfterSeconds < 1 ||
    overdueAfterSeconds > 86400
  )
    throw new Error("Invalid operations threshold");
  const { rows } = await pool.query<{ check: string; count: string }>(
    queries.join("\nUNION ALL\n"),
    [overdueAfterSeconds],
  );
  const checks = rows.map((row) => {
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid operations count");
    return { name: row.check, count };
  });
  return {
    status: checks.some((check) => check.count > 0) ? "attention" : "ok",
    overdueAfterSeconds,
    checks,
  };
}
