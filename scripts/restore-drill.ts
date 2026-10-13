import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseConfig } from "../src/config/database";
import { postgresTools } from "./restore-drill/postgres-tools";
import { drillConnection } from "./restore-drill/config";
import { seedDrill } from "./restore-drill/fixture";
import { fingerprint, verifyRestoredTickets } from "./restore-drill/verify";

loadEnvConfig(process.cwd());
async function main() {
  // Never fall back to runtime/migration URLs, and never accept a restore target.
  const { config, connection } = drillConnection(process.env.TEST_DATABASE_URL);
  const tools = await postgresTools(connection);
  const prefix = `ts_restore_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool(config);
  admin.on("error", () => {
    /* Suppress raw connection details. */
  });
  const created: string[] = [];
  const pools: Pool[] = [];
  let directory: string | undefined;
  const started = Date.now();
  let tables = 0;
  try {
    directory = await mkdtemp(join(tmpdir(), "ticketsquare-restore-"));
    const archive = join(directory, "synthetic.dump");
    async function database(suffix: "source" | "target") {
      const name = `${prefix}_${suffix}`;
      await admin.query(`CREATE DATABASE "${name}"`);
      created.push(name);
      const url = new URL(connection);
      url.pathname = `/${name}`;
      const pool = new Pool(databaseConfig(url.toString()));
      pool.on("error", () => {
        /* Details may contain credentials; do not log. */
      });
      pools.push(pool);
      return { name, pool };
    }
    const source = await database("source");
    await migrate(drizzle(source.pool), { migrationsFolder: "./drizzle" });
    const fixture = await seedDrill(source.pool);
    const before = await fingerprint(source.pool);
    await tools.dump(source.name, archive);
    const target = await database("target");
    await tools.restore(target.name, archive);
    assert.deepEqual(await fingerprint(target.pool), before);
    await verifyRestoredTickets(target.pool, fixture.orderId, fixture.keys);
    tables = before.data.length;
  } finally {
    // Attempt every cleanup even when an earlier step failed. Only generated names.
    const closed = await Promise.allSettled(pools.map((pool) => pool.end()));
    const dropped = await Promise.allSettled(
      created.map((name) => admin.query(`DROP DATABASE "${name}"`)),
    );
    const removed = await Promise.allSettled([
      admin.end(),
      ...(directory ? [rm(directory, { recursive: true, force: true })] : []),
    ]);
    if (
      [...closed, ...dropped, ...removed].some((r) => r.status === "rejected")
    )
      throw new Error("Drill cleanup incomplete");
  }
  console.log(
    JSON.stringify({
      status: "verified",
      tables,
      admissions: 3,
      durationMs: Date.now() - started,
    }),
  );
}
main().catch(() => {
  console.error(
    "Restore drill failed. Check local test database/container access and disposable drill cleanup; details suppressed.",
  );
  process.exitCode = 1;
});
