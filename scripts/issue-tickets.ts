import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { databaseConfig } from "../src/config/database";
import { paymentConfig } from "../src/config/payments";
import { recoverTickets } from "../src/modules/tickets/issuance";
loadEnvConfig(process.cwd());
async function main() {
  if (!paymentConfig(process.env))
    throw new Error("Test configuration required");
  const pool = new Pool(databaseConfig(process.env.DATABASE_URL));
  try {
    console.log(
      `Issued ${await recoverTickets(pool)} missing test admissions.`,
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Ticket recovery failed. Check key configuration and database health.",
  );
  process.exitCode = 1;
});
