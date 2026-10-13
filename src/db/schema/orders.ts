import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
  check,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";

import { events, ticketTypes } from "./events";
import { createdAt, money } from "./columns";

export const orderStatus = pgEnum("order_status", [
  "pending",
  "expired",
  "paid",
  "cancelled",
  "payment_exception",
  "refunded",
  "partially_refunded",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 100 }).notNull().unique(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    buyerName: varchar("buyer_name", { length: 200 }).notNull(),
    buyerEmail: varchar("buyer_email", { length: 320 }).notNull(),
    buyerPhone: varchar("buyer_phone", { length: 32 }),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    subtotal: money("subtotal").notNull(),
    discount: money("discount")
      .notNull()
      .default(sql`0`),
    fees: money("fees")
      .notNull()
      .default(sql`0`),
    total: money("total").notNull(),
    status: orderStatus("status").notNull().default("pending"),
    reservationMinutes: integer("reservation_minutes").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("order_event_currency").on(t.id, t.eventId, t.currency),
    unique("order_payment_amount").on(t.id, t.currency, t.total),
    index("orders_event_created_idx").on(t.eventId, t.createdAt),
    index("orders_expiry_idx")
      .on(t.reservationExpiresAt)
      .where(sql`${t.status} = 'pending'`),
    check(
      "order_buyer_present",
      sql`length(trim(${t.buyerName})) > 0 and length(trim(${t.buyerEmail})) > 0`,
    ),
    check("order_reference_present", sql`length(trim(${t.reference})) > 0`),
    check("order_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "order_amounts",
      sql`${t.subtotal} >= 0 and ${t.discount} >= 0 and ${t.discount} <= ${t.subtotal} and ${t.fees} >= 0 and ${t.total} = ${t.subtotal} - ${t.discount} + ${t.fees}`,
    ),
    check(
      "order_reservation_bounds",
      sql`${t.reservationMinutes} between 1 and 1440`,
    ),
    check(
      "order_reservation_expiry",
      sql`${t.reservationExpiresAt} = ${t.reservedAt} + ${t.reservationMinutes} * interval '1 minute'`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    eventId: uuid("event_id").notNull(),
    ticketTypeId: uuid("ticket_type_id").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    ticketTypeName: varchar("ticket_type_name", { length: 200 }).notNull(),
    unitPrice: money("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    admissionsPerUnit: integer("admissions_per_unit").notNull(),
    subtotal: money("subtotal").notNull(),
    discount: money("discount")
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [
    unique("item_order_event").on(t.id, t.orderId, t.eventId),
    unique("item_type_per_order").on(t.orderId, t.ticketTypeId),
    foreignKey({
      name: "item_order_scope",
      columns: [t.orderId, t.eventId, t.currency],
      foreignColumns: [orders.id, orders.eventId, orders.currency],
    }),
    foreignKey({
      name: "item_type_scope",
      columns: [t.ticketTypeId, t.eventId, t.currency],
      foreignColumns: [
        ticketTypes.id,
        ticketTypes.eventId,
        ticketTypes.currency,
      ],
    }),
    index("order_items_type_idx").on(t.ticketTypeId),
    check(
      "item_quantities",
      sql`${t.quantity} > 0 and ${t.admissionsPerUnit} > 0`,
    ),
    check("item_name_present", sql`length(trim(${t.ticketTypeName})) > 0`),
    check(
      "item_amounts",
      sql`${t.unitPrice} >= 0 and ${t.subtotal} = ${t.unitPrice} * ${t.quantity} and ${t.discount} >= 0 and ${t.discount} <= ${t.subtotal}`,
    ),
  ],
);

export const checkoutRequests = pgTable(
  "checkout_requests",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id),
    guestHash: varchar("guest_hash", { length: 64 }).notNull(),
    requestKey: uuid("request_key").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("checkout_retry_key").on(t.guestHash, t.requestKey)],
);

export const reservationState = pgEnum("reservation_state", [
  "held",
  "released",
  "committed",
]);

export const reservations = pgTable(
  "reservations",
  {
    orderItemId: uuid("order_item_id")
      .primaryKey()
      .references(() => orderItems.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    quantity: integer("quantity").notNull(),
    state: reservationState("state").notNull().default("held"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reservations_order_idx").on(t.orderId),
    check("reservation_quantity", sql`${t.quantity} > 0`),
  ],
);
