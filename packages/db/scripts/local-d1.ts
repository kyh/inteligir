import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Matched by its 64-hex name: the directory also holds miniflare's own metadata.sqlite, which a
// `*.sqlite` match finds first, and a push then lands in the wrong database.
const D1_FILE = /^[0-9a-f]{64}\.sqlite$/u;
const d1Dir = path.join(
  import.meta.dirname,
  "../../../apps/web/.wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);

// The local Worker's D1 file, where this checkout's `pnpm dev:web` keeps it. miniflare makes it on
// the Worker's first query, so none means no Worker of this checkout has run one.
export const localD1Url = (): string => {
  const file = existsSync(d1Dir)
    ? readdirSync(d1Dir).find((name) => D1_FILE.test(name))
    : undefined;
  if (file === undefined) {
    throw new Error(
      "No local D1 under this checkout's apps/web/.wrangler: run `pnpm bootstrap` beside this checkout's `pnpm dev:web`.",
    );
  }
  return `file:${path.join(d1Dir, file)}`;
};
