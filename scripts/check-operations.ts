import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { databaseConfig } from "../src/config/database";
import { operationsHealth } from "../src/modules/operations/health";

loadEnvConfig(process.cwd());
async function main() {
  const pool = new Pool({
    ...databaseConfig(process.env.DATABASE_URL),
    max: 1,
    // Defense in depth: this command must never mutate application records.
    options: "-c default_transaction_read_only=on",
    application_name: "ticketsquare-operations",
  });
  pool.on("error", () => {
    console.error("Operations database connection error");
    process.exitCode = 2;
  });
  try {
    const report = await operationsHealth(pool);
    console.log(JSON.stringify(report));
    if (process.exitCode !== 2)
      process.exitCode = report.status === "ok" ? 0 : 1;
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  // pg errors can include SQL, connection details or customer information.
  console.error(JSON.stringify({ status: "unavailable" }));
  process.exitCode = 2;
});
