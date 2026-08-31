// Restoring a revision, composed over the typed client — and that composition
// IS the decision. A restore is an ORDINARY WRITE of older bytes, never a
// `git checkout`, `git revert` or index manipulation: the write path is what
// runs the CAS under the repo lock, re-indexes knowledge, notifies `/ws` and
// lets the open buffer converge. It also means an undone restore is just
// another restore — the history stays linear, with no detached HEAD to explain.
//
// The write CARRIES THE BASE IT SAW, and a mismatch is REPORTED rather than
// merged. Everywhere else in this app a CAS refusal is a three-way merge and a
// retry, because the loser there is a buffer whose edits must survive. Here the
// user named exact bytes, so merging them with whatever landed underneath would
// produce a file that is neither the revision nor the note — the honest answer
// is that the note moved, and to look again.

import { contentHashHex } from "@repo/api/local/vault/vault-schema";

import { isDefinedError, refusalMessage, safe, type client } from "../api";

export type RestoreOutcome =
  | { kind: "restored" }
  /** The revision's bytes are already what the note holds. */
  | { kind: "unchanged" }
  | { kind: "refused"; message: string };

export interface RestoreRevisionArgs {
  /** The note's path TODAY — where the bytes land. */
  docPath: string;
  /** The path the note had AT that revision — where the bytes come from.
   *  `--follow` crosses renames, so the two differ for a pre-rename row. */
  revisionPath: string;
  sha: string;
}

const RESTORE_REFUSED = "The restore was refused.";

export async function restoreRevision(
  api: typeof client,
  args: RestoreRevisionArgs,
): Promise<RestoreOutcome> {
  const [revisionError, revision] = await safe(
    api.vault.revision({ path: args.revisionPath, sha: args.sha }),
  );
  if (revision === undefined) {
    return { kind: "refused", message: refusalMessage(revisionError, RESTORE_REFUSED) };
  }
  const [readError, current] = await safe(api.vault.read({ path: args.docPath }));
  if (current === undefined) {
    return { kind: "refused", message: refusalMessage(readError, RESTORE_REFUSED) };
  }
  if (current.content === revision.content) {
    return { kind: "unchanged" };
  }
  const [writeError] = await safe(
    api.vault.write({
      path: args.docPath,
      content: revision.content,
      expectedHash: await contentHashHex(current.content),
    }),
  );
  if (writeError === null) {
    return { kind: "restored" };
  }
  if (isDefinedError(writeError) && writeError.code === "CAS_MISMATCH") {
    return {
      kind: "refused",
      message: "The note changed while this restore was in flight. Look again and retry.",
    };
  }
  return { kind: "refused", message: refusalMessage(writeError, RESTORE_REFUSED) };
}
