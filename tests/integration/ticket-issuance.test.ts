import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { createOrderTestContext } from "./helpers/orders";

const { pool, inventory, paymentFixture } = createOrderTestContext();

it("issues separate group admissions once and protects credentials by browser ownership", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const { guestTickets } = await import("../../src/modules/tickets/guest");
  const f = await paymentFixture();
  await Promise.all(
    Array.from({ length: 6 }, () => confirmPayment(pool, f.p.id, f.verified)),
  );
  const wallet = await guestTickets(pool, f.guest, f.order.id);
  expect(wallet.tickets).toHaveLength(7);
  expect(new Set(wallet.tickets.map((t) => t.token)).size).toBe(7);
  const again = await guestTickets(pool, f.guest, f.order.id);
  expect(again.tickets).toEqual(wallet.tickets);
  await expect(
    guestTickets(pool, randomBytes(32).toString("hex"), f.order.id),
  ).rejects.toMatchObject({ status: 404 });
  const foreign = await paymentFixture();
  await confirmPayment(pool, foreign.p.id, foreign.verified);
  await expect(
    guestTickets(pool, foreign.guest, foreign.order.id, wallet.tickets[0]!.id),
  ).rejects.toMatchObject({ status: 404 });
  await pool.query("UPDATE tickets SET status='cancelled' WHERE id=$1", [
    wallet.tickets[0]!.id,
  ]);
  expect(
    (await guestTickets(pool, f.guest, f.order.id, wallet.tickets[0]!.id))
      .tickets[0]!.token,
  ).toBeNull();
  // Only this disposable test database permits controlled clock ageing.
  await pool.query(
    "ALTER TABLE checkout_requests DISABLE TRIGGER checkout_request_guard",
  );
  try {
    await pool.query(
      "UPDATE checkout_requests SET created_at=now()-interval '25 hours' WHERE order_id=$1",
      [f.order.id],
    );
  } finally {
    await pool.query(
      "ALTER TABLE checkout_requests ENABLE TRIGGER checkout_request_guard",
    );
  }
  await expect(guestTickets(pool, f.guest, f.order.id)).rejects.toMatchObject({
    status: 404,
  });
});

it("rolls back payment, sold inventory and all tickets if an admission insert fails", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const f = await paymentFixture();
  await pool.query(
    "CREATE FUNCTION test_ticket_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$",
  );
  await pool.query(
    `CREATE TRIGGER test_ticket_failure BEFORE INSERT ON tickets FOR EACH ROW WHEN (NEW.order_id='${f.order.id}'::uuid AND NEW.admission_ordinal=2) EXECUTE FUNCTION test_ticket_failure()`,
  );
  try {
    await expect(confirmPayment(pool, f.p.id, f.verified)).rejects.toThrow();
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [f.order.id]))
        .rows[0].status,
    ).toBe("pending");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM payment_fulfillments WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    for (const t of f.types) expect((await inventory(t.id)).sold_units).toBe(0);
  } finally {
    await pool.query("DROP TRIGGER test_ticket_failure ON tickets");
    await pool.query("DROP FUNCTION test_ticket_failure()");
  }
  expect(await confirmPayment(pool, f.p.id, f.verified)).toBe("confirmed");
});

it("recovers missing admissions without changing existing credentials or inventory", async () => {
  const { confirmPayment } =
    await import("../../src/modules/payments/confirmation");
  const { recoverTickets } = await import("../../src/modules/tickets/issuance");
  const f = await paymentFixture();
  await confirmPayment(pool, f.p.id, f.verified);
  const { rows: before } = await pool.query(
    "SELECT id,credential_hash FROM tickets WHERE order_id=$1 ORDER BY id",
    [f.order.id],
  );
  await pool.query("DELETE FROM tickets WHERE id=$1", [before[0].id]);
  await Promise.all([recoverTickets(pool), recoverTickets(pool)]);
  const { rows: after } = await pool.query(
    "SELECT id,credential_hash FROM tickets WHERE order_id=$1",
    [f.order.id],
  );
  expect(after).toHaveLength(7);
  for (const t of before.slice(1)) expect(after).toContainEqual(t);
  for (const t of f.types) expect((await inventory(t.id)).sold_units).toBe(1);
});
