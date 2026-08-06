// ---------------------------------------------------------------------------
// StoreAdapter over a Durable Object's synchronous KV storage — the DO-side
// binding of the JsonStore engine, mirroring json-store.ts's realFs. Pure: no
// node, no Workers runtime import, so it type-checks and tests anywhere.
// ---------------------------------------------------------------------------

import type { StoreAdapter } from "./json-store-core";

/**
 * The slice of a SQLite-backed Durable Object's `ctx.storage.kv` a store
 * needs, declared structurally rather than imported: @repo/storage is a leaf
 * (dep DAG) and pulling the Workers types in for three method signatures would
 * un-leaf the substrate. `ctx.storage.kv` satisfies it as-is.
 *
 * These are SYNCHRONOUS by contract — see StoreAdapter. The SQLite backend's
 * KV API is what makes a DO-hosted JsonStore possible at all; the async
 * `ctx.storage.get/put` API cannot back one.
 */
export type SyncKv = {
  get: (key: string) => string | undefined;
  put: (key: string, value: string) => void;
  delete: (key: string) => void;
};

/**
 * Keys are opaque to the engine, so quarantine's `.corrupt-<ts>` /
 * `.newer-v<n>-<ts>` suffixing needs no filesystem semantics — the set-aside
 * copy is just another key in the same namespace. `mode` is dropped: a KV
 * entry has no file permissions.
 */
export function createDoStoreAdapter(kv: SyncKv): StoreAdapter {
  return {
    read: (key) => kv.get(key) ?? null,
    write: (key, content) => {
      kv.put(key, content);
    },
    rename: (from, to) => {
      const value = kv.get(from);
      if (value === undefined) throw new Error(`rename: missing key ${from}`);
      // Destination first: a failure between the two must leave the bytes
      // reachable, and quarantine's whole job is preserving them.
      kv.put(to, value);
      kv.delete(from);
    },
  };
}
