import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { OrderError, orderInput } from "./input";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");

// Lock order is: retry key, event (creation only), order, ticket types by UUID.
// Expiry/cancellation never lock an event; no provider calls occur in transactions.
async function transaction<T>(
  pool: Pool,
  work: (db: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout = '3s'");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      const code = (error as { code?: string }).code;
      if (attempt < 2 && ["40P01", "40001"].includes(code ?? "")) continue;
      if (code === "55P03")
        throw new OrderError(
          503,
          "Checkout is busy. Retry the same request shortly.",
        );
      throw error;
    } finally {
      db.release();
    }
  }
}
async function summary(db: PoolClient, id: string) {
  const {
    rows: [o],
  } = await db.query(
    "SELECT id, reference, status, currency, subtotal::text, discount::text, fees::text, total::text, reservation_expires_at, clock_timestamp() AS server_now FROM orders WHERE id=$1",
    [id],
  );
  const { rows: items } = await db.query(
    "SELECT ticket_type_name AS name, quantity, admissions_per_unit, unit_price::text, subtotal::text FROM order_items WHERE order_id=$1 ORDER BY ticket_type_id",
    [id],
  );
  return { ...o, items };
}
async function release(
  db: PoolClient,
  id: string,
  state: "expired" | "cancelled",
) {
  // Caller already holds the order row. Lock all types in a consistent order.
  const { rows: holds } = await db.query(
    "SELECT * FROM reservations WHERE order_id=$1 AND state='held' ORDER BY ticket_type_id",
    [id],
  );
  await db.query(
    "SELECT id FROM ticket_types WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [holds.map((h) => h.ticket_type_id)],
  );
  for (const h of holds) {
    const updated = await db.query(
      "UPDATE ticket_types SET reserved_units=reserved_units-$2 WHERE id=$1 AND reserved_units >= $2",
      [h.ticket_type_id, h.quantity],
    );
    if (updated.rowCount !== 1) throw new Error("Reservation invariant failed");
  }
  await db.query(
    "UPDATE reservations SET state='released' WHERE order_id=$1 AND state='held'",
    [id],
  );
  await db.query(
    "UPDATE orders SET status=$2 WHERE id=$1 AND status='pending'",
    [id, state],
  );
}
export async function expireReservations(pool: Pool, batchSize = 100) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error("Invalid expiry batch size");
  // One order per transaction limits locks and avoids batch-wide deadlocks.
  let count = 0;
  for (; count < batchSize; count++) {
    const found = await transaction(pool, async (db) => {
      const {
        rows: [o],
      } = await db.query(
        "SELECT o.id FROM orders o WHERE o.status='pending' AND o.reservation_expires_at<=clock_timestamp() AND EXISTS (SELECT 1 FROM reservations r WHERE r.order_id=o.id AND r.state='held') ORDER BY o.reservation_expires_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED",
      );
      if (!o) return false;
      await release(db, o.id, "expired");
      return true;
    });
    if (!found) break;
  }
  return count;
}
export async function createOrder(pool: Pool, guest: string, input: unknown) {
  const parsed = orderInput.safeParse(input);
  if (!parsed.success)
    throw new OrderError(
      400,
      "Check buyer details and ticket quantities. Prices and totals must not be submitted.",
    );
  const v = parsed.data;
  v.items.sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
  const fingerprint = digest(JSON.stringify(v));
  const guestHash = digest(guest);
  return transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${guestHash}:${v.requestKey}`,
    ]);
    const {
      rows: [retry],
    } = await db.query(
      "SELECT order_id, fingerprint, created_at > clock_timestamp()-interval '24 hours' AS accessible FROM checkout_requests WHERE guest_hash=$1 AND request_key=$2",
      [guestHash, v.requestKey],
    );
    if (retry) {
      if (!retry.accessible)
        throw new OrderError(404, "Order access has expired.");
      if (retry.fingerprint !== fingerprint)
        throw new OrderError(
          409,
          "This request was already used for different details. Start a new reservation.",
        );
      const {
        rows: [o],
      } = await db.query(
        "SELECT status, reservation_expires_at<=clock_timestamp() AS elapsed FROM orders WHERE id=$1 FOR UPDATE",
        [retry.order_id],
      );
      if (o.status === "pending" && o.elapsed)
        await release(db, retry.order_id, "expired");
      return summary(db, retry.order_id);
    }
    const {
      rows: [event],
    } = await db.query(
      "SELECT status, starts_at FROM events WHERE id=$1 FOR SHARE",
      [v.eventId],
    );
    const {
      rows: [clock],
    } = await db.query("SELECT clock_timestamp() AS now");
    if (!event || event.status !== "published" || event.starts_at <= clock.now)
      throw new OrderError(409, "This event is not accepting reservations.");
    const { rows: types } = await db.query(
      "SELECT * FROM ticket_types WHERE event_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [v.eventId, v.items.map((i) => i.ticketTypeId)],
    );
    if (types.length !== v.items.length)
      throw new OrderError(400, "Invalid ticket selection.");
    // Recheck database time after waiting for inventory locks.
    const {
      rows: [current],
    } = await db.query("SELECT clock_timestamp() AS now");
    if (event.starts_at <= current.now)
      throw new OrderError(409, "The event has already started.");
    let total = 0n;
    for (const t of types) {
      const quantity = v.items.find((i) => i.ticketTypeId === t.id)!.quantity;
      if (
        !t.active ||
        t.currency !== "NGN" ||
        (t.sale_starts_at && t.sale_starts_at > current.now) ||
        (t.sale_ends_at && t.sale_ends_at <= current.now)
      )
        throw new OrderError(409, "A selected ticket category is not on sale.");
      if (quantity < t.minimum_quantity || quantity > t.maximum_quantity)
        throw new OrderError(
          400,
          "A quantity is outside its category's purchase limits.",
        );
      const reserved = await db.query(
        "UPDATE ticket_types SET reserved_units=reserved_units+$2 WHERE id=$1 AND capacity::bigint-sold_units-reserved_units >= $2",
        [t.id, quantity],
      );
      if (reserved.rowCount !== 1)
        throw new OrderError(
          409,
          "There are not enough tickets remaining. Adjust your selection.",
        );
      total += BigInt(t.unit_price) * BigInt(quantity);
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new OrderError(400, "Order total is too large.");
    const {
      rows: [o],
    } = await db.query(
      "INSERT INTO orders (reference,event_id,buyer_name,buyer_email,buyer_phone,currency,subtotal,total) VALUES ($1,$2,$3,$4,$5,'NGN',$6,$6) RETURNING id",
      [
        randomUUID(),
        v.eventId,
        v.buyerName,
        v.buyerEmail,
        v.buyerPhone || null,
        total.toString(),
      ],
    );
    for (const t of types) {
      const quantity = v.items.find((i) => i.ticketTypeId === t.id)!.quantity;
      const {
        rows: [item],
      } = await db.query(
        "INSERT INTO order_items (order_id,event_id,ticket_type_id,currency,ticket_type_name,unit_price,quantity,admissions_per_unit,subtotal) VALUES ($1,$2,$3,'NGN',$4,$5,$6,$7,$8) RETURNING id",
        [
          o.id,
          v.eventId,
          t.id,
          t.name,
          t.unit_price,
          quantity,
          t.admissions_per_unit,
          (BigInt(t.unit_price) * BigInt(quantity)).toString(),
        ],
      );
      await db.query(
        "INSERT INTO reservations (order_item_id,order_id,ticket_type_id,quantity) VALUES ($1,$2,$3,$4)",
        [item.id, o.id, t.id, quantity],
      );
    }
    await db.query(
      "INSERT INTO checkout_requests (order_id,guest_hash,request_key,fingerprint) VALUES ($1,$2,$3,$4)",
      [o.id, guestHash, v.requestKey, fingerprint],
    );
    return summary(db, o.id);
  });
}
export async function accessOrder(
  pool: Pool,
  guest: string,
  id: string,
  cancel = false,
) {
  if (!z.uuid().safeParse(id).success)
    throw new OrderError(404, "Order not found.");
  return transaction(pool, async (db) => {
    const {
      rows: [o],
    } = await db.query(
      "SELECT o.id,o.status,o.reservation_expires_at<=clock_timestamp() AS elapsed FROM orders o JOIN checkout_requests c ON c.order_id=o.id WHERE o.id=$1 AND c.guest_hash=$2 AND c.created_at>clock_timestamp()-interval '24 hours' FOR UPDATE OF o",
      [id, digest(guest)],
    );
    if (!o) throw new OrderError(404, "Order not found.");
    if (o.status === "pending" && (cancel || o.elapsed))
      await release(db, id, o.elapsed ? "expired" : "cancelled");
    else if (cancel && !["expired", "cancelled"].includes(o.status))
      throw new OrderError(409, "This order cannot be cancelled here.");
    return summary(db, id);
  });
}
