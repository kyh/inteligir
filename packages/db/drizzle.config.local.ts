import fs from "node:fs";
import path from "node:path";
import type { Config } from "drizzle-kit";

function getLocalD1Path(): string {
  const d1Dir = path.resolve(
    "../../apps/web/.wrangler/state/v3/d1/miniflare-D1DatabaseObject",
  );
  if (!fs.existsSync(d1Dir)) return ":memory:";
  const files = fs.readdirSync(d1Dir).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) return ":memory:";
  return path.join(d1Dir, files[0]!);
}

export default {
  schema: ["./src/drizzle-schema-auth.ts"],
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: getLocalD1Path(),
  },
  casing: "snake_case",
} satisfies Config;
