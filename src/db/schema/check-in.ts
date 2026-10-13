import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  check,
  unique,
  index,
} from "drizzle-orm/pg-core";

import { authUser } from "../auth-schema";
import { events } from "./events";
import { tickets } from "./tickets";
import { createdAt } from "./columns";

export const eventStaff = pgTable(
  "event_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("event_staff_membership").on(t.eventId, t.userId),
    index("event_staff_user").on(t.userId),
  ],
);

export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .unique()
      .references(() => tickets.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => authUser.id),
    method: text("method").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("check_ins_event").on(t.eventId, t.createdAt),
    check("check_in_method", sql`${t.method} IN ('qr','manual')`),
    check(
      "check_in_reason",
      sql`(${t.method}='qr' AND ${t.reason} IS NULL) OR (${t.method}='manual' AND char_length(${t.reason}) BETWEEN 5 AND 200 AND ${t.reason} IS NOT NULL)`,
    ),
  ],
);
