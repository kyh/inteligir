// ---------------------------------------------------------------------------
// Deleting everything under one account's R2 prefix.
//
// Driven by the LISTING rather than by the manifest, and that is the whole
// point: an account purge must remove bytes the manifest has already forgotten
// about — a snapshot whose row was pruned between two failures, a blob orphaned
// by an interrupted write (the vault's ordering rule tolerates exactly that,
// preferring an orphan blob to a dangling pointer). A manifest-driven sweep
// would leave those behind forever, and nothing would ever look again.
//
// It is therefore IDEMPOTENT by construction: it asks R2 what is there and
// removes it, so a retry after any failure resumes rather than repeats, and a
// second run finds nothing.
// ---------------------------------------------------------------------------

/** R2 accepts up to 1,000 keys in one delete, and lists up to 1,000 at a time. */
const PAGE = 1000;

/**
 * Delete every object under `prefix`, and answer how many went.
 *
 * The prefix is closed with a separator so `user:12` can never sweep
 * `user:123`'s bytes — the object names are caller-derived ids, and a prefix
 * match on a bare name is a cross-account delete waiting for the right pair of
 * user ids.
 */
export async function purgeR2Prefix(bucket: R2Bucket, prefix: string): Promise<number> {
  const scope = `${prefix}/`;
  let removed = 0;
  // Each pass lists from the START of the prefix rather than carrying a cursor
  // across the deletes it just issued: a cursor names a position in a listing
  // this loop is actively emptying, and the page it resumes at is not the page
  // it was taken from. Re-listing terminates because every pass removes what it
  // listed, and a failed delete throws rather than looping.
  for (;;) {
    const listing = await bucket.list({ prefix: scope, limit: PAGE });
    const keys = listing.objects.map((object) => object.key);
    if (keys.length === 0) return removed;
    await bucket.delete(keys);
    removed += keys.length;
  }
}
