import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseConfig } from "../src/config/database";
loadEnvConfig(process.cwd());
async function main() {
  // A separate migration credential is mandatory; never silently use app credentials.
  const pool = new Pool(databaseConfig(process.env.MIGRATION_DATABASE_URL));
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(726391002)");
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
      console.log("Database migrations applied successfully.");
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(726391002)")
        .catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Migration failed. Check migration credentials, connectivity, and reviewed SQL; details suppressed to protect data.",
  );
  process.exitCode = 1;
});
