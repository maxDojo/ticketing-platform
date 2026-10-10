import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { databaseConfig } from "../src/config/database";
import { paymentConfig } from "../src/config/payments";
import {
  processDeliveryJobs,
  previewOrigin,
} from "../src/modules/delivery/worker";
import { previewTransport } from "../src/modules/delivery/preview";
import { ticketKeys } from "../src/modules/tickets/credentials";
loadEnvConfig(process.cwd());
async function main() {
  if (
    process.env.TICKET_DELIVERY_MODE !== "preview" ||
    !paymentConfig(process.env)
  )
    throw new Error("Preview test configuration required");
  const origin = previewOrigin(process.env.APP_URL ?? "");
  const keys = ticketKeys();
  const pool = new Pool(databaseConfig(process.env.DATABASE_URL));
  pool.on("error", () => console.error("Delivery database error"));
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => stop.abort());
  const watch = process.argv.includes("--watch");
  try {
    do {
      console.log(
        `Processed ${await processDeliveryJobs(pool, previewTransport(resolve(".local/ticket-mail")), origin, keys)} preview delivery jobs.`,
      );
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
  console.error(
    "Ticket preview delivery failed. Check configuration and database health.",
  );
  process.exitCode = 1;
});
