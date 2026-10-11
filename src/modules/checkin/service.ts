import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { transaction, digest } from "../orders/service";
export class GateError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type GateActor = { userId: string; sessionId: string };
export const admissionInput = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("qr"),
      token: z.string().regex(/^tsq_test_v1_[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z
    .object({
      method: z.literal("manual"),
      ticketId: z.uuid(),
      reason: z.string().trim().min(5).max(200),
    })
    .strict(),
]);
export async function gateSession(
  db: PoolClient,
  actor: GateActor,
  enrollment = false,
) {
  const {
    rows: [session],
  } = await db.query(
    `SELECT u."twoFactorEnabled",s."mfaVerified" FROM auth_session s JOIN auth_user u ON u.id=s."userId" WHERE s.id=$1 AND s."userId"=$2 AND s."expiresAt">clock_timestamp() FOR SHARE OF s,u`,
    [actor.sessionId, actor.userId],
  );
  if (!session) throw new GateError(401, "Sign in to continue.");
  if (!enrollment && (!session.twoFactorEnabled || !session.mfaVerified))
    throw new GateError(403, "Complete two-factor verification to continue.");
  return session;
}
async function authorize(db: PoolClient, actor: GateActor, eventId: string) {
  if (!z.uuid().safeParse(eventId).success)
    throw new GateError(404, "Event unavailable.");
  await gateSession(db, actor);
  const {
    rows: [event],
  } = await db.query(
    "SELECT id,name,status,organizer_id FROM events WHERE id=$1 FOR SHARE",
    [eventId],
  );
  if (!event) throw new GateError(404, "Event unavailable.");
  const { rows: owners } = await db.query(
    "SELECT user_id FROM organizers WHERE user_id=$1 AND active=true",
    [actor.userId],
  );
  if (!(event.organizer_id === actor.userId && owners.length)) {
    const { rowCount } = await db.query(
      "SELECT id FROM event_staff WHERE event_id=$1 AND user_id=$2 AND active=true",
      [eventId, actor.userId],
    );
    if (!rowCount) throw new GateError(404, "Event unavailable.");
  }
  return event;
}
export async function gateAccount(
  pool: Pool,
  actor: GateActor,
  enrollment = false,
) {
  return transaction(pool, async (db) => {
    const session = await gateSession(db, actor, enrollment);
    const {
      rows: [role],
    } = await db.query(
      "SELECT EXISTS(SELECT 1 FROM organizers WHERE user_id=$1 AND active=true) OR EXISTS(SELECT 1 FROM event_staff WHERE user_id=$1 AND active=true) AS allowed",
      [actor.userId],
    );
    if (!role.allowed) throw new GateError(403, "Staff access is unavailable.");
    return { twoFactorEnabled: !!session.twoFactorEnabled };
  });
}
export async function gateEvents(pool: Pool, actor: GateActor) {
  await gateAccount(pool, actor);
  return (
    await pool.query(
      `SELECT e.id,e.name,e.starts_at FROM events e WHERE (EXISTS(SELECT 1 FROM organizers o WHERE o.user_id=$1 AND o.active=true AND e.organizer_id=o.user_id) OR EXISTS(SELECT 1 FROM event_staff s WHERE s.event_id=e.id AND s.user_id=$1 AND s.active=true)) ORDER BY e.starts_at DESC LIMIT 100`,
      [actor.userId],
    )
  ).rows;
}
export async function gateView(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  search?: string,
) {
  return transaction(pool, async (db) => {
    const event = await authorize(db, actor, eventId);
    if (
      search !== undefined &&
      (search.trim().length < 3 || search.length > 200)
    )
      throw new GateError(400, "Enter at least three characters.");
    const query = search?.trim().replace(/[\\%_]/g, "\\$&");
    const { rows: tickets } =
      search === undefined
        ? { rows: [] }
        : await db.query(
            `SELECT t.id,t.reference,t.status,i.ticket_type_name AS category,o.buyer_name,o.reference AS order_reference,t.admission_ordinal,c.created_at AS checked_in_at FROM tickets t JOIN orders o ON o.id=t.order_id JOIN order_items i ON i.id=t.order_item_id LEFT JOIN check_ins c ON c.ticket_id=t.id WHERE t.event_id=$1 AND (o.buyer_name ILIKE $2 OR lower(o.buyer_email)=lower($3) OR o.reference=$3 OR t.reference::text=$3) ORDER BY o.created_at DESC,t.id LIMIT 50`,
            [eventId, `%${query}%`, search?.trim()],
          );
    const { rows: recent } = await db.query(
      `SELECT t.reference,i.ticket_type_name AS category,c.method,c.created_at,u.name AS actor FROM check_ins c JOIN tickets t ON t.id=c.ticket_id JOIN order_items i ON i.id=t.order_item_id JOIN auth_user u ON u.id=c.actor_id WHERE c.event_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 20`,
      [eventId],
    );
    const {
      rows: [counts],
    } = await db.query(
      "SELECT count(*)::int AS admitted FROM check_ins WHERE event_id=$1",
      [eventId],
    );
    return {
      event: { id: event.id, name: event.name, status: event.status },
      tickets,
      recent,
      admitted: counts.admitted,
    };
  });
}
export async function admit(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  raw: unknown,
) {
  const parsed = admissionInput.safeParse(raw);
  if (!parsed.success) throw new GateError(400, "Invalid admission request.");
  const input = parsed.data;
  return transaction(pool, async (db) => {
    const event = await authorize(db, actor, eventId);
    if (event.status !== "published")
      throw new GateError(409, "Event is not open for check-in.");
    // Event, then order, then ticket. Recheck status while holding locks shared with cancellation/refund.
    const {
      rows: [scope],
    } = await db.query(
      `SELECT order_id,id FROM tickets WHERE event_id=$1 AND ${input.method === "qr" ? "credential_hash" : "id"}=$2`,
      [eventId, input.method === "qr" ? digest(input.token) : input.ticketId],
    );
    if (!scope) return { outcome: "invalid" as const };
    const {
      rows: [order],
    } = await db.query("SELECT status FROM orders WHERE id=$1 FOR SHARE", [
      scope.order_id,
    ]);
    const {
      rows: [ticket],
    } = await db.query(
      `SELECT t.id,t.reference,t.status,i.ticket_type_name AS category FROM tickets t JOIN order_items i ON i.id=t.order_item_id WHERE t.id=$1 FOR UPDATE OF t`,
      [scope.id],
    );
    if (
      !["paid", "partially_refunded"].includes(order.status) ||
      ticket.status !== "valid"
    )
      return { outcome: "invalid" as const };
    const {
      rows: [previous],
    } = await db.query("SELECT created_at FROM check_ins WHERE ticket_id=$1", [
      ticket.id,
    ]);
    if (previous)
      return {
        outcome: "already_checked_in" as const,
        reference: ticket.reference,
        category: ticket.category,
        checkedInAt: previous.created_at,
      };
    const {
      rows: [record],
    } = await db.query(
      "INSERT INTO check_ins (ticket_id,event_id,actor_id,method,reason) VALUES ($1,$2,$3,$4,$5) RETURNING created_at",
      [
        ticket.id,
        eventId,
        actor.userId,
        input.method,
        input.method === "manual" ? input.reason : null,
      ],
    );
    await db.query(
      "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,$2,$3)",
      [actor.userId, `ticket.check_in.${input.method}`, ticket.id],
    );
    return {
      outcome: "admitted" as const,
      reference: ticket.reference,
      category: ticket.category,
      checkedInAt: record.created_at,
    };
  });
}
