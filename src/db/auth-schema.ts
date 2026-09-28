import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  uuid,
  index,
} from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: time("createdAt").notNull().defaultNow(),
  updatedAt: time("updatedAt").notNull().defaultNow(),
  twoFactorEnabled: boolean("twoFactorEnabled").notNull().default(false),
});
export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    expiresAt: time("expiresAt").notNull(),
    createdAt: time("createdAt").notNull().defaultNow(),
    updatedAt: time("updatedAt").notNull().defaultNow(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    mfaVerified: boolean("mfaVerified").notNull().default(false),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);
export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: time("accessTokenExpiresAt"),
    refreshTokenExpiresAt: time("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: time("createdAt").notNull().defaultNow(),
    updatedAt: time("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);
export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: time("expiresAt").notNull(),
    createdAt: time("createdAt").notNull().defaultNow(),
    updatedAt: time("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);
export const authTwoFactor = pgTable("auth_two_factor", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => authUser.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failedVerificationCount")
    .notNull()
    .default(0),
  lockedUntil: time("lockedUntil"),
});
export const authRateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("lastRequest", { mode: "number" }).notNull(),
});
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetsAt: time("resets_at").notNull(),
});
// Provisioned by maintenance credentials, never by public signup or application writes.
export const organizers = pgTable("organizers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUser.id),
  active: boolean("active").notNull().default(true),
});
export const adminAudit = pgTable("admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id")
    .notNull()
    .references(() => authUser.id),
  action: text("action").notNull(),
  resourceId: uuid("resource_id").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
