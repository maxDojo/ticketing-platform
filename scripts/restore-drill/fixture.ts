import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createOrder } from "../../src/modules/orders/service";
import { initializePayment } from "../../src/modules/payments/service";
import { confirmPayment } from "../../src/modules/payments/confirmation";
import { ticketKeys } from "../../src/modules/tickets/credentials";

export async function seedDrill(pool: Pool) {
  // These keys exist only in this short-lived process; never use real key material.
  process.env.TICKET_ACTIVE_KEY_ID = "restore-drill";
  process.env.TICKET_ENCRYPTION_KEYS = JSON.stringify({
    "restore-drill": randomBytes(32).toString("hex"),
  });
  const event = (
    await pool.query(
      "INSERT INTO events(slug,name,venue,timezone,starts_at,status) VALUES ($1,'Restore drill','Synthetic venue','Africa/Lagos',now()+interval '1 day','published') RETURNING id",
      [`drill-${randomUUID()}`],
    )
  ).rows[0];
  const type = (
    await pool.query(
      "INSERT INTO ticket_types(event_id,name,unit_price,capacity,admissions_per_unit) VALUES ($1,'Group',100000,10,3) RETURNING id",
      [event.id],
    )
  ).rows[0];
  const guest = randomBytes(32).toString("hex");
  const order = await createOrder(pool, guest, {
    eventId: event.id,
    requestKey: randomUUID(),
    buyerName: "Synthetic buyer",
    buyerEmail: "restore-drill@example.test",
    items: [{ ticketTypeId: type.id, quantity: 1 }],
  });
  await initializePayment(
    pool,
    guest,
    order.id,
    "http://localhost:3000",
    async () => "https://checkout.paystack.com/synthetic-restore-drill",
  );
  const payment = (
    await pool.query("SELECT * FROM payments WHERE order_id=$1", [order.id])
  ).rows[0];
  await confirmPayment(pool, payment.id, {
    reference: payment.provider_reference,
    domain: "test",
    status: "success",
    currency: "NGN",
    amount: 100000,
    fees: 100,
  });
  return { orderId: order.id, keys: ticketKeys() };
}
