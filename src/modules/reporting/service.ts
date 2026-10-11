import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "../orders/service";
import { gateSession, type GateActor } from "../checkin/service";
import { reportInput, ReportError, type ReportInput } from "./input";
import { csv } from "./csv";
export const orderColumns = [
  "reference",
  "buyer_name",
  "buyer_email",
  "status",
  "currency",
  "total_minor",
  "created_at",
  "fulfilled_at",
  "issued_admissions",
  "checked_in_admissions",
] as const;
export const admissionColumns = [
  "reference",
  "buyer_name",
  "buyer_email",
  "order_reference",
  "category",
  "admission_ordinal",
  "status",
  "checked_in_at",
  "check_in_method",
  "checked_in_by",
] as const;
async function owner(db: PoolClient, actor: GateActor, eventId: string) {
  if (!z.uuid().safeParse(eventId).success)
    throw new ReportError(404, "Event not found.");
  await gateSession(db, actor);
  const {
    rows: [event],
  } = await db.query(
    "SELECT e.id,e.name FROM events e JOIN organizers o ON o.user_id=e.organizer_id WHERE e.id=$1 AND o.user_id=$2 AND o.active=true FOR SHARE OF e",
    [eventId, actor.userId],
  );
  if (!event) throw new ReportError(404, "Event not found.");
  return event;
}
async function totals(db: PoolClient, eventId: string) {
  const { rows: money } = await db.query(
    `WITH sales AS (
 SELECT o.currency,count(*)::text AS fulfilled_orders,sum(o.total)::text AS gross_sales_minor FROM orders o JOIN payment_fulfillments f ON f.order_id=o.id WHERE o.event_id=$1 GROUP BY o.currency
 ), collections AS (
 SELECT p.currency,count(*)::text AS verified_payments,sum(p.verified_amount)::text AS verified_collections_minor,coalesce(sum(p.provider_fees),0)::text AS recorded_fees_minor,count(*) FILTER(WHERE p.provider_fees IS NULL)::text AS missing_fee_payments FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.event_id=$1 AND p.status='succeeded' GROUP BY p.currency
 ) SELECT coalesce(s.currency,c.currency) AS currency,coalesce(s.fulfilled_orders,'0') AS fulfilled_orders,coalesce(s.gross_sales_minor,'0') AS gross_sales_minor,coalesce(c.verified_payments,'0') AS verified_payments,coalesce(c.verified_collections_minor,'0') AS verified_collections_minor,coalesce(c.recorded_fees_minor,'0') AS recorded_fees_minor,coalesce(c.missing_fee_payments,'0') AS missing_fee_payments FROM sales s FULL JOIN collections c ON c.currency=s.currency ORDER BY currency`,
    [eventId],
  );
  const {
    rows: [attendance],
  } = await db.query(
    `SELECT count(*)::text AS issued,count(c.id)::text AS checked_in,count(*) FILTER(WHERE t.status='valid' AND c.id IS NULL)::text AS valid_not_checked_in,count(*) FILTER(WHERE t.status<>'valid')::text AS invalidated FROM tickets t LEFT JOIN check_ins c ON c.ticket_id=t.id WHERE t.event_id=$1`,
    [eventId],
  );
  const { rows: inventory } = await db.query(
    "SELECT id,name,capacity,reserved_units,sold_units,(capacity-reserved_units-sold_units) AS available_units,admissions_per_unit FROM ticket_types WHERE event_id=$1 ORDER BY created_at,id",
    [eventId],
  );
  const { rows: orderStates } = await db.query(
    "SELECT status,count(*)::text AS count FROM orders WHERE event_id=$1 GROUP BY status ORDER BY status",
    [eventId],
  );
  return { money, attendance, inventory, orderStates };
}
function filter(input: ReportInput) {
  const search = input.search.replace(/[\\%_]/g, "\\$&");
  const name =
    "(o.buyer_name ILIKE $2 OR lower(o.buyer_email)=lower($3) OR o.reference=$3";
  const where =
    input.kind === "orders"
      ? `${name}) AND ($4='all' OR o.status::text=$4)`
      : `${name} OR t.reference=$3) AND ($4='all' OR ($4='checked_in' AND c.id IS NOT NULL) OR ($4='not_checked_in' AND t.status='valid' AND c.id IS NULL) OR t.status::text=$4)`;
  return { where, args: [`%${search}%`, input.search, input.status] };
}
export async function report(
  pool: Pool,
  actor: GateActor,
  eventId: string,
  raw: unknown,
) {
  const parsed = reportInput.safeParse(raw);
  if (!parsed.success) throw new ReportError(400, "Invalid report filters.");
  const input = parsed.data;
  return transaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const event = await owner(db, actor, eventId);
    const f = filter(input),
      args = [eventId, ...f.args];
    const base =
      input.kind === "orders"
        ? `FROM orders o LEFT JOIN payment_fulfillments f ON f.order_id=o.id WHERE o.event_id=$1 AND ${f.where}`
        : `FROM tickets t JOIN orders o ON o.id=t.order_id JOIN order_items i ON i.id=t.order_item_id LEFT JOIN check_ins c ON c.ticket_id=t.id LEFT JOIN auth_user u ON u.id=c.actor_id WHERE t.event_id=$1 AND ${f.where}`;
    const {
      rows: [count],
    } = await db.query(`SELECT count(*)::text AS total ${base}`, args);
    if (input.export && BigInt(count.total) > 10000n)
      throw new ReportError(
        422,
        "Export exceeds 10,000 rows. Narrow the search or status filter.",
      );
    const fields =
      input.kind === "orders"
        ? `o.reference,o.buyer_name,o.buyer_email,o.status,o.currency,o.total::text AS total_minor,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,to_char(f.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fulfilled_at,(SELECT count(*)::text FROM tickets t WHERE t.order_id=o.id) AS issued_admissions,(SELECT count(*)::text FROM check_ins c JOIN tickets t ON t.id=c.ticket_id WHERE t.order_id=o.id) AS checked_in_admissions`
        : `t.reference,o.buyer_name,o.buyer_email,o.reference AS order_reference,i.ticket_type_name AS category,t.admission_ordinal,t.status,to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_in_at,c.method AS check_in_method,u.name AS checked_in_by`;
    const sort =
      input.kind === "orders"
        ? "o.created_at DESC,o.id DESC"
        : "t.created_at DESC,t.id DESC";
    const { rows } = await db.query(
      `SELECT ${fields} ${base} ORDER BY ${sort} LIMIT $5 OFFSET $6`,
      [
        ...args,
        input.export ? 10000 : 50,
        input.export ? 0 : (input.page - 1) * 50,
      ],
    );
    if (input.export) {
      await db.query(
        "INSERT INTO admin_audit(actor_id,action,resource_id) VALUES ($1,$2,$3)",
        [actor.userId, `report.export.${input.kind}`, eventId],
      );
      return {
        type: "download" as const,
        download: csv(
          rows,
          input.kind === "orders" ? orderColumns : admissionColumns,
        ),
        kind: input.kind,
      };
    }
    return {
      type: "view" as const,
      event,
      rows,
      total: count.total,
      page: input.page,
      pageSize: 50,
      summary: await totals(db, eventId),
    };
  });
}
