import type { Pool, PoolClient } from "pg";
import { issueTickets } from "../tickets/issuance";
import { transaction, release } from "../orders/service";
import { verifiedTransaction, type VerifiedTransaction } from "./verification";
export type ConfirmationOutcome =
  "confirmed" | "failed" | "pending" | "attention";
async function exception(db: PoolClient, paymentId: string, reason: string) {
  await db.query(
    "INSERT INTO payment_exceptions (payment_id,reason) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [paymentId, reason],
  );
}
export async function confirmPayment(
  pool: Pool,
  paymentId: string,
  raw: VerifiedTransaction,
): Promise<ConfirmationOutcome> {
  const v = verifiedTransaction.parse(raw);
  return transaction(pool, async (db) => {
    const {
      rows: [scope],
    } = await db.query("SELECT order_id FROM payments WHERE id=$1", [
      paymentId,
    ]);
    if (!scope) throw new Error("Payment unavailable");
    // All order-changing paths lock the order before the payment and inventory rows.
    const {
      rows: [o],
    } = await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      scope.order_id,
    ]);
    const {
      rows: [p],
    } = await db.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
      paymentId,
    ]);
    const {
      rows: [fulfilled],
    } = await db.query(
      "SELECT payment_id FROM payment_fulfillments WHERE order_id=$1",
      [o.id],
    );
    const identityMatches =
      v.reference === p.provider_reference &&
      v.domain === "test" &&
      v.currency === p.currency &&
      BigInt(v.amount) === BigInt(p.expected_amount) &&
      (v.fees == null || v.fees <= v.amount);
    if (p.status === "succeeded") {
      if (!identityMatches) {
        await exception(db, paymentId, "verification_mismatch");
        return "attention";
      }
      if (v.status === "reversed") {
        await exception(db, paymentId, "provider_reversed");
        return "attention";
      }
      if (fulfilled?.payment_id === p.id) {
        if (o.status === "paid") await issueTickets(db, o.id);
        return "confirmed";
      }
      return "attention";
    }
    if (p.status === "mismatched") return "attention";
    if (
      v.reference !== p.provider_reference ||
      v.domain !== "test" ||
      v.currency !== p.currency ||
      BigInt(v.amount) !== BigInt(p.expected_amount) ||
      (v.fees != null && v.fees > v.amount)
    ) {
      await db.query("UPDATE payments SET status='mismatched' WHERE id=$1", [
        p.id,
      ]);
      await exception(db, p.id, "verification_mismatch");
      if (!fulfilled && ["pending", "expired"].includes(o.status)) {
        await release(db, o.id, "expired");
        await db.query(
          "UPDATE orders SET status='payment_exception' WHERE id=$1",
          [o.id],
        );
      }
      return "attention";
    }
    if (v.status !== "success") {
      if (v.status === "failed") {
        await db.query(
          "UPDATE payments SET status='failed',verified_at=now(),verified_amount=$2,verified_currency=$3 WHERE id=$1",
          [p.id, String(v.amount), v.currency],
        );
        return "failed";
      }
      if (v.status === "reversed") {
        await exception(db, p.id, "provider_reversed");
        return "attention";
      }
      // Abandoned, ongoing, pending and unfamiliar states are not proof of failure.
      await db.query("UPDATE payments SET status='pending' WHERE id=$1", [
        p.id,
      ]);
      return "pending";
    }
    await db.query(
      "UPDATE payments SET status='succeeded',verified_at=now(),verified_amount=$2,verified_currency=$3,provider_fees=$4 WHERE id=$1",
      [
        p.id,
        String(v.amount),
        v.currency,
        v.fees == null ? null : String(v.fees),
      ],
    );
    if (
      fulfilled ||
      ["paid", "refunded", "partially_refunded"].includes(o.status)
    ) {
      await exception(db, p.id, "excess_payment");
      return "attention";
    }
    // Event lock prevents cancellation/start-time edits during the fulfillment decision.
    const {
      rows: [event],
    } = await db.query(
      "SELECT status,starts_at FROM events WHERE id=$1 FOR SHARE",
      [o.event_id],
    );
    const {
      rows: [clock],
    } = await db.query("SELECT clock_timestamp() AS now");
    const allowed =
      ["pending", "expired"].includes(o.status) &&
      event.status === "published" &&
      event.starts_at > clock.now;
    // If the deadline elapsed but the worker has not run, first release the old hold.
    if (o.status === "pending" && o.reservation_expires_at <= clock.now)
      await release(db, o.id, "expired");
    const { rows: holds } = await db.query(
      "SELECT r.*,i.quantity AS item_quantity FROM reservations r JOIN order_items i ON i.id=r.order_item_id WHERE r.order_id=$1 ORDER BY r.ticket_type_id",
      [o.id],
    );
    const { rows: types } = await db.query(
      "SELECT * FROM ticket_types WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [holds.map((h) => h.ticket_type_id)],
    );
    const itemCount = Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM order_items WHERE order_id=$1",
          [o.id],
        )
      ).rows[0].n,
    );
    if (
      !holds.length ||
      holds.length !== itemCount ||
      holds.some((h) => h.quantity !== h.item_quantity) ||
      holds.some((h) => h.state === "committed")
    )
      throw new Error("Reservation invariant failed");
    const available =
      types.length === holds.length &&
      holds.every((h) => {
        const t = types.find((t) => t.id === h.ticket_type_id)!;
        return h.state === "held"
          ? t.reserved_units >= h.quantity
          : t.capacity - t.reserved_units - t.sold_units >= h.quantity;
      });
    if (!allowed || !available) {
      await release(db, o.id, "expired");
      await db.query(
        "UPDATE orders SET status='payment_exception' WHERE id=$1",
        [o.id],
      );
      await exception(
        db,
        p.id,
        allowed ? "inventory_unavailable" : "order_unavailable",
      );
      return "attention";
    }
    for (const h of holds) {
      const reserved = h.state === "held" ? h.quantity : 0;
      const updated = await db.query(
        "UPDATE ticket_types SET reserved_units=reserved_units-$2,sold_units=sold_units+$3 WHERE id=$1 AND reserved_units>=$2 AND capacity::bigint-reserved_units-sold_units+$2 >= $3",
        [h.ticket_type_id, reserved, h.quantity],
      );
      if (updated.rowCount !== 1)
        throw new Error("Inventory changed unexpectedly");
    }
    await db.query(
      "INSERT INTO payment_fulfillments (order_id,payment_id) VALUES ($1,$2)",
      [o.id, p.id],
    );
    await db.query("UPDATE orders SET status='paid' WHERE id=$1", [o.id]);
    await issueTickets(db, o.id);
    await db.query(
      "UPDATE reservations SET state='committed' WHERE order_id=$1",
      [o.id],
    );
    return "confirmed";
  });
}
