import type { Config } from "drizzle-kit";

// `drizzle-kit push` workflow (no migration files — solo-dev simple). This config
// targets the REMOTE D1 over the HTTP API. Set these before `pnpm db:push`:
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
