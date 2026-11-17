import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Better Auth's tables as 1.7.25 reads them for auth.ts's plugins, which add none, hand-kept as
// dataembed keeps its own: the generator emits no RLS, no index and no rate_limit. Its schema check
// (`advanced.database.validateSchema`) fails the first auth call on a column it misses.

export const user = pgTable.withRLS("user", {
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable.withRLS(
  "session",
  {
    createdAt: timestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: timestamp("updated_at").notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable.withRLS(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: timestamp("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable.withRLS(
  "verification",
  {
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// Better Auth's limiter and the app's own windows (packages/service/src/rate-limit.ts) share it, so
// Better Auth's prune of a lapsed row reaches both; last_request is epoch milliseconds.
export const rateLimit = pgTable.withRLS("rate_limit", {
  count: integer("count").notNull(),
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// In the clear: a short string a person types, bounded by the gate's window, which the owner reads
// back to see which codes are open. redeemed_by is the address the claim was made with, since the
// claim comes before the account; a deletion forgets it and keeps the code spent.
export const inviteCode = pgTable.withRLS(
  "invite_code",
  {
    code: text("code").primaryKey(),
    redeemedAt: timestamp("redeemed_at"),
    redeemedBy: text("redeemed_by"),
  },
  // push never alters a check's body, so a changed rule takes a new name
  (table) => [
    check(
      "invite_code_redeemer_check",
      sql`${table.redeemedBy} is null or ${table.redeemedAt} is not null`,
    ),
  ],
);
