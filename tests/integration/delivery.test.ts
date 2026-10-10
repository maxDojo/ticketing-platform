import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  processDeliveryJobs,
  type Mail,
} from "../../src/modules/delivery/worker";
import { redeemAccess, requestResend } from "../../src/modules/delivery/access";
import { previewTransport } from "../../src/modules/delivery/preview";
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
const name = `ts_delivery_${randomUUID().replaceAll("-", "")}`;
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
const token = (mail: Mail) =>
  /\/tickets\/access#([a-f0-9]{64})/.exec(mail.text)![1]!;
async function deliverAll() {
  const mails: Mail[] = [];
  await processDeliveryJobs(
    pool,
    async (m) => {
      mails.push(m);
    },
    "http://localhost:3000",
    undefined,
    100,
  );
  return mails;
}
it("queues once with issuance and delivers one stable preview across retries", async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "ts-mail-"));
  const preview = previewTransport(directory);
  let original: Mail | undefined;
  try {
    await processDeliveryJobs(
      pool,
      async (mail) => {
        original = mail;
        await preview(mail);
        throw new Error("crash after transport");
      },
      "http://localhost:3000",
    );
    expect(original).toBeDefined();
    expect(original!.html).not.toContain("<script>unsafe</script>");
    expect(original!.html).toContain("&lt;script&gt;");
    const filename = join(directory, `${original!.id}.html`);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    await pool.query(
      "UPDATE ticket_delivery_jobs SET next_attempt_at=now() WHERE order_id=$1",
      [f.order.id],
    );
    await processDeliveryJobs(
      pool,
      async (mail) => {
        expect(mail).toEqual(original);
        await preview(mail);
      },
      "http://localhost:3000",
    );
    expect(await readFile(filename, "utf8")).toBe(original!.html);
    expect(
      (
        await pool.query(
          "SELECT state,attempts FROM ticket_delivery_jobs WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0],
    ).toEqual({ state: "done", attempts: 2 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ticket_access_grants WHERE order_id=$1",
          [f.order.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("redeems once concurrently and permits only that order without the checkout cookie", async () => {
  const f = await fixture();
  const mail = (await deliverAll()).find((m) => m.to === f.email)!;
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => redeemAccess(pool, token(mail))),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const result = results.find((r) => r.status === "fulfilled")!;
  if (result.status !== "fulfilled") throw Error("missing result");
  expect(
    (await guestTickets(pool, "", f.order.id, undefined, result.value.session))
      .tickets,
  ).toHaveLength(2);
  const other = await fixture();
  await expect(
    guestTickets(pool, "", other.order.id, undefined, result.value.session),
  ).rejects.toMatchObject({ status: 404 });
  await pool.query(
    "UPDATE ticket_access_grants SET revoked_at=now() WHERE order_id=$1",
    [f.order.id],
  );
  await expect(
    guestTickets(pool, "", f.order.id, undefined, result.value.session),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    pool.query(
      "UPDATE ticket_access_grants SET consumed_at=NULL WHERE order_id=$1",
      [f.order.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rejects expired links and sessions and never grants QR tokens retrieval access", async () => {
  const f = await fixture();
  const mail = (await deliverAll()).find((m) => m.to === f.email)!;
  const wallet = await guestTickets(pool, f.guest, f.order.id);
  await expect(
    redeemAccess(pool, wallet.tickets[0]!.token!),
  ).rejects.toMatchObject({ status: 404 });
  const redeemed = await redeemAccess(pool, token(mail));
  await pool.query(
    "UPDATE ticket_access_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE grant_id IN (SELECT id FROM ticket_access_grants WHERE order_id=$1)",
    [f.order.id],
  );
  await expect(
    guestTickets(pool, "", f.order.id, undefined, redeemed.session),
  ).rejects.toMatchObject({ status: 404 });
  const another = await fixture();
  const anotherMail = (await deliverAll()).find((m) => m.to === another.email)!;
  await pool.query(
    "ALTER TABLE ticket_access_grants DISABLE TRIGGER access_grant_guard",
  );
  try {
    await pool.query(
      "UPDATE ticket_access_grants SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE order_id=$1",
      [another.order.id],
    );
  } finally {
    await pool.query(
      "ALTER TABLE ticket_access_grants ENABLE TRIGGER access_grant_guard",
    );
  }
  await expect(redeemAccess(pool, token(anotherMail))).rejects.toMatchObject({
    status: 404,
  });
});
it("resends are throttled and unmatched details enqueue nothing", async () => {
  const f = await fixture();
  await deliverAll();
  await requestResend(pool, "unknown@example.test", f.order.reference);
  await requestResend(pool, f.email, "unknown-reference");
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ticket_delivery_jobs WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await requestResend(pool, f.email, f.order.reference);
  await requestResend(pool, f.email, f.order.reference);
  await requestResend(pool, f.email, f.order.reference);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ticket_delivery_jobs WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
  ).toBe(3);
});
it("reclaims expired leases and escalates repeated failures without issuing more admissions", async () => {
  await deliverAll();
  const f = await fixture();
  await pool.query(
    "UPDATE ticket_delivery_jobs SET lease_id=$2,lease_expires_at=now()-interval '1 minute',attempts=5 WHERE order_id=$1",
    [f.order.id, randomUUID()],
  );
  await Promise.all([
    processDeliveryJobs(
      pool,
      async () => {
        throw Error("unavailable");
      },
      "http://localhost:3000",
    ),
    processDeliveryJobs(
      pool,
      async () => {
        throw Error("unavailable");
      },
      "http://localhost:3000",
    ),
  ]);
  expect(
    (
      await pool.query(
        "SELECT state,attempts FROM ticket_delivery_jobs WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0],
  ).toEqual({ state: "attention", attempts: 6 });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
  ).toBe(2);
});

it("allows delivery, resend and recovery after the event starts for separate arrivals", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE events SET starts_at=now()-interval '1 hour' WHERE id=$1",
    [f.event.id],
  );
  const mail = (await deliverAll()).find((m) => m.to === f.email)!;
  expect(mail).toBeDefined();
  await requestResend(pool, f.email, f.order.reference);
  const resent = (await deliverAll()).find((m) => m.to === f.email)!;
  expect(resent).toBeDefined();
  const recovered = await redeemAccess(pool, token(resent));
  expect(
    (await guestTickets(pool, "", f.order.id, undefined, recovered.session))
      .tickets,
  ).toHaveLength(2);
});
