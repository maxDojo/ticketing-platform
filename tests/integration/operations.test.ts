import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeEach, expect, it } from "vitest";
import { createOrderTestContext } from "./helpers/orders";
import { operationsHealth } from "../../src/modules/operations/health";
import { confirmPayment } from "../../src/modules/payments/confirmation";

const { pool, paymentFixture, ageOrder } = createOrderTestContext();
beforeEach(async () => {
  // This pool belongs exclusively to the disposable operations test database.
  await pool.query("TRUNCATE events, auth_user CASCADE");
});
async function counts() {
  const report = await operationsHealth(pool);
  return Object.fromEntries(report.checks.map((c) => [c.name, c.count]));
}
async function paidFixture() {
  const f = await paymentFixture();
  await confirmPayment(pool, f.p.id, f.verified);
  return f;
}

it("reports a healthy database without exposing buyer data or changing records", async () => {
  const f = await paidFixture();
  const before = await pool.query("SELECT * FROM payments ORDER BY id");
  const report = await operationsHealth(pool);
  expect(report.status).toBe("ok");
  expect(report.checks).toHaveLength(9);
  expect(report.checks.every((c) => c.count === 0)).toBe(true);
  for (const value of [
    f.order.id,
    f.p.provider_reference,
    f.input.buyerEmail,
    f.guest,
  ])
    expect(JSON.stringify(report)).not.toContain(value);
  expect((await pool.query("SELECT * FROM payments ORDER BY id")).rows).toEqual(
    before.rows,
  );
});

it.each([
  ["payments", "payment_jobs", "pending", "done"],
  ["delivery", "ticket_delivery_jobs", "pending", "done"],
  ["refunds", "refunds", "processing", "processed"],
])(
  "detects %s backlog and attention while respecting backoff and active leases",
  async (name, table, pending, done) => {
    const f = await paidFixture();
    if (table === "refunds") {
      const actor = randomUUID();
      await pool.query(
        "INSERT INTO auth_user(id,name,email) VALUES ($1,'Synthetic',$2)",
        [actor, `${actor}@example.test`],
      );
      await pool.query("INSERT INTO organizers(user_id) VALUES ($1)", [actor]);
      await pool.query("UPDATE events SET organizer_id=$1 WHERE id=$2", [
        actor,
        f.event.id,
      ]);
      await pool.query(
        "UPDATE tickets SET status='cancelled' WHERE order_id=$1",
        [f.order.id],
      );
      await pool.query(
        "INSERT INTO refunds(payment_id,order_id,event_id,actor_id,amount,currency,kind,reason) VALUES ($1,$2,$3,$4,$5,'NGN','fulfilled','Synthetic refund')",
        [f.p.id, f.order.id, f.event.id, actor, f.p.expected_amount],
      );
    }
    // Table/state identifiers come only from the fixed test cases above.
    await pool.query(
      `UPDATE ${table} SET state=$1,next_attempt_at=now()+interval '1 hour'`,
      [pending],
    );
    expect((await counts())[`${name}_overdue`]).toBe(0);
    await pool.query(
      `UPDATE ${table} SET next_attempt_at=now()-interval '1 minute'`,
    );
    expect((await counts())[`${name}_overdue`]).toBe(0);
    await pool.query(
      `UPDATE ${table} SET next_attempt_at=now()-interval '6 minutes',lease_expires_at=now()+interval '1 minute'`,
    );
    expect((await counts())[`${name}_overdue`]).toBe(0);
    await pool.query(
      `UPDATE ${table} SET lease_expires_at=now()-interval '1 second'`,
    );
    expect((await counts())[`${name}_overdue`]).toBe(1);
    expect((await operationsHealth(pool)).status).toBe("attention");
    await pool.query(`UPDATE ${table} SET state='attention'`);
    expect((await counts())[`${name}_attention`]).toBe(1);
    expect((await counts())[`${name}_overdue`]).toBe(0);
    await pool.query(
      `UPDATE ${table} SET state=$1${table === "refunds" ? ",processed_at=now()" : ""}`,
      [done],
    );
    expect((await counts())[`${name}_attention`]).toBe(0);
    expect((await counts())[`${name}_overdue`]).toBe(0);
  },
);

it("detects overdue reservations but ignores cancelled orders", async () => {
  const f = await paymentFixture();
  await ageOrder(f.order.id);
  expect((await counts()).reservations_overdue).toBe(1);
  await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1", [
    f.order.id,
  ]);
  expect((await counts()).reservations_overdue).toBe(0);
});

it("detects incomplete paid admissions and missing fulfillment without counting cancelled tickets as missing", async () => {
  const f = await paidFixture();
  await pool.query("UPDATE tickets SET status='cancelled' WHERE order_id=$1", [
    f.order.id,
  ]);
  expect((await counts()).paid_orders_missing_tickets).toBe(0);
  await pool.query(
    "DELETE FROM tickets WHERE id=(SELECT id FROM tickets WHERE order_id=$1 LIMIT 1)",
    [f.order.id],
  );
  expect((await counts()).paid_orders_missing_tickets).toBe(1);
  await pool.query("DELETE FROM payment_fulfillments WHERE order_id=$1", [
    f.order.id,
  ]);
  expect((await counts()).paid_orders_missing_fulfillment).toBe(1);
});

it("rejects invalid thresholds before querying", async () => {
  for (const threshold of [0, -1, 1.5, NaN, Infinity, 86401])
    await expect(operationsHealth(pool, threshold)).rejects.toThrow(
      "Invalid operations threshold",
    );
});

const run = promisify(execFile);
function cli(databaseUrl = pool.options.connectionString) {
  return run(
    process.execPath,
    ["--import", "tsx", "scripts/check-operations.ts"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 10000,
    },
  );
}
it("returns success and attention exit codes from the read-only CLI", async () => {
  expect(JSON.parse((await cli()).stdout).status).toBe("ok");
  const f = await paymentFixture();
  await ageOrder(f.order.id);
  await expect(cli()).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining('"status":"attention"'),
  });
});
it("fails closed with redacted output when the CLI cannot connect", async () => {
  await expect(
    cli("postgresql://secret-user:secret-password@127.0.0.1:1/missing"),
  ).rejects.toMatchObject({
    code: 2,
    stdout: "",
    stderr: '{"status":"unavailable"}\n',
  });
});
