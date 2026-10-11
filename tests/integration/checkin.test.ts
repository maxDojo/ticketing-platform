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
import {
  admit,
  gateView,
  gateEvents,
  gateAccount,
} from "../../src/modules/checkin/service";
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
const name = `ts_gate_${randomUUID().replaceAll("-", "")}`;
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
it("admits exactly once across concurrent scanners and keeps group admissions independent", async () => {
  const f = await fixture(),
    a = await staff(f.event.id),
    b = await staff(f.event.id);
  const token = await qr(f);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      admit(pool, i % 2 ? a : b, f.event.id, { method: "qr", token }),
    ),
  );
  expect(results.filter((r) => r.outcome === "admitted")).toHaveLength(1);
  expect(
    results.filter((r) => r.outcome === "already_checked_in"),
  ).toHaveLength(7);
  expect(
    (await admit(pool, a, f.event.id, { method: "qr", token: await qr(f, 1) }))
      .outcome,
  ).toBe("admitted");
  const view = await gateView(pool, a, f.event.id);
  expect(view.admitted).toBe(2);
  expect(view.recent).toHaveLength(2);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM admin_audit WHERE actor_id IN ($1,$2) AND action='ticket.check_in.qr'",
        [a.userId, b.userId],
      )
    ).rows[0].n,
  ).toBe(2);
});
it("denies foreign staff and wrong-event QR without revealing another ticket", async () => {
  const f = await fixture(),
    other = await fixture(),
    actor = await staff(f.event.id);
  expect((await gateEvents(pool, actor)).map((e) => e.id)).toEqual([
    f.event.id,
  ]);
  await expect(
    gateView(pool, actor, other.event.id, "Synthetic"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    admit(pool, actor, other.event.id, {
      method: "qr",
      token: await qr(other),
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    await admit(pool, actor, f.event.id, {
      method: "qr",
      token: await qr(other),
    }),
  ).toEqual({ outcome: "invalid" });
  expect(
    await admit(pool, actor, f.event.id, {
      method: "qr",
      token: `tsq_test_v1_${randomBytes(32).toString("base64url")}`,
    }),
  ).toEqual({ outcome: "invalid" });
});
it("requires a live MFA session and rechecks revoked staff assignments", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id),
    input = { method: "qr", token: await qr(f) };
  await pool.query('UPDATE auth_session SET "mfaVerified"=false WHERE id=$1', [
    actor.sessionId,
  ]);
  await expect(admit(pool, actor, f.event.id, input)).rejects.toMatchObject({
    status: 403,
  });
  expect((await gateAccount(pool, actor, true)).twoFactorEnabled).toBe(true);
  await pool.query(
    'UPDATE auth_session SET "mfaVerified"=true,"expiresAt"=now()-interval \'1 second\' WHERE id=$1',
    [actor.sessionId],
  );
  await expect(admit(pool, actor, f.event.id, input)).rejects.toMatchObject({
    status: 401,
  });
  await pool.query(
    "UPDATE auth_session SET \"expiresAt\"=now()+interval '1 hour' WHERE id=$1",
    [actor.sessionId],
  );
  await pool.query("UPDATE event_staff SET active=false WHERE user_id=$1", [
    actor.userId,
  ]);
  await expect(admit(pool, actor, f.event.id, input)).rejects.toMatchObject({
    status: 404,
  });
});
it("allows only the active owning organizer, with MFA, to operate their event", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true),
    other = await fixture();
  expect((await gateEvents(pool, actor)).map((e) => e.id)).toEqual([
    f.event.id,
  ]);
  await expect(gateView(pool, actor, other.event.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(
    (await admit(pool, actor, f.event.id, { method: "qr", token: await qr(f) }))
      .outcome,
  ).toBe("admitted");
  await pool.query("UPDATE organizers SET active=false WHERE user_id=$1", [
    actor.userId,
  ]);
  await expect(gateView(pool, actor, f.event.id)).rejects.toMatchObject({
    status: 404,
  });
});
it("requires a manual reason, exposes minimal lookup data, and shares duplicate prevention with QR", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id);
  const found = await gateView(pool, actor, f.event.id, f.email);
  expect(found.tickets).toHaveLength(2);
  expect(JSON.stringify(found)).not.toContain(f.email);
  expect(JSON.stringify(found)).not.toContain("credential");
  await expect(gateView(pool, actor, f.event.id, "xx")).rejects.toMatchObject({
    status: 400,
  });
  expect((await gateView(pool, actor, f.event.id, "%%%")).tickets).toHaveLength(
    0,
  );
  const ticket = found.tickets[0];
  await expect(
    admit(pool, actor, f.event.id, {
      method: "manual",
      ticketId: ticket.id,
      reason: "",
    }),
  ).rejects.toMatchObject({ status: 400 });
  const results = await Promise.all([
    admit(pool, actor, f.event.id, {
      method: "manual",
      ticketId: ticket.id,
      reason: "Verified with supervisor",
    }),
    admit(pool, actor, f.event.id, {
      method: "manual",
      ticketId: ticket.id,
      reason: "Verified with supervisor",
    }),
  ]);
  expect(results.map((r) => r.outcome).sort()).toEqual([
    "admitted",
    "already_checked_in",
  ]);
  const issued = (await guestTickets(pool, f.guest, f.order.id)).tickets.find(
    (t) => t.id === ticket.id,
  )!;
  expect(
    (
      await admit(pool, actor, f.event.id, {
        method: "qr",
        token: issued.token,
      })
    ).outcome,
  ).toBe("already_checked_in");

  expect(
    (
      await pool.query(
        "SELECT reason,method FROM check_ins WHERE ticket_id=$1",
        [ticket.id],
      )
    ).rows[0],
  ).toEqual({ reason: "Verified with supervisor", method: "manual" });
});
it("rejects cancelled tickets and unpublished events, including after event start", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id),
    token = await qr(f);
  await pool.query("UPDATE tickets SET status='cancelled' WHERE order_id=$1", [
    f.order.id,
  ]);
  expect(
    (await admit(pool, actor, f.event.id, { method: "qr", token })).outcome,
  ).toBe("invalid");
  await pool.query("UPDATE events SET status='cancelled' WHERE id=$1", [
    f.event.id,
  ]);
  await expect(
    admit(pool, actor, f.event.id, { method: "qr", token }),
  ).rejects.toMatchObject({ status: 409 });
  const g = await fixture(),
    staffer = await staff(g.event.id);
  await pool.query(
    "UPDATE events SET starts_at=now()-interval '1 hour' WHERE id=$1",
    [g.event.id],
  );
  expect(
    (
      await admit(pool, staffer, g.event.id, {
        method: "qr",
        token: await qr(g),
      })
    ).outcome,
  ).toBe("admitted");
});
it("rolls back admission if its audit record cannot be written", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id),
    token = await qr(f);
  await pool.query(
    `CREATE FUNCTION reject_gate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit outage'; END; $$`,
  );
  await pool.query(
    "CREATE TRIGGER reject_gate_audit BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION reject_gate_audit()",
  );
  try {
    await expect(
      admit(pool, actor, f.event.id, { method: "qr", token }),
    ).rejects.toThrow();
  } finally {
    await pool.query("DROP TRIGGER reject_gate_audit ON admin_audit");
  }
  expect((await gateView(pool, actor, f.event.id)).admitted).toBe(0);
  expect(
    (await admit(pool, actor, f.event.id, { method: "qr", token })).outcome,
  ).toBe("admitted");
});
it("enforces event consistency and runtime permissions without allowing staff self-assignment or history edits", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id),
    other = await fixture();
  const { tickets } = await guestTickets(pool, f.guest, f.order.id);
  await expect(
    pool.query(
      "INSERT INTO check_ins(ticket_id,event_id,actor_id,method) VALUES ($1,$2,$3,'qr')",
      [tickets[0]!.id, other.event.id, actor.userId],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  const db = await pool.connect();
  try {
    await db.query("SET ROLE ticketsquare_app");
    await expect(
      db.query("UPDATE event_staff SET active=true WHERE user_id=$1", [
        actor.userId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("DELETE FROM check_ins")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      db.query("UPDATE check_ins SET method='qr'"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.query("RESET ROLE");
    db.release();
  }
});
