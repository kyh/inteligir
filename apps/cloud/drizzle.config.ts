import type { Config } from "drizzle-kit";

// `drizzle-kit push` workflow — NO migration files, deliberately.
//
// This is a considered choice, not a shortcut.
// Drizzle's own guidance calls push "widely adopted as a primary migration flow
// in production" and specifically well-suited to serverless databases, which D1
// is. The three things that usually make push dangerous do not apply here: there
// is a single deployer (the account owner; the README gates `db:push` behind a
// "never run this" warning), the schema is small and additive so far, and
// nothing derived can rot — vitest.config.ts feeds the test D1 by running
// `drizzle-kit export` over src/db/schema.ts, so the suite always runs the
// schema the source declares. Revisit when a second deployer or a destructive
// column change appears; until then a migrations/ directory is ceremony that
// nobody would ever replay.
//
// This config targets the REMOTE D1 over the HTTP API. Set these before `pnpm db:push`:
//   CLOUDFLARE_ACCOUNT_ID   CLOUDFLARE_DATABASE_ID   CLOUDFLARE_D1_TOKEN
// For local, use drizzle.config.local.ts (points at the miniflare sqlite file).
// Column names are explicit in src/db/schema.ts, so no `casing` inference needed.
export default {
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
} satisfies Config;
