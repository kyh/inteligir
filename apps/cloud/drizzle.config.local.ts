import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "drizzle-kit";

// `drizzle-kit push` against the LOCAL miniflare D1 that `pnpm --filter @repo/cloud
// dev` (wrangler dev) binds to. The default drizzle.config.ts pushes to remote
// prod (d1-http); this one points the sqlite driver at the local SQLite file.
// Miniflare names that file with a content hash, so resolve it from .wrangler
// state rather than hard-coding it. Run `pnpm db:push:local` to apply the schema.
const here = dirname(fileURLToPath(import.meta.url));
const d1Dir = join(here, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = existsSync(d1Dir) ? readdirSync(d1Dir).find((f) => f.endsWith(".sqlite")) : undefined;
if (file === undefined) {
  throw new Error(
    "Local D1 not found — run `pnpm --filter @repo/cloud dev` once to initialize it.",
  );
}

export default {
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: `file:${join(d1Dir, file)}` },
} satisfies Config;
