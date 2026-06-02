import type { Config } from "drizzle-kit";

export default {
  schema: ["./src/drizzle-schema-auth.ts", "./src/drizzle-schema.ts"],
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  casing: "snake_case",
} satisfies Config;
