import { bigint, timestamp } from "drizzle-orm/pg-core";

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// Monetary amounts are stored as integer minor units, never floating point.
export const money = (name: string) => bigint(name, { mode: "bigint" });
