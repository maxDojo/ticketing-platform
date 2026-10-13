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

import { orders } from "./orders";
import { createdAt } from "./columns";

export const ticketDeliveryJobs = pgTable(
  "ticket_delivery_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    businessKey: text("business_key").notNull().unique(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("ticket_delivery_due").on(t.state, t.nextAttemptAt),
    check("delivery_state", sql`${t.state} IN ('pending','done','attention')`),
    check("delivery_attempts", sql`${t.attempts} >= 0`),
  ],
);

export const ticketAccessGrants = pgTable(
  "ticket_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .unique()
      .references(() => ticketDeliveryJobs.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    ciphertext: text("ciphertext").notNull(),
    keyId: text("key_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("access_hash", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("access_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const ticketAccessSessions = pgTable(
  "ticket_access_sessions",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => ticketAccessGrants.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("access_session_hash", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("access_session_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
