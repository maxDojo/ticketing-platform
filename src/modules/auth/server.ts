import "server-only";
import { createAuth } from "./factory";
import { getPool } from "@/db/client";
import { env } from "@/config/server";
import { authSecret } from "@/config/auth";
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth(
    getPool(),
    env.APP_URL,
    authSecret(process.env.BETTER_AUTH_SECRET),
  ));
}
