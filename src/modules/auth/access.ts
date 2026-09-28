import "server-only";
import { getAuth } from "./server";
import { getPool } from "@/db/client";
export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireOrganizer(
  headers: Headers,
  allowEnrollment = false,
) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new AccessError(401, "Sign in to continue.");
  const { rows } = await getPool().query(
    'SELECT o.active, s."mfaVerified" FROM organizers o JOIN auth_session s ON s."userId"=o.user_id WHERE o.user_id=$1 AND s.id=$2 AND s."expiresAt">now()',
    [session.user.id, session.session.id],
  );
  if (!rows[0]?.active)
    throw new AccessError(403, "Organizer access is not available.");
  if (
    !allowEnrollment &&
    (!session.user.twoFactorEnabled || !rows[0].mfaVerified)
  )
    throw new AccessError(403, "Complete two-factor verification to continue.");
  return {
    userId: session.user.id,
    name: session.user.name,
    twoFactorEnabled: !!session.user.twoFactorEnabled,
  };
}
