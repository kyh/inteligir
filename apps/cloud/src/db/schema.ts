import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Drizzle schema for the auth D1 database (`DB` binding). Two concerns live
// here in one file (no barrel):
//
//  1. The Better Auth core tables (`user`, `session`, `account`, `verification`)
//     — the SQLite shape Better Auth's Drizzle adapter (`provider: "sqlite"`)
//     expects. Hand-written: the COLUMN SET matches what `@better-auth/cli
//     generate` emits for the current plugin set (emailAndPassword + bearer add
//     no columns beyond the core set), but this is NOT byte-parity with the
//     generator, and two divergences are deliberate:
//
//       • Timestamps are `mode: "timestamp"` (epoch SECONDS); the generator now
//         emits `mode: "timestamp_ms"`. Do NOT flip this in place. Both modes
//         read the same INTEGER column, so a redeploy without an accompanying
//         `UPDATE <table> SET <col> = <col> * 1000` reads every stored date back
//         as 1970 — which expires every live session and every pending
//         verification token. Seconds are correct as long as they are what the
//         rows already hold.
//       • The generator's three secondary indexes (session.userId,
//         account.userId, verification.identifier) are absent. Not needed at
//         this scale: the hot path is `session.token`, which is unique and so
//         already indexed; the rest are cold paths over a handful of rows.
//
//     The JS property keys are Better Auth's field names (camelCase); the DB
//     column names (snake_case) are ours. There are no migration files — the
//     schema here IS the source of truth, applied with `drizzle-kit push` and
//     exported straight into the tests (see drizzle.config.ts for why).
//     The `session.token` column is what the bearer plugin matches an
//     `Authorization: Bearer …` token against. If you add a plugin that needs
//     columns (organization, admin, apiKey, …), run `pnpx @better-auth/cli
//     generate` and port the new columns rather than guessing at them — but
//     keep the timestamp mode the existing rows are written in.
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
 * better-auth's database rate-limit store (`rateLimit.storage = "database"` in
 * auth.ts). Keyed by IP+path; `key` is unique so the counter upsert is a single
 * indexed lookup. `lastRequest` is an epoch-ms integer. Mirrors the sqlite shape
 * `@better-auth/cli generate` emits for the rate-limit store — regenerate rather
 * than hand-edit if the plugin set changes. Applied via `drizzle-kit push` (this
 * repo has no migration files); no RLS on D1.
 */
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/**
 * Desktop sign-in handoff codes (src/auth/desktop-session.ts). Not a Better
 * Auth table; the desktop-callback surface owns it. Each row is one SHORT-LIVED
 * (~90s), SINGLE-USE authorization code minted at the social OAuth callback:
 * the `inteligir://session` deep link carries only the opaque code, and the
 * desktop exchanges it over HTTPS for the session bearer held here. The code
 * itself is never stored — only its sha-256 (`codeHash`, the PK), so a D1 read
 * can't yield redeemable codes. Rows are deleted on exchange (the burn) and
 * garbage-collected opportunistically on every mint.
 */
export const desktopAuthCode = sqliteTable("desktop_auth_code", {
  codeHash: text("code_hash").primaryKey(),
  token: text("token").notNull(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
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
