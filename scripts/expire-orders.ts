import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { setTimeout } from "node:timers/promises";
import { databaseConfig } from "../src/config/database";
import { expireReservations } from "../src/modules/orders/service";
loadEnvConfig(process.cwd());
const pool = new Pool(databaseConfig(process.env.DATABASE_URL));
pool.on("error", () => console.error("Reservation worker database error"));
const watch = process.argv.includes("--watch");
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
async function main() {
  try {
    do {
      try {
        const count = await expireReservations(pool, 500);
        if (count || !watch)
          console.log(`Released ${count} expired reservations.`);
      } catch {
        console.error(
          "Reservation expiry failed; retry and investigate database health.",
        );
        if (!watch) {
          process.exitCode = 1;
          break;
        }
      }
      if (watch && !stop.signal.aborted)
        await setTimeout(15000, undefined, { signal: stop.signal }).catch(
          () => {},
        );
    } while (watch && !stop.signal.aborted);
  } finally {
    await pool.end();
  }
}
void main();
