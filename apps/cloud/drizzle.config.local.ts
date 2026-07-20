import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "drizzle-kit";

// `drizzle-kit push` against the LOCAL miniflare D1 that `pnpm --filter @repo/cloud
// dev` (wrangler dev) binds to. The default drizzle.config.ts pushes to remote
// prod (d1-http); this one points the sqlite driver at the local SQLite file.
// Miniflare names that file with a content hash, so resolve it from .wrangler
// state rather than hard-coding it. Run `pnpm db:push:local` to apply the schema.
//
// The directory ALSO holds miniflare's own `metadata.sqlite`. Matching any
// `*.sqlite` picked that one first (readdir order), so the push "succeeded"
// into miniflare's bookkeeping DB and the real D1 stayed empty — every auth
// request then 500'd on a missing table. Match the 64-hex content-hash name.
const D1_FILE = /^[0-9a-f]{64}\.sqlite$/;
const here = dirname(fileURLToPath(import.meta.url));
const d1Dir = join(here, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = existsSync(d1Dir) ? readdirSync(d1Dir).find((f) => D1_FILE.test(f)) : undefined;
if (file === undefined) {
  throw new Error(
    "Local D1 not found — start `pnpm --filter @repo/cloud dev`, then hit a route " +
      "that touches D1 (`curl -s localhost:8787/api/auth/get-session`) to materialize it.",
  );
}

export default {
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: `file:${join(d1Dir, file)}` },
} satisfies Config;
