import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  check,
  index,
} from "drizzle-orm/pg-core";

import { authUser } from "../auth-schema";
import { events } from "./events";
import { orders } from "./orders";
import { payments } from "./payments";
import { createdAt, money } from "./columns";

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => authUser.id),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    state: text("state").notNull().default("approved"),
    providerId: text("provider_id").unique(),
    providerStatus: text("provider_status"),
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("refunds_due").on(t.state, t.nextAttemptAt),
    index("refunds_event").on(t.eventId),
    check("refund_amount", sql`${t.amount}>0`),
    check(
      "refund_kind",
      sql`${t.kind} IN ('fulfilled','excess','unfulfilled')`,
    ),
    check(
      "refund_state",
      sql`${t.state} IN ('approved','processing','attention','processed')`,
    ),
    check("refund_reason", sql`char_length(${t.reason}) BETWEEN 5 AND 200`),
    check("refund_attempts", sql`${t.attempts}>=0`),
    check(
      "refund_processed",
      sql`(${t.state}='processed')=(${t.processedAt} IS NOT NULL)`,
    ),
  ],
);
