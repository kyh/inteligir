import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Drizzle schema for the auth D1 database (`DB` binding). Two concerns live
// here in one file (no barrel):
//
//  1. The Better Auth core tables (`user`, `session`, `account`, `verification`)
//     — the SQLite shape Better Auth's Drizzle adapter (`provider: "sqlite"`)
//     expects. Hand-written to mirror `@better-auth/cli generate` output for the
//     current plugin set (emailAndPassword + bearer add NO columns beyond the
//     core set). The JS property keys are Better Auth's field names (camelCase);
//     the DB column names (snake_case) are ours and travel with the generated
//     migration, so schema + migration always agree. The `session.token` column
//     is what the bearer plugin matches an `Authorization: Bearer …` token against.
//     If you add a plugin that needs columns (organization, admin, apiKey, …),
//     REGENERATE via `pnpx @better-auth/cli generate` rather than editing by hand,
//     then `drizzle-kit generate` a new migration — hand-editing risks drift.
//
//  2. `vault_owner` — first-writer-wins vault ownership: the first authenticated
//     user to touch a vaultId claims it; later requests from other users get 403.
//     Not a Better Auth table; the sync layer owns it.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Vault ownership (first-writer-wins). `vaultId` is the primary key; the first
 * authenticated user to access a vault inserts a row claiming it. A later request
 * for the same vault by a different user is rejected (403).
 */
export const vaultOwner = sqliteTable("vault_owner", {
  vaultId: text("vault_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});
