import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { z } from "zod";
import { databaseConfig } from "../src/config/database";
loadEnvConfig(process.cwd());
async function main() {
  const [action, email, eventId] = process.argv.slice(2);
  if (
    !["grant", "revoke"].includes(action ?? "") ||
    !z.email().safeParse(email).success ||
    !z.uuid().safeParse(eventId).success
  )
    throw Error("Usage: pnpm staff:access grant|revoke email event-id");
  const pool = new Pool(databaseConfig(process.env.MIGRATION_DATABASE_URL));
  try {
    const {
      rows: [user],
    } = await pool.query("SELECT id FROM auth_user WHERE email=$1", [
      email!.trim().toLowerCase(),
    ]);
    if (!user)
      throw Error(
        "Account not found. Create an individually verified staff account first.",
      );
    if (action === "grant")
      await pool.query(
        "INSERT INTO event_staff(user_id,event_id) VALUES ($1,$2) ON CONFLICT(event_id,user_id) DO UPDATE SET active=true",
        [user.id, eventId],
      );
    else
      await pool.query(
        "UPDATE event_staff SET active=false WHERE user_id=$1 AND event_id=$2",
        [user.id, eventId],
      );
    console.log(
      "Staff membership updated. An in-flight authorized request may finish; subsequent requests recheck membership.",
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Staff access update failed. Check arguments, account and event.",
  );
  process.exitCode = 1;
});
