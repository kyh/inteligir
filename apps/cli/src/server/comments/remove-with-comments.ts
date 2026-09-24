import { commentsStorePath, isNoteIdKey } from "@repo/notes/comments/sidecar-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";

import { mapWithConcurrency } from "../concurrency";
import type { KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

const docsUnder = async (service: VaultService, path: string): Promise<string[]> => {
  const kind = await service.statEntry(path);
  if (kind === "dir") {
    const files = await service.listFilesUnder(path);
    return files.filter(isDocPath);
  }
  return kind === "file" && isDocPath(path) ? [path] : [];
};

const ID_READ_CONCURRENCY = 8;

// the id lookup never refuses the delete. a doc gone mid-scan has no store to take; one past the
// read cap has none either, since the comments service reads through the same cap and so never
// minted an id into it, but an id written by hand strands its store, so that one is named.
const readForId = async (service: VaultService, doc: string): Promise<string | null> => {
  try {
    const { content } = await service.read(doc);
    return content;
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "not_found") {
      return null;
    }
    if (error instanceof VaultServiceError && error.code === "too_large") {
      console.warn(`[comments] ${doc}: past the read cap; any comment store it has is left`);
      return null;
    }
    throw error;
  }
};

// A note's comment store goes with the note, a folder's with every note under it, so nothing
// leaks under `.inteligir/`; the deleted-notes restore brings both back from the same revision.
// The entry goes first: a store left behind is a leak, a store gone before its note is a loss.
// A byte copy carries the `id:` line along, so a store whose id another note still carries
// stays. An index that has not seen that note yet names no other owner, so the guard never
// removes more than an unguarded delete would.
export const removeEntryWithComments = async (
  service: VaultService,
  path: string,
  knowledge: Pick<KnowledgeRuntime, "noteIdOwners">,
): Promise<{ keptStores: string[] }> => {
  const docs = await docsUnder(service, path);
  const found = await mapWithConcurrency(docs, ID_READ_CONCURRENCY, async (doc) => {
    const content = await readForId(service, doc);
    const id = content === null ? null : frontmatterId(content);
    return id !== null && isNoteIdKey(id) ? id : null;
  });
  const ids = new Set(found.filter((id) => id !== null));
  await service.remove(path);
  const removed = new Set(docs);
  const keptStores: string[] = [];
  for (const id of ids) {
    const store = commentsStorePath(id);
    const owners = await knowledge.noteIdOwners(id);
    if (owners.some((owner) => !removed.has(owner))) {
      keptStores.push(store);
      continue;
    }
    try {
      await service.remove(store);
    } catch (error) {
      if (!(error instanceof VaultServiceError && error.code === "not_found")) {
        throw error;
      }
    }
  }
  return { keptStores };
};
