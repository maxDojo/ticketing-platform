import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { databaseConfig } from "../src/config/database";
loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2);
  const staff = args[0] === "--staff";
  const [email, name, eventId] = args.slice(staff ? 1 : 0);
  if (staff && !z.uuid().safeParse(eventId).success)
    throw new Error("Usage: pnpm staff:create email name event-id");
  if (!z.email().safeParse(email).success || !name?.trim() || name.length > 200)
    throw new Error("Usage: pnpm organizer:create email name");
  if (!process.stdin.isTTY)
    throw new Error(
      "Use an interactive terminal to enter the password privately.",
    );
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write("New account password (14–128 characters; hidden): ");
  const password = await new Promise<string>((resolve) =>
    rl.question("", resolve),
  );
  rl.close();
  process.stdout.write("\n");
  if (password.length < 14 || password.length > 128)
    throw new Error("Password must be 14–128 characters.");
  const pool = new Pool(databaseConfig(process.env.MIGRATION_DATABASE_URL));
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      await client.query(
        'INSERT INTO auth_user (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',
        [id, name.trim(), email!.trim().toLowerCase()],
      );
      await client.query(
        'INSERT INTO auth_account (id,"accountId","providerId","userId",password) VALUES ($1,$2,\'credential\',$2,$3)',
        [randomUUID(), id, await hashPassword(password)],
      );
      if (staff)
        await client.query(
          "INSERT INTO event_staff (user_id,event_id) VALUES ($1,$2)",
          [id, eventId],
        );
      else
        await client.query("INSERT INTO organizers (user_id) VALUES ($1)", [
          id,
        ]);
      await client.query("COMMIT");
      console.log(
        staff
          ? "Staff account created. Sign in at /staff/sign-in and enroll an authenticator."
          : "Organizer created. Sign in and enroll an authenticator before managing events.",
      );
    } catch {
      await client.query("ROLLBACK");
      throw new Error(
        "Could not create account; check configuration and whether this email already exists.",
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Organizer creation failed.");
  process.exitCode = 1;
});
