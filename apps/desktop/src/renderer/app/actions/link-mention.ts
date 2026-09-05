// One note, one write, carrying the hash of the bytes the rewrite was computed from. A
// mismatch is reported, never diff3-merged: the row named exact bytes in an exact line, and a
// merge would be a guess about a note that moved.

import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import type { UnlinkedMentionWire } from "@repo/api/local/knowledge/knowledge-schema";
import { linkMention } from "@repo/notes/knowledge/unlinked-mentions";
import { isDefinedError, refusalMessage, safe, type client } from "../api";

export interface LinkMentionApi {
  vault: Pick<(typeof client)["vault"], "read" | "write">;
}

export type LinkMentionOutcome =
  | { kind: "linked" }
  // the note moved under the row; nothing was written
  | { kind: "changed" }
  | { kind: "failed"; message: string };

export async function linkMentionInNote(
  api: LinkMentionApi,
  mention: UnlinkedMentionWire,
  target: string,
): Promise<LinkMentionOutcome> {
  const read = await safe(api.vault.read({ path: mention.path }));
  if (read.error !== null) {
    return { kind: "failed", message: refusalMessage(read.error, "could not read it") };
  }
  const content = read.data.content;
  const linked = linkMention(content, mention, target);
  if (linked === null) return { kind: "changed" };
  const expectedHash = await contentHashHex(content);
  const { error } = await safe(
    api.vault.write({ path: mention.path, content: linked, expectedHash }),
  );
  if (error === null) return { kind: "linked" };
  if (isDefinedError(error) && error.code === "CAS_MISMATCH") return { kind: "changed" };
  return { kind: "failed", message: refusalMessage(error, "the write was refused") };
}

export function linkMentionMessage(outcome: LinkMentionOutcome, path: string): string {
  switch (outcome.kind) {
    case "linked":
      return `Linked from ${path}.`;
    case "changed":
      return `${path} changed since it was read — reopen Related and try again.`;
    case "failed":
      return `Could not link from ${path}: ${outcome.message}.`;
  }
}
