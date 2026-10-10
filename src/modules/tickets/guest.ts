import type { Pool } from "pg";
import { z } from "zod";
import { digest, transaction } from "../orders/service";
import { OrderError } from "../orders/input";
import { openCredential, ticketKeys } from "./credentials";

export async function guestTickets(
  pool: Pool,
  guest: string,
  orderId: string,
  ticketId?: string,
) {
  if (
    !z.uuid().safeParse(orderId).success ||
    (ticketId && !z.uuid().safeParse(ticketId).success)
  )
    throw new OrderError(404, "Tickets not found.");
  return transaction(pool, async (db) => {
    const {
      rows: [order],
    } = await db.query(
      `SELECT o.status,e.name,e.venue,e.starts_at,e.timezone,e.status AS event_status FROM orders o JOIN checkout_requests c ON c.order_id=o.id JOIN events e ON e.id=o.event_id
      WHERE o.id=$1 AND c.guest_hash=$2 AND c.created_at>clock_timestamp()-interval '24 hours' FOR SHARE OF o,e`,
      [orderId, digest(guest)],
    );
    if (!order) throw new OrderError(404, "Tickets not found in this browser.");
    if (order.status !== "paid" || order.event_status !== "published")
      throw new OrderError(
        409,
        "Tickets are unavailable for this order or event.",
      );
    const { rows } = await db.query(
      `SELECT t.id,t.reference,t.status,t.admission_ordinal,i.ticket_type_name,t.credential_hash,t.credential_ciphertext,t.credential_key_id FROM tickets t JOIN order_items i ON i.id=t.order_item_id WHERE t.order_id=$1 AND ($2::uuid IS NULL OR t.id=$2) ORDER BY i.id,t.admission_ordinal LIMIT 500 FOR SHARE OF t`,
      [orderId, ticketId ?? null],
    );
    if (ticketId && !rows.length)
      throw new OrderError(404, "Ticket not found.");
    const keys = ticketKeys();
    return {
      event: order,
      tickets: rows.map((t) => ({
        id: t.id,
        reference: t.reference,
        status: t.status,
        ordinal: t.admission_ordinal,
        category: t.ticket_type_name,
        token:
          t.status === "valid"
            ? openCredential(
                t.credential_ciphertext,
                t.id,
                t.credential_key_id,
                t.credential_hash,
                keys,
              )
            : null,
      })),
    };
  });
}
