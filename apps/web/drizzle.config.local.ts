import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "drizzle-kit";

// Points drizzle-kit at the miniflare D1 file under .wrangler/state (`pnpm db:push:local`).
// Match the 64-hex content-hash name: the directory also holds miniflare's own
// metadata.sqlite, and `*.sqlite` picked that first, pushing the schema into the wrong db.
const D1_FILE = /^[0-9a-f]{64}\.sqlite$/;
const here = dirname(fileURLToPath(import.meta.url));
const d1Dir = join(here, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = existsSync(d1Dir) ? readdirSync(d1Dir).find((f) => D1_FILE.test(f)) : undefined;
if (file === undefined) {
  throw new Error(
    "Local D1 not found — start `pnpm dev:web`, then hit a route " +
      "that touches D1 (`curl -s localhost:5174/api/auth/get-session`) to materialize it.",
  );
}

export default {
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  dbCredentials: { url: `file:${join(d1Dir, file)}` },
} satisfies Config;
