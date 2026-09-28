import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseConfig } from "../../src/config/database";
import { consumeLimit } from "../../src/modules/auth/throttle";
import { ticketTypes } from "../../src/db/schema";
if (existsSync(".env.local")) loadEnvFile(".env.local");
const testUrl = process.env.TEST_DATABASE_URL;
if (
  !testUrl ||
  !URL.canParse(testUrl) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(testUrl).hostname)
) {
  throw new Error(
    "TEST_DATABASE_URL must explicitly target a disposable loopback PostgreSQL instance",
  );
}
const admin = new Pool(databaseConfig(testUrl));
const name = `ticketsquare_test_${randomUUID().replaceAll("-", "")}`;
const isolatedUrl = new URL(testUrl);
isolatedUrl.pathname = `/${name}`;
const pool = new Pool(databaseConfig(isolatedUrl.toString()));
const db = drizzle(pool);
let created = false;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
});
async function fixture({
  quantity = 2,
  admissions = 6,
  status = "pending",
  currency = "NGN",
} = {}) {
  const event = (
    await pool.query(
      "INSERT INTO events (slug,name,venue,timezone,starts_at) VALUES ($1,'Test event','Lagos','Africa/Lagos',now()+interval '1 day') RETURNING *",
      [`event-${randomUUID()}`],
    )
  ).rows[0];
  const type = (
    await pool.query(
      "INSERT INTO ticket_types (event_id,name,unit_price,currency,capacity,admissions_per_unit) VALUES ($1,'Table',10000,$2,2,$3) RETURNING *",
      [event.id, currency, admissions],
    )
  ).rows[0];
  const order = (
    await pool.query(
      "INSERT INTO orders (reference,event_id,buyer_name,buyer_email,currency,subtotal,total,status) VALUES ($1,$2,'Buyer','buyer@example.test',$3,$4,$4,$5) RETURNING *",
      [randomUUID(), event.id, currency, 10000 * quantity, status],
    )
  ).rows[0];
  const item = (
    await pool.query(
      "INSERT INTO order_items (order_id,event_id,ticket_type_id,currency,ticket_type_name,unit_price,quantity,admissions_per_unit,subtotal) VALUES ($1,$2,$3,$4,'Table',10000,$5,$6,$7) RETURNING *",
      [
        order.id,
        event.id,
        type.id,
        currency,
        quantity,
        admissions,
        10000 * quantity,
      ],
    )
  ).rows[0];
  return { event, type, order, item };
}
async function admission(
  f: Awaited<ReturnType<typeof fixture>>,
  ordinal: number,
  hash = createHash("sha256").update(randomUUID()).digest("hex"),
) {
  return pool.query(
    "INSERT INTO tickets (reference,order_id,order_item_id,event_id,admission_ordinal,credential_hash,credential_ciphertext,credential_key_id) VALUES ($1,$2,$3,$4,$5,$6,'test-only-placeholder','test-only-key') RETURNING id",
    [randomUUID(), f.order.id, f.item.id, f.event.id, ordinal, hash],
  );
}
it("applies committed migrations twice without duplicating tables or journal entries", async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  expect(
    Number(
      (await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ),
  ).toBe(6);
});
it("preserves reservation snapshots when the organizer changes the duration", async () => {
  const f = await fixture();
  expect(f.order.reservation_minutes).toBe(10);
  await pool.query("UPDATE events SET reservation_minutes=25 WHERE id=$1", [
    f.event.id,
  ]);
  const next = (
    await pool.query(
      "INSERT INTO orders (reference,event_id,buyer_name,buyer_email,subtotal,total) VALUES ($1,$2,'Buyer','buyer@example.test',0,0) RETURNING *",
      [randomUUID(), f.event.id],
    )
  ).rows[0];
  expect(next.reservation_minutes).toBe(25);
  expect(
    next.reservation_expires_at.getTime() - next.reserved_at.getTime(),
  ).toBe(25 * 60000);
  const original = (
    await pool.query("SELECT * FROM orders WHERE id=$1", [f.order.id])
  ).rows[0];
  expect(original.reservation_expires_at).toEqual(
    f.order.reservation_expires_at,
  );
  await expect(
    pool.query("UPDATE orders SET reservation_minutes=25 WHERE id=$1", [
      f.order.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rejects invalid timezones, reservation settings, and negative inventory", async () => {
  const f = await fixture();
  for (const query of [
    "UPDATE events SET timezone='MadeUp/Zone' WHERE id=$1",
    "UPDATE events SET reservation_minutes=0 WHERE id=$1",
    "UPDATE events SET reservation_minutes=1441 WHERE id=$1",
  ]) {
    await expect(pool.query(query, [f.event.id])).rejects.toMatchObject({
      code: "23514",
    });
  }
  await expect(
    pool.query("UPDATE ticket_types SET reserved_units=-1 WHERE id=$1", [
      f.type.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rejects cross-event and cross-currency items and inconsistent totals", async () => {
  const a = await fixture();
  const b = await fixture();
  const otherType = (
    await pool.query(
      "INSERT INTO ticket_types (event_id,name,unit_price,currency,capacity) VALUES ($1,'USD ticket',10,'USD',1) RETURNING id",
      [a.event.id],
    )
  ).rows[0];
  await expect(
    pool.query(
      "INSERT INTO order_items (order_id,event_id,ticket_type_id,currency,ticket_type_name,unit_price,quantity,admissions_per_unit,subtotal) VALUES ($1,$2,$3,'NGN','Wrong',10,1,1,10)",
      [a.order.id, a.event.id, b.type.id],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    pool.query(
      "INSERT INTO order_items (order_id,event_id,ticket_type_id,currency,ticket_type_name,unit_price,quantity,admissions_per_unit,subtotal) VALUES ($1,$2,$3,'USD','Wrong',10,1,1,10)",
      [a.order.id, a.event.id, otherType.id],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    pool.query(
      "INSERT INTO orders (reference,event_id,buyer_name,buyer_email,subtotal,total) VALUES ($1,$2,'Buyer','buyer@example.test',10,11)",
      [randomUUID(), a.event.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it("keeps historical price and admission snapshots immutable", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE ticket_types SET name='New table',unit_price=20000,admissions_per_unit=8 WHERE id=$1",
    [f.type.id],
  );
  const old = (
    await pool.query("SELECT * FROM order_items WHERE id=$1", [f.item.id])
  ).rows[0];
  expect(old.unit_price).toBe("10000");
  expect(old.admissions_per_unit).toBe(6);
  await expect(
    pool.query("UPDATE order_items SET admissions_per_unit=8 WHERE id=$1", [
      f.item.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("round trips bigint money through Drizzle without losing precision", async () => {
  const f = await fixture();
  const large = 9007199254740993n;
  await db
    .update(ticketTypes)
    .set({ unitPrice: large })
    .where(eq(ticketTypes.id, f.type.id));
  const [row] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, f.type.id));
  expect(row?.unitPrice).toBe(large);
});
it("two six-person packages permit twelve unique admissions, no thirteenth", async () => {
  const f = await fixture({ status: "paid" });
  for (let n = 1; n <= 12; n++) await admission(f, n);
  expect(
    Number(
      (
        await pool.query("SELECT count(*) FROM tickets WHERE order_id=$1", [
          f.order.id,
        ])
      ).rows[0].count,
    ),
  ).toBe(12);
  await expect(admission(f, 13)).rejects.toMatchObject({ code: "23514" });
  await expect(admission(f, 1)).rejects.toMatchObject({ code: "23505" });
});
it("blocks issuance before payment and duplicate credentials", async () => {
  const f = await fixture();
  await expect(admission(f, 1)).rejects.toMatchObject({ code: "23514" });
  await pool.query("UPDATE orders SET status='paid' WHERE id=$1", [f.order.id]);
  const hash = "a".repeat(64);
  await admission(f, 1, hash);
  await expect(admission(f, 2, hash)).rejects.toMatchObject({ code: "23505" });
});
it("allows payment retries but rejects duplicated references and mismatched successful amounts", async () => {
  const f = await fixture();
  const reference = randomUUID();
  const insert = (ref: string, amount: number) =>
    pool.query(
      "INSERT INTO payments (order_id,provider_reference,expected_amount,currency) VALUES ($1,$2,$3,'NGN') RETURNING id",
      [f.order.id, ref, amount],
    );
  const first = await insert(reference, 20000);
  await insert(randomUUID(), 20000);
  await expect(insert(reference, 20000)).rejects.toMatchObject({
    code: "23505",
  });
  await expect(insert(randomUUID(), 10000)).rejects.toMatchObject({
    code: "23503",
  });
  await expect(
    pool.query("UPDATE payments SET status='succeeded' WHERE id=$1", [
      first.rows[0].id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query(
      "UPDATE payments SET status='succeeded',verified_at=now(),verified_amount=1,verified_currency='NGN' WHERE id=$1",
      [first.rows[0].id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rolls back inventory changes if another write in the transaction fails", async () => {
  const f = await fixture();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE ticket_types SET reserved_units=1 WHERE id=$1", [
      f.type.id,
    ]);
    await expect(
      client.query("UPDATE ticket_types SET sold_units=3 WHERE id=$1", [
        f.type.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  expect(
    (
      await pool.query("SELECT reserved_units FROM ticket_types WHERE id=$1", [
        f.type.id,
      ])
    ).rows[0].reserved_units,
  ).toBe(0);
});
it("only one concurrent buyer can reserve the final inventory unit", async () => {
  const f = await fixture();
  await pool.query("UPDATE ticket_types SET capacity=1 WHERE id=$1", [
    f.type.id,
  ]);
  const results = await Promise.all(
    [1, 2].map(() =>
      pool.query(
        "UPDATE ticket_types SET reserved_units=reserved_units+1 WHERE id=$1 AND reserved_units+sold_units < capacity RETURNING id",
        [f.type.id],
      ),
    ),
  );
  expect(results.map((r) => r.rowCount).sort()).toEqual([0, 1]);
});
it("concurrent duplicate issuance creates one admission", async () => {
  const f = await fixture({ status: "paid" });
  const results = await Promise.allSettled([admission(f, 1), admission(f, 1)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.code).toBe("23505");
});

it("uses a restricted runtime role without schema or destructive privileges", async () => {
  const runtime = new Pool(databaseConfig(process.env.DATABASE_URL));
  try {
    const result = await runtime.query(
      "SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create, has_table_privilege(current_user, 'events', 'SELECT') AS can_read, has_table_privilege(current_user, 'orders', 'DELETE') AS can_delete, has_table_privilege(current_user, 'organizers', 'INSERT') AS can_grant, has_table_privilege(current_user, 'organizers', 'UPDATE') AS can_promote, has_table_privilege(current_user, 'admin_audit', 'UPDATE') AS can_rewrite_audit, has_table_privilege(current_user, 'admin_audit', 'DELETE') AS can_delete_audit, has_table_privilege(current_user, 'checkout_requests', 'UPDATE') AS can_reassign_guest, has_table_privilege(current_user, 'reservations', 'DELETE') AS can_delete_hold",
    );
    expect(result.rows[0]).toEqual({
      can_create: false,
      can_read: true,
      can_delete: false,
      can_grant: false,
      can_promote: false,
      can_rewrite_audit: false,
      can_delete_audit: false,
      can_reassign_guest: false,
      can_delete_hold: false,
    });
  } finally {
    await runtime.end();
  }
});

it("enforces shared authentication limits atomically and resets expired windows", async () => {
  const identity = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => consumeLimit(pool, identity, 5, 900)),
  );
  expect(results.filter(Boolean)).toHaveLength(5);
  expect(await consumeLimit(pool, randomUUID(), 5, 900)).toBe(true);
  await pool.query(
    "UPDATE auth_throttle SET resets_at=now()-interval '1 second' WHERE key=$1",
    [createHash("sha256").update(identity).digest("hex")],
  );
  expect(await consumeLimit(pool, identity, 5, 900)).toBe(true);
});
