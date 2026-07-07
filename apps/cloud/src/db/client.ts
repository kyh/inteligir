import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Per-request Drizzle client over the Cloudflare D1 binding. D1 is a RUNTIME
// binding (`env.DB`), never a module singleton — so this is a factory the Worker
// calls once per request with the request's `env`. The `schema` is threaded in
// so Better Auth's Drizzle adapter (and our `vault_owner` queries) resolve tables
// by name.
// ---------------------------------------------------------------------------

/** Build a Drizzle client bound to a D1 database for the current request. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
