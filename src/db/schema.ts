import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  timestamp,
  boolean,
  check,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";

import { authUser } from "./auth-schema";
export * from "./auth-schema";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "bigint" });
export const eventStatus = pgEnum("event_status", [
  "draft",
  "published",
  "cancelled",
]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "expired",
  "paid",
  "cancelled",
  "payment_exception",
  "refunded",
  "partially_refunded",
]);
export const paymentStatus = pgEnum("payment_status", [
  "initialized",
  "pending",
  "failed",
  "succeeded",
  "mismatched",
]);
export const ticketStatus = pgEnum("ticket_status", [
  "valid",
  "cancelled",
  "refunded",
]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: text("organizer_id").references(() => authUser.id, {
      onDelete: "restrict",
    }),
    artworkUrl: text("artwork_url"),
    slug: varchar("slug", { length: 160 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    venue: text("venue").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: eventStatus("status").notNull().default("draft"),
    reservationMinutes: integer("reservation_minutes").notNull().default(10),
    createdAt: createdAt(),
  },
  (t) => [
    check("event_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("event_name_present", sql`length(trim(${t.name})) > 0`),
    check("event_venue_present", sql`length(trim(${t.venue})) > 0`),
    check(
      "event_reservation_bounds",
      sql`${t.reservationMinutes} between 1 and 1440`,
    ),
    check(
      "event_dates",
      sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    unitPrice: money("unit_price").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    capacity: integer("capacity").notNull(),
    reservedUnits: integer("reserved_units").notNull().default(0),
    soldUnits: integer("sold_units").notNull().default(0),
    admissionsPerUnit: integer("admissions_per_unit").notNull().default(1),
    minimumQuantity: integer("minimum_quantity").notNull().default(1),
    maximumQuantity: integer("maximum_quantity").notNull().default(10),
    saleStartsAt: timestamp("sale_starts_at", { withTimezone: true }),
    saleEndsAt: timestamp("sale_ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ticket_type_event_currency").on(t.id, t.eventId, t.currency),
    index("ticket_types_event_idx").on(t.eventId),
    check("ticket_type_name_present", sql`length(trim(${t.name})) > 0`),
    check("ticket_type_price", sql`${t.unitPrice} >= 0`),
    check("ticket_type_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "ticket_type_inventory",
      sql`${t.capacity} >= 0 and ${t.reservedUnits} >= 0 and ${t.soldUnits} >= 0 and ${t.reservedUnits}::bigint + ${t.soldUnits}::bigint <= ${t.capacity}`,
    ),
    check("ticket_type_admissions", sql`${t.admissionsPerUnit} > 0`),
    check(
      "ticket_type_quantities",
      sql`${t.minimumQuantity} > 0 and ${t.maximumQuantity} >= ${t.minimumQuantity}`,
    ),
    check(
      "ticket_type_sale_dates",
      sql`${t.saleEndsAt} is null or ${t.saleStartsAt} is null or ${t.saleEndsAt} > ${t.saleStartsAt}`,
    ),
  ],
);

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

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    provider: text("provider").notNull().default("paystack"),
    providerReference: varchar("provider_reference", { length: 100 })
      .notNull()
      .unique(),
    expectedAmount: money("expected_amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    verifiedAmount: money("verified_amount"),
    verifiedCurrency: varchar("verified_currency", { length: 3 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    status: paymentStatus("status").notNull().default("initialized"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "payment_order_amount",
      columns: [t.orderId, t.currency, t.expectedAmount],
      foreignColumns: [orders.id, orders.currency, orders.total],
    }),
    index("payments_order_idx").on(t.orderId),
    check("payment_provider", sql`${t.provider} = 'paystack'`),
    check(
      "payment_reference_present",
      sql`length(trim(${t.providerReference})) > 0`,
    ),
    check(
      "payment_amounts",
      sql`${t.expectedAmount} >= 0 and (${t.verifiedAmount} is null or ${t.verifiedAmount} >= 0)`,
    ),
    check(
      "payment_success_verified",
      sql`${t.status} <> 'succeeded' or (${t.verifiedAt} is not null and ${t.verifiedAmount} is not null and ${t.verifiedCurrency} is not null and ${t.verifiedAmount} = ${t.expectedAmount} and ${t.verifiedCurrency} = ${t.currency})`,
    ),
  ],
);

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
