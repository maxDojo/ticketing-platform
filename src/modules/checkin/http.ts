import "server-only";
import { getAuth } from "../auth/server";
import { AccessError } from "../auth/access";
import { gateAccount, GateError } from "./service";
import { getPool } from "@/db/client";
import { failure } from "../auth/http";
export async function gateActor(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new AccessError(401, "Sign in to continue.");
  return { userId: session.user.id, sessionId: session.session.id };
}
export async function requireStaffAccount(
  headers: Headers,
  enrollment = false,
) {
  const actor = await gateActor(headers);
  try {
    return { ...actor, ...(await gateAccount(getPool(), actor, enrollment)) };
  } catch (error) {
    if (error instanceof GateError)
      throw new AccessError(error.status, error.message);
    throw error;
  }
}
export function gateFailure(error: unknown) {
  return failure(
    error instanceof GateError
      ? new AccessError(error.status, error.message)
      : error,
  );
}
