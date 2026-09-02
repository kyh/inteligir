import type { Config } from "drizzle-kit";

// Targets the remote D1 over d1-http; needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID
// and CLOUDFLARE_D1_TOKEN. Local pushes use drizzle.config.local.ts. No migration files:
// one deployer, an additive schema, and vitest derives its DDL from schema.ts.
export default {
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/worker/db/schema.ts",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
} satisfies Config;
