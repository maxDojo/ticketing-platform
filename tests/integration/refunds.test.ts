import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, afterAll, expect, it } from "vitest";
import { databaseConfig } from "../../src/config/database";
import { createOrder } from "../../src/modules/orders/service";
import { confirmPayment } from "../../src/modules/payments/confirmation";
import { guestTickets } from "../../src/modules/tickets/guest";
import { admit } from "../../src/modules/checkin/service";
if (existsSync(".env.local")) loadEnvFile(".env.local");
process.env.TICKET_ACTIVE_KEY_ID = "delivery-test";
process.env.TICKET_ENCRYPTION_KEYS = JSON.stringify({
  "delivery-test": randomBytes(32).toString("hex"),
});
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw new Error("Local test database required");
const admin = new Pool(databaseConfig(url));
const name = `ts_refund_${randomUUID().replaceAll("-", "")}`;
const isolated = new URL(url);
isolated.pathname = `/${name}`;
const pool = new Pool(databaseConfig(isolated.toString()));
let created = false;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
});
async function fixture() {
  const {
    rows: [event],
  } = await pool.query(
    "INSERT INTO events (slug,name,venue,timezone,starts_at,status) VALUES ($1,'<script>unsafe</script>','Lagos','Africa/Lagos',now()+interval '7 days','published') RETURNING id",
    [randomUUID()],
  );
  const {
    rows: [type],
  } = await pool.query(
    "INSERT INTO ticket_types (event_id,name,unit_price,capacity,admissions_per_unit) VALUES ($1,'Group',100000,10,2) RETURNING id",
    [event.id],
  );
  const guest = randomBytes(32).toString("hex");
  const email = `${randomUUID()}@example.test`;
  const order = await createOrder(pool, guest, {
    eventId: event.id,
    requestKey: randomUUID(),
    buyerName: "Synthetic",
    buyerEmail: email,
    items: [{ ticketTypeId: type.id, quantity: 1 }],
  });
  const reference = `ts-test-${randomUUID()}`;
  const {
    rows: [payment],
  } = await pool.query(
    "INSERT INTO payments (order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,100000,'NGN') RETURNING id",
    [order.id, reference],
  );
  await confirmPayment(pool, payment.id, {
    reference,
    status: "success",
    domain: "test",
    amount: 100000,
    currency: "NGN",
    fees: 1500,
  });
  return { order, event, guest, email };
}
async function staff(eventId: string, owner = false) {
  const userId = randomUUID(),
    sessionId = randomUUID();
  await pool.query(
    "INSERT INTO auth_user(id,name,email,\"twoFactorEnabled\") VALUES ($1,'Gate tester',$2,true)",
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    'INSERT INTO auth_session(id,token,"userId","expiresAt","mfaVerified") VALUES ($1,$2,$3,now()+interval \'1 hour\',true)',
    [sessionId, randomUUID(), userId],
  );
  if (owner) {
    await pool.query("INSERT INTO organizers(user_id) VALUES ($1)", [userId]);
    await pool.query("UPDATE events SET organizer_id=$1 WHERE id=$2", [
      userId,
      eventId,
    ]);
  } else
    await pool.query(
      "INSERT INTO event_staff(user_id,event_id) VALUES ($1,$2)",
      [userId, eventId],
    );
  return { userId, sessionId };
}
async function qr(f: Awaited<ReturnType<typeof fixture>>, index = 0) {
  return (await guestTickets(pool, f.guest, f.order.id)).tickets[index]!.token!;
}

