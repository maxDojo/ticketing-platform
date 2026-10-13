import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  check,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";

import { orders } from "./orders";
import { createdAt, money } from "./columns";

export const paymentStatus = pgEnum("payment_status", [
  "initialized",
  "pending",
  "failed",
  "succeeded",
  "mismatched",
]);

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
    providerFees: money("provider_fees"),
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

// One attempt per order for the initialization-only checkpoint. Reconciliation
// must resolve ambiguous attempts before a future implementation enables retries.
export const paymentInitializations = pgTable(
  "payment_initializations",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id),
    state: text("state").notNull().default("initializing"),
    authorizationUrl: text("authorization_url"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "payment_initialization_state",
      sql`${t.state} in ('initializing','ready','unknown')`,
    ),
    check(
      "payment_initialization_url",
      sql`(${t.state} = 'ready') = (${t.authorizationUrl} is not null)`,
    ),
  ],
);

export const paymentJobs = pgTable(
  "payment_jobs",
  {
    paymentId: uuid("payment_id")
      .primaryKey()
      .references(() => payments.id),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    generation: integer("generation").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastOutcome: text("last_outcome"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "payment_job_state",
      sql`${t.state} in ('pending','done','attention')`,
    ),
    index("payment_jobs_due_idx").on(t.state, t.nextAttemptAt),
  ],
);

export const paymentWebhookReceipts = pgTable("payment_webhook_receipts", {
  digest: varchar("digest", { length: 64 }).primaryKey(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  createdAt: createdAt(),
});

export const paymentFulfillments = pgTable("payment_fulfillments", {
  orderId: uuid("order_id")
    .primaryKey()
    .references(() => orders.id),
  paymentId: uuid("payment_id")
    .notNull()
    .unique()
    .references(() => payments.id),
  createdAt: createdAt(),
});

export const paymentExceptions = pgTable(
  "payment_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("payment_exception_once").on(t.paymentId, t.reason)],
);
