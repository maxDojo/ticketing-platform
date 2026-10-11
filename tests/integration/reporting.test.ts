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

import { report } from "../../src/modules/reporting/service";
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
const name = `ts_report_${randomUUID().replaceAll("-", "")}`;
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
function view(result: Awaited<ReturnType<typeof report>>) {
  if (result.type !== "view") throw Error("Expected view");
  return result;
}
it("counts fulfilled orders once, separates excess payments, records exact fees and attendance", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true);
  const reference = `extra-${randomUUID()}`;
  const {
    rows: [extra],
  } = await pool.query(
    "INSERT INTO payments(order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,100000,'NGN') RETURNING id",
    [f.order.id, reference],
  );
  await confirmPayment(pool, extra.id, {
    reference,
    status: "success",
    domain: "test",
    amount: 100000,
    currency: "NGN",
    fees: 1200,
  });
  const {
    rows: [ticket],
  } = await pool.query(
    "SELECT id FROM tickets WHERE order_id=$1 ORDER BY id LIMIT 1",
    [f.order.id],
  );
  await pool.query(
    "INSERT INTO check_ins(ticket_id,event_id,actor_id,method) VALUES ($1,$2,$3,'qr')",
    [ticket.id, f.event.id, actor.userId],
  );
  const data = view(await report(pool, actor, f.event.id, {}));
  expect(data.summary.money).toEqual([
    {
      currency: "NGN",
      fulfilled_orders: "1",
      gross_sales_minor: "100000",
      verified_payments: "2",
      verified_collections_minor: "200000",
      recorded_fees_minor: "2700",
      missing_fee_payments: "0",
    },
  ]);
  expect(data.summary.attendance).toEqual({
    issued: "2",
    checked_in: "1",
    valid_not_checked_in: "1",
    invalidated: "0",
  });
  expect(data.rows[0]).toMatchObject({
    reference: f.order.reference,
    total_minor: "100000",
    issued_admissions: "2",
    checked_in_admissions: "1",
  });
  expect(data.summary.inventory[0]).toMatchObject({
    sold_units: 1,
    reserved_units: 0,
    available_units: 9,
  });
});
it("restricts reports and exports to the active owning organizer with a live MFA session", async () => {
  const f = await fixture(),
    owner = await staff(f.event.id, true),
    gate = await staff(f.event.id),
    other = await fixture(),
    otherOwner = await staff(other.event.id, true);
  for (const actor of [gate, otherOwner])
    for (const exportValue of [false, true])
      await expect(
        report(pool, actor, f.event.id, { export: exportValue }),
      ).rejects.toMatchObject({ status: 404 });
  await pool.query('UPDATE auth_session SET "mfaVerified"=false WHERE id=$1', [
    owner.sessionId,
  ]);
  await expect(report(pool, owner, f.event.id, {})).rejects.toMatchObject({
    status: 403,
  });
  await pool.query(
    'UPDATE auth_session SET "mfaVerified"=true,"expiresAt"=now()-interval \'1 second\' WHERE id=$1',
    [owner.sessionId],
  );
  await expect(report(pool, owner, f.event.id, {})).rejects.toMatchObject({
    status: 401,
  });
  await pool.query(
    "UPDATE auth_session SET \"expiresAt\"=now()+interval '1 hour' WHERE id=$1",
    [owner.sessionId],
  );
  await pool.query("UPDATE organizers SET active=false WHERE user_id=$1", [
    owner.userId,
  ]);
  await expect(report(pool, owner, f.event.id, {})).rejects.toMatchObject({
    status: 404,
  });
});
it("filters admissions by name, exact contact/reference and status without leaking QR credentials", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true);
  const all = view(
    await report(pool, actor, f.event.id, {
      kind: "admissions",
      search: f.email,
    }),
  );
  expect(all.total).toBe("2");
  expect(JSON.stringify(all)).not.toContain("credential");
  const first = all.rows[0];
  expect(
    view(
      await report(pool, actor, f.event.id, {
        kind: "admissions",
        search: first.reference,
      }),
    ).total,
  ).toBe("1");
  expect(
    view(
      await report(pool, actor, f.event.id, {
        kind: "admissions",
        search: "%%%",
      }),
    ).total,
  ).toBe("0");
  expect(
    view(
      await report(pool, actor, f.event.id, {
        kind: "admissions",
        status: "checked_in",
      }),
    ).total,
  ).toBe("0");
  expect(
    view(
      await report(pool, actor, f.event.id, {
        kind: "admissions",
        status: "not_checked_in",
      }),
    ).total,
  ).toBe("2");
  await pool.query("UPDATE tickets SET status='refunded' WHERE reference=$1", [
    first.reference,
  ]);
  expect(
    view(
      await report(pool, actor, f.event.id, {
        kind: "admissions",
        status: "refunded",
      }),
    ).total,
  ).toBe("1");
});
it("paginates orders deterministically and exports all matching rows, not just the page", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true);
  await pool.query(
    "INSERT INTO orders(reference,event_id,buyer_name,buyer_email,total,subtotal) SELECT gen_random_uuid()::text,$1,'Page buyer','page@example.test',0,0 FROM generate_series(1,51)",
    [f.event.id],
  );
  const first = view(
    await report(pool, actor, f.event.id, { status: "pending" }),
  );
  const second = view(
    await report(pool, actor, f.event.id, { status: "pending", page: 2 }),
  );
  expect(first.total).toBe("51");
  expect(first.rows).toHaveLength(50);
  expect(second.rows).toHaveLength(1);
  expect(first.rows.map((r) => r.reference)).not.toContain(
    second.rows[0].reference,
  );
  const exported = await report(pool, actor, f.event.id, {
    status: "pending",
    page: 2,
    export: true,
  });
  expect("download" in exported).toBe(true);
  if (exported.type !== "download") throw Error("Expected export");
  expect(exported.download.split("\r\n")).toHaveLength(53);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM admin_audit WHERE actor_id=$1 AND action='report.export.orders'",
        [actor.userId],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("neutralizes buyer input in exported CSV without mutating stored data", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true);
  await pool.query("UPDATE orders SET buyer_name=$1 WHERE id=$2", [
    "=1+1",
    f.order.id,
  ]);
  const data = await report(pool, actor, f.event.id, {
    kind: "admissions",
    export: true,
  });
  if (data.type !== "download") throw Error("Expected export");
  expect(data.download).toContain('"Text: =1+1"');
  expect(data.download).not.toContain("credential");
  expect(
    (
      await pool.query("SELECT buyer_name FROM orders WHERE id=$1", [
        f.order.id,
      ])
    ).rows[0].buyer_name,
  ).toBe("=1+1");
});
it("refuses oversized exports rather than silently truncating and records no success audit", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true);
  await pool.query(
    "INSERT INTO orders(reference,event_id,buyer_name,buyer_email,total,subtotal) SELECT gen_random_uuid()::text,$1,'Bulk buyer','bulk@example.test',0,0 FROM generate_series(1,10001)",
    [f.event.id],
  );
  await expect(
    report(pool, actor, f.event.id, { status: "pending", export: true }),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM admin_audit WHERE actor_id=$1",
        [actor.userId],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("does not export if the audit write fails", async () => {
  const f = await fixture(),
    actor = await staff(f.event.id, true);
  await pool.query(
    `CREATE FUNCTION reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit outage'; END; $$`,
  );
  await pool.query(
    "CREATE TRIGGER reject_export_audit BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION reject_export_audit()",
  );
  try {
    await expect(
      report(pool, actor, f.event.id, { export: true }),
    ).rejects.toThrow();
  } finally {
    await pool.query("DROP TRIGGER reject_export_audit ON admin_audit");
  }
});
