import type { Config } from "drizzle-kit";
import { localD1Url } from "./scripts/local-d1";

// Points drizzle-kit at the local Worker's D1 file, which `pnpm bootstrap` pushes.
export default {
  dbCredentials: { url: localD1Url() },
  dialect: "sqlite",
  schema: "./src/d1/schema.ts",
} satisfies Config;
