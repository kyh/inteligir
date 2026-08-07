// ---------------------------------------------------------------------------
// The Durable Object's synchronous key-value storage, declared ONCE.
//
// Five modules held their own byte-identical copy of this shape with five
// copies of the same paragraph explaining `unknown`. They are structural, so
// they all matched `ctx.storage.kv` and none of them could disagree at the type
// level — which is exactly why the duplication was invisible and why one of
// them would eventually be narrowed by hand and drift.
//
// Structural rather than the runtime `SqlStorageKv`: it keeps every consumer
// testable outside a Workers runtime, and `ctx.storage.kv` satisfies it as-is.
//
// `get` answers `unknown` rather than a caller-chosen generic because what
// comes back is JSON some earlier version of this code wrote — a generic would
// be a promise nothing can keep. Every reader narrows.
//
// Not to be confused with ./do-store-adapter's `SyncKv`, which is genuinely a
// different type: that one is STRING-valued, because the JsonStore engine owns
// its own encoding and hands the adapter finished text.
// ---------------------------------------------------------------------------

/** Reads and writes only — the shape a module that never deletes needs. */
export type DurableKv = {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
};

/** `DurableKv` plus removal, for the modules that can forget a key (a
 * disconnected provider, a cleared secret, a consumed nav). */
export type DeletableDurableKv = DurableKv & {
  delete(key: string): boolean;
};
