import "server-only";
import { cookies } from "next/headers";
import { env } from "@/config/server";
import { OrderError } from "./input";
import { getPool } from "@/db/client";
import { consumeLimit } from "@/modules/auth/throttle";
export const guestCookie = env.APP_URL.startsWith("https:")
  ? "__Host-ts-checkout"
  : "ts-checkout";
export async function guestIdentity() {
  const value = (await cookies()).get(guestCookie)?.value;
  if (!value || !/^[a-f0-9]{64}$/.test(value))
    throw new OrderError(401, "Start checkout in this browser first.");
  return value;
}
export async function checkoutLimit(
  identity: string,
  action: string,
  count: number,
) {
  if (
    !(await consumeLimit(getPool(), `checkout-global:${action}`, 120, 60)) ||
    !(await consumeLimit(
      getPool(),
      `checkout:${action}:${identity}`,
      count,
      900,
    ))
  )
    throw new OrderError(429, "Too many requests. Please try again later.");
}
export function orderFailure(error: unknown) {
  if (error instanceof OrderError)
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  return null;
}
