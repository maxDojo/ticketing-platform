import type { Pool } from "pg";
import { z } from "zod";
import { digest, accessOrder } from "../orders/service";
import { OrderError } from "../orders/input";
import { queuePayment } from "./jobs";
export async function requestGuestVerification(
  pool: Pool,
  guest: string,
  reference: string,
) {
  if (
    !z
      .string()
      .regex(/^[A-Za-z0-9.=-]{1,100}$/)
      .safeParse(reference).success
  )
    throw new OrderError(404, "Payment not found.");
  const {
    rows: [p],
  } = await pool.query(
    "SELECT p.id,p.order_id FROM payments p JOIN checkout_requests c ON c.order_id=p.order_id WHERE p.provider_reference=$1 AND c.guest_hash=$2 AND c.created_at>clock_timestamp()-interval '24 hours'",
    [reference, digest(guest)],
  );
  if (!p)
    throw new OrderError(
      404,
      "Payment not found in this browser. Use the browser that started checkout.",
    );
  await queuePayment(pool, p.id);
  return accessOrder(pool, guest, p.order_id);
}
