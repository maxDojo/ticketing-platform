import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { databaseConfig } from "../config/database";
import * as schema from "./schema";

const globalDatabase = globalThis as unknown as { ticketSquarePool?: Pool };
function createPool() {
  const pool = new Pool(databaseConfig(process.env.DATABASE_URL));
  // Do not print pg errors: they can contain SQL, customer data, or credentials.
  pool.on("error", () => console.error("Database connection error"));
  return pool;
}
export function getPool() {
  return (globalDatabase.ticketSquarePool ??= createPool());
}
export function getDatabase() {
  return drizzle(getPool(), { schema });
}
