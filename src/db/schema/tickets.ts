import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  check,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";

import { orderItems } from "./orders";
import { createdAt } from "./columns";

export const ticketStatus = pgEnum("ticket_status", [
  "valid",
  "cancelled",
  "refunded",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 100 }).notNull().unique(),
    orderId: uuid("order_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    eventId: uuid("event_id").notNull(),
    admissionOrdinal: integer("admission_ordinal").notNull(),
    attendeeName: varchar("attendee_name", { length: 200 }),
    status: ticketStatus("status").notNull().default("valid"),
    credentialHash: varchar("credential_hash", { length: 64 })
      .notNull()
      .unique(),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    credentialKeyId: text("credential_key_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "ticket_item_scope",
      columns: [t.orderItemId, t.orderId, t.eventId],
      foreignColumns: [orderItems.id, orderItems.orderId, orderItems.eventId],
    }),
    unique("ticket_admission_once").on(t.orderItemId, t.admissionOrdinal),
    index("tickets_event_idx").on(t.eventId),
    index("tickets_order_idx").on(t.orderId),
    check("ticket_admission_positive", sql`${t.admissionOrdinal} > 0`),
    check("ticket_reference_present", sql`length(trim(${t.reference})) > 0`),
    check(
      "ticket_credential_hash",
      sql`${t.credentialHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ticket_credential_material",
      sql`length(trim(${t.credentialCiphertext})) > 0 and length(trim(${t.credentialKeyId})) > 0`,
    ),
  ],
);
