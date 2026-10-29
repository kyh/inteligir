import { defineRelationsPart } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Better Auth's tables and relations as `npx auth@1.7.14 generate` prints them for auth.ts's plugin
// set over the relations-v2 adapter, ported rather than pasted, since its `.unique()`, its SQL
// column defaults and a new NOT NULL each plan a table recreate on D1 (apps/web/CLAUDE.md, Declare
// D1 uniques as named unique indexes). The port departs from the generator in exactly three ways:
// uniques stay named indexes; every column the generator gives a SQL default takes the same value
// from `$defaultFn`, which changes no DDL; and verification's createdAt and updatedAt stay
// nullable where the generator prints `.notNull()`. Re-run the generator on a Better Auth bump or
// a plugin change and port what moved within those three; check `drizzle-kit push --explain` and
// refuse any plan that recreates a table.

// A table's column order is the CREATE TABLE order drizzle-kit emits, and it mirrors what the
// generator prints; sorting it makes the next push recreate every table.

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .$defaultFn(() => false)
      .notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_userId_idx").on(table.userId),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// better-auth's own rate-limit store shape (lastRequest is epoch ms)
export const rateLimit = sqliteTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: integer("last_request").notNull(),
  },
  (table) => [uniqueIndex("rate_limit_key_unique").on(table.key)],
);

// the adapter's `schema`: each model under the name Better Auth asks for
export const authTables = { account, rateLimit, session, user, verification };

export const authRelations = defineRelationsPart(authTables, (r) => ({
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id }),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id }),
  },
  user: {
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
  },
}));

// stored in the clear: a low-entropy string a human types, bounded by the route's rate window,
// and the owner reads back which codes are open; redeemedAt non-null is the redeemed marker
export const inviteCode = sqliteTable("invite_code", {
  code: text("code").primaryKey(),
  redeemedBy: text("redeemed_by"),
  redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
});

// credentialHash is SHA-256 of the minted credential, whose plaintext is never stored;
// rows survive revocation as the dashboard's audit surface and die with the account
export const device = sqliteTable(
  "device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    credentialHash: text("credential_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  // revoked_at too: every login counts the account's active rows against the cap
  (table) => [
    uniqueIndex("device_credential_hash_unique").on(table.credentialHash),
    index("device_user_id_idx").on(table.userId, table.revokedAt),
  ],
);