import {
  approveRefund,
  cancelEvent,
  refundView,
  recheckRefund,
} from "../../src/modules/refunds/service";
import { processRefundJobs } from "../../src/modules/refunds/jobs";
import { vi } from "vitest";
async function approval(f: Awaited<ReturnType<typeof fixture>>) {
  const {
    rows: [p],
  } = await pool.query("SELECT * FROM payments WHERE order_id=$1", [
    f.order.id,
  ]);
  return {
    action: "refund",
    paymentId: p.id,
    reference: p.provider_reference,
    reason: "Customer requested cancellation",
    confirm: true,
  };
}
it("blocks admissions atomically, handles replay, records full refund without restocking", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true),
    token = await qr(f),
    input = await approval(f);
  const r = await approveRefund(pool, actor, f.event.id, input);
  expect(await approveRefund(pool, actor, f.event.id, input)).toEqual(r);
  expect(
    (await admit(pool, actor, f.event.id, { method: "qr", token })).outcome,
  ).not.toBe("admitted");
  let sent = false;
  const create = vi.fn(async () => {
    sent = true;
    return { id: "1", status: "pending" };
  });
  await processRefundJobs(pool, {
    inspect: async () => (sent ? { id: "1", status: "processed" } : null),
    create,
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    (await pool.query("SELECT status FROM orders WHERE id=$1", [f.order.id]))
      .rows[0].status,
  ).toBe("refunded");
  expect(
    (
      await pool.query(
        "SELECT sold_units FROM ticket_types WHERE event_id=$1",
        [f.event.id],
      )
    ).rows[0].sold_units,
  ).toBe(1);
  expect(
    (await refundView(pool, actor, f.event.id)).payments[0].refund_state,
  ).toBe("processed");
  await expect(
    pool.query("UPDATE tickets SET status='valid' WHERE order_id=$1", [
      f.order.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("UPDATE refunds SET dispatch_started_at=NULL WHERE id=$1", [
      r.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("uncertain dispatch is never repeated even after organizer recheck", async () => {
  const f = await fixture(),
    a = await staff(f.event.id, true),
    r = await approveRefund(pool, a, f.event.id, await approval(f));
  const create = vi.fn(async () => {
    throw Error("connection lost");
  });
  const gateway = { inspect: async () => null, create };
  await processRefundJobs(pool, gateway);
  await recheckRefund(pool, a, f.event.id, r.id);
  await processRefundJobs(pool, gateway);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await refundView(pool, a, f.event.id)).payments[0].refund_state).toBe(
    "attention",
  );
  // Reconciliation can later confirm the original request without submitting another.
  await recheckRefund(pool, a, f.event.id, r.id);
  await processRefundJobs(pool, {
    ...gateway,
    inspect: async () => ({ id: "2", status: "processed" }),
  });
  expect((await refundView(pool, a, f.event.id)).payments[0].refund_state).toBe(
    "processed",
  );
});
it("rejects a fulfilled refund once any group admission checks in", async () => {
  const f = await fixture(),
    a = await staff(f.event.id, true);
  await admit(pool, a, f.event.id, { method: "qr", token: await qr(f) });
  await expect(
    approveRefund(pool, a, f.event.id, await approval(f)),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1 AND status='valid'",
        [f.order.id],
      )
    ).rows[0].n,
  ).toBe(2);
});
it("refund and check-in races have only one winner", async () => {
  const f = await fixture(),
    a = await staff(f.event.id, true),
    token = await qr(f),
    input = await approval(f);
  const [refund, entry] = await Promise.allSettled([
    approveRefund(pool, a, f.event.id, input),
    admit(pool, a, f.event.id, { method: "qr", token }),
  ]);
  const admitted =
    entry.status === "fulfilled" && entry.value.outcome === "admitted";
  expect(refund.status === "fulfilled").toBe(!admitted);
});
it("event cancellation is permanent, records reason, blocks sales and entry", async () => {
  const f = await fixture(),
    a = await staff(f.event.id, true),
    token = await qr(f);
  await cancelEvent(pool, a, f.event.id, "Venue unavailable");
  await expect(
    admit(pool, a, f.event.id, { method: "qr", token }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    pool.query("UPDATE events SET status='published' WHERE id=$1", [
      f.event.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  expect(
    (
      await pool.query(
        "SELECT reason FROM event_cancellations WHERE event_id=$1",
        [f.event.id],
      )
    ).rows[0].reason,
  ).toBe("Venue unavailable");
});
it("denies staff, foreign ownership and sessions without MFA", async () => {
  const f = await fixture(),
    a = await staff(f.event.id),
    input = await approval(f);
  await expect(approveRefund(pool, a, f.event.id, input)).rejects.toMatchObject(
    { status: 404 },
  );
  const owner = await staff(f.event.id, true),
    other = await fixture();
  await expect(refundView(pool, owner, other.event.id)).rejects.toMatchObject({
    status: 404,
  });
  await pool.query('UPDATE auth_session SET "mfaVerified"=false WHERE id=$1', [
    owner.sessionId,
  ]);
  await expect(
    approveRefund(pool, owner, f.event.id, input),
  ).rejects.toMatchObject({ status: 403 });
});
it("an excess charge refund preserves checked-in and unused admissions", async () => {
  const f = await fixture(),
    a = await staff(f.event.id, true),
    token = await qr(f);
  await admit(pool, a, f.event.id, { method: "qr", token });
  const reference = `ts-test-${randomUUID()}`;
  const {
    rows: [p],
  } = await pool.query(
    "INSERT INTO payments(order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,100000,'NGN') RETURNING id",
    [f.order.id, reference],
  );
  await confirmPayment(pool, p.id, {
    reference,
    status: "success",
    domain: "test",
    amount: 100000,
    currency: "NGN",
  });
  const r = await approveRefund(pool, a, f.event.id, {
    action: "refund",
    paymentId: p.id,
    reference,
    reason: "Accidental second payment",
    confirm: true,
  });
  await processRefundJobs(pool, {
    inspect: async (job) => ({ id: job.id, status: "processed" }),
    create: async () => {
      throw Error("must not dispatch");
    },
  });
  expect(
    (await pool.query("SELECT kind FROM refunds WHERE id=$1", [r.id])).rows[0]
      .kind,
  ).toBe("excess");
  expect(
    (await pool.query("SELECT status FROM orders WHERE id=$1", [f.order.id]))
      .rows[0].status,
  ).toBe("paid");
  expect(
    (await admit(pool, a, f.event.id, { method: "qr", token: await qr(f, 1) }))
      .outcome,
  ).toBe("admitted");
});
it("runtime role cannot delete refund or cancellation history", async () => {
  const {
    rows: [role],
  } = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname='ticketsquare_app'",
  );
  if (!role) throw Error("Runtime role must exist in integration environment");
  const {
    rows: [permissions],
  } = await pool.query(
    "SELECT has_table_privilege('ticketsquare_app','refunds','DELETE') AS refund_delete,has_table_privilege('ticketsquare_app','event_cancellations','UPDATE') AS cancellation_update",
  );
  expect(permissions).toEqual({
    refund_delete: false,
    cancellation_update: false,
  });
});
it("an audit failure rolls back both refund approval and ticket invalidation", async () => {
  const f = await fixture(),
    a = await staff(f.event.id, true),
    input = await approval(f);
  await pool.query(
    "CREATE FUNCTION fail_refund_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='refund.approved' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$",
  );
  await pool.query(
    "CREATE TRIGGER fail_refund_audit BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION fail_refund_audit()",
  );
  try {
    await expect(approveRefund(pool, a, f.event.id, input)).rejects.toThrow();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM refunds WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1 AND status='valid'",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await pool.query("DROP TRIGGER fail_refund_audit ON admin_audit");
    await pool.query("DROP FUNCTION fail_refund_audit()");
  }
});
