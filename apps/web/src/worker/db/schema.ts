import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Drizzle schema for the auth D1 database (`DB` binding). The Better Auth core
// tables (`user`, `session`, `account`, `verification`) are the SQLite shape
// Better Auth's Drizzle adapter (`provider: "sqlite"`) expects; `rate_limit` and
// `invite` below are ours, each documented at its declaration.
//
// The core tables are hand-written: the COLUMN SET matches what
// `@better-auth/cli generate` emits for the current plugin set (emailAndPassword
// + bearer add no columns beyond the core set), but this is NOT byte-parity with
// the generator, and two divergences are deliberate:
//
//   • Timestamps are `mode: "timestamp"` (epoch SECONDS); the generator now
//     emits `mode: "timestamp_ms"`. Do NOT flip this in place. Both modes read
//     the same INTEGER column, so a redeploy without an accompanying
//     `UPDATE <table> SET <col> = <col> * 1000` reads every stored date back as
//     1970 — which expires every live session and every pending verification
//     token. Seconds are correct as long as they are what the rows already hold.
//   • The generator's three secondary indexes (session.userId, account.userId,
//     verification.identifier) are absent. Not needed at this scale: the hot
//     path is `session.token`, which is unique and so already indexed; the rest
//     are cold paths over a handful of rows.
//
// The JS property keys are Better Auth's field names (camelCase); the DB column
// names (snake_case) are ours. There are no migration files — the schema here IS
// the source of truth, applied with `drizzle-kit push` and exported straight
// into the tests (see drizzle.config.ts for why). The `session.token` column is
// what the bearer plugin matches an `Authorization: Bearer …` token against. If
// you add a plugin that needs columns (organization, admin, apiKey, …), run
// `pnpx @better-auth/cli generate` and port the new columns rather than guessing
// at them — but keep the timestamp mode the existing rows are written in.
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
 * Sign-up invites (src/worker/auth/invite.ts). Not a Better Auth table: sign-up
 * on this deployment goes through `POST /v1/auth/sign-up`, which claims a row
 * here before it forwards to Better Auth at all.
 *
 * The code IS the primary key and is stored in the clear, unlike the handoff
 * codes above: an invite is a low-entropy string a human types from an email,
 * it authorizes only the creation of an ordinary account, and the owner needs
 * to be able to read back which codes are still open. Guessing is bounded by
 * the route's own rate window rather than by entropy.
 *
 * `redeemedAt` non-null IS the redeemed marker, and the claim is one atomic
 * `UPDATE … WHERE code = ? AND redeemed_at IS NULL`, so two simultaneous
 * sign-ups on one code settle on exactly one winner. There is no admin UI —
 * rows are minted with `wrangler d1 execute` (see README).
 */
export const inviteCode = sqliteTable("invite_code", {
  code: text("code").primaryKey(),
  redeemedBy: text("redeemed_by"),
  redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
});

/**
 * One-time device-pairing codes (src/worker/device/pairing.ts; bb's
 * connect_code pattern, MIT). A signed-in dashboard mints one; the local app
 * redeems it once for a durable device credential. Stored in the clear like
 * the invite above — a code is short-lived (10 min), single-use, and the
 * consume is one conditional `UPDATE … WHERE consumed_at IS NULL AND
 * expires_at > now`, so two simultaneous redeems settle on exactly one winner
 * and an expired code cannot be consumed by a check that ran a moment earlier.
 *
 * `deviceId` is what CHAINS the consume to the device insert inside one D1
 * batch: redeem writes the id it is about to create, and the insert is guarded
 * on finding that id here. Only the winning consume could have written it, so
 * a batch with no way to abort still lands both statements or neither.
 *
 * Dead rows (expired or consumed) are swept per user at that user's NEXT mint,
 * and nowhere else — an expired row is already unusable, so this buys tidiness
 * rather than safety. `docs/privacy.md` states it that way.
 */
export const pairingCode = sqliteTable("pairing_code", {
  code: text("code").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp" }),
  deviceId: text("device_id"),
  // The PKCE S256 challenge the approve page sent at mint. Redeem rejects
  // unless S256(verifier) equals it, so an intercepted code alone cannot be
  // spent (issue #573). Nullable only because the column is additive over a
  // deployed table; every code minted now carries one, and a null is refused.
  challenge: text("challenge"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/**
 * Paired devices (src/worker/device/device-auth.ts). `credentialHash` is the
 * SHA-256 of the 256-bit credential redeem minted — the plaintext is answered
 * once and never stored. Verification is a per-request hash compare with NO
 * cache, so setting `revokedAt` from the dashboard cuts a device off on its
 * very next request. Rows survive revocation (the dashboard is the audit
 * surface) and are deleted only with the account.
 */
export const device = sqliteTable("device", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  credentialHash: text("credential_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
});
