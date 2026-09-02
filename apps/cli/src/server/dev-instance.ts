// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// one dev instance per checkout, keyed by sha256 of the checkout path, so parallel
// worktrees never share a database or collide on a port.

import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const DEV_HASH_LENGTH = 12;
const DEV_PORT_BASE = 21_000;
const DEV_PORT_BUCKETS = 8_000;

// bind-side only: nothing probes when dialing, the bound port is read from server.json.
export const DEV_PORT_PROBE_LIMIT = 10;

const CHECKOUT_MARKER = "pnpm-workspace.yaml";

function createCheckoutHash(checkoutPath: string): string {
  return createHash("sha256").update(checkoutPath).digest("hex");
}

// `pnpm dev` runs from apps/desktop and `pnpm cli` from wherever the developer stands; hashing
// those raw gives the cli a different instance than the server. realpathed for the same reason.
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
