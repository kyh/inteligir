// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// THE dev-instance derivation, whole scheme in one place. One dev instance
// per checkout, keyed by sha256 of the checkout path, so parallel worktrees
// never share a database or collide on a socket:
//
//   instance  = ~/.inteligir-dev/<hash truncated to 12 hex chars>
//   data dir  = <instance>/data     (vault default = <instance>/vault — siblings,
//                                    because the two must be disjoint)
//   port      = 21000 + (hex chars 0–8 of hash % 8000)       → 21000–28999
//
// A derived port that turns out taken is probed upward at listen time
// (`listen.ts`), bounded; env/managed-config ports are never probed — a
// configured port that is busy is an error the user asked to see.
//
// Its own module rather than a corner of `config.ts` because the derivation
// has callers the config parser does not: the CLI's discovery and the desktop
// shell both need "which instance does this checkout mean" — a hash and a
// directory walk — without any of the parser's layering behind it.

import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const DEV_HASH_LENGTH = 12;
const DEV_PORT_BASE = 21_000;
const DEV_PORT_BUCKETS = 8_000;

/**
 * Bound for the upward probe on a busy DERIVED dev port: `listen.ts` probes
 * this many ports when binding. Nothing probes when DIALING — a caller reads
 * the bound port straight out of `<dataDir>/server.json`, so there is no range
 * for the two ends to disagree about.
 */
export const DEV_PORT_PROBE_LIMIT = 10;

/** What makes a directory THE checkout: the file the workspace is defined by. */
const CHECKOUT_MARKER = "pnpm-workspace.yaml";

function createCheckoutHash(checkoutPath: string): string {
  return createHash("sha256").update(checkoutPath).digest("hex");
}

/**
 * The checkout the running process belongs to — the top of the tree, never the
 * directory a script happened to start in.
 *
 * Every caller of the derivation goes through this, because the two ends
 * start from different places: `pnpm dev` runs the shell from `apps/desktop`
 * and `pnpm cli …` runs from wherever the developer stands, and hashing those
 * raw would give the CLI a different instance than the server it is looking
 * for. Realpath'd for the same reason — a symlinked path hashes differently
 * from the one it points at. A tree with no marker (a packaged install) has no
 * checkout, and the value is unused there: it feeds the DEV derivation only.
 */
export function resolveCheckoutRoot(startDir: string = process.cwd()): string {
  let current: string;
  try {
    current = realpathSync(startDir);
  } catch {
    current = startDir;
  }
  const anchor = current;
  for (;;) {
    if (existsSync(join(current, CHECKOUT_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) return anchor;
    current = parent;
  }
}

export function resolveDevInstanceId(checkoutPath: string): string {
  return createCheckoutHash(checkoutPath).slice(0, DEV_HASH_LENGTH);
}

export function resolveDevDefaultPort(checkoutPath: string): number {
  const hash = createCheckoutHash(checkoutPath);
  return DEV_PORT_BASE + (Number.parseInt(hash.slice(0, 8), 16) % DEV_PORT_BUCKETS);
}
