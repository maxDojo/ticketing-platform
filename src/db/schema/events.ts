import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  boolean,
  check,
  unique,
  index,
} from "drizzle-orm/pg-core";

import { authUser } from "../auth-schema";
import { createdAt, money } from "./columns";

export const eventStatus = pgEnum("event_status", [
  "draft",
  "published",
  "cancelled",
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

export const eventCancellations = pgTable(
  "event_cancellations",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => authUser.id),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "cancellation_reason",
      sql`char_length(${t.reason}) BETWEEN 5 AND 200`,
    ),
  ],
);
