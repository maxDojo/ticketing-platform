import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { setTimeout } from "node:timers/promises";
import { databaseConfig } from "../src/config/database";
import { paymentConfig } from "../src/config/payments";
import { paystackVerifier } from "../src/modules/payments/verification";
import { processPaymentJobs } from "../src/modules/payments/jobs";
loadEnvConfig(process.cwd());
async function main() {
  const config = paymentConfig(process.env);
  if (!config) throw new Error("Test payment configuration required");
  const pool = new Pool(databaseConfig(process.env.DATABASE_URL));
  pool.on("error", () => console.error("Payment worker database error"));
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  const watch = process.argv.includes("--watch");
  try {
    do {
      try {
        const count = await processPaymentJobs(
          pool,
          paystackVerifier(config.secret),
        );
        if (count || !watch)
          console.log(`Processed ${count} payment verification jobs.`);
      } catch {
        console.error(
          "Payment verification worker failed; investigate database health.",
        );
        if (!watch) {
          process.exitCode = 1;
          break;
        }
      }
      if (watch && !stop.signal.aborted)
        await setTimeout(5000, undefined, { signal: stop.signal }).catch(
          () => {},
        );
    } while (watch && !stop.signal.aborted);
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error("Payment worker could not start. Check test configuration.");
  process.exitCode = 1;
});
