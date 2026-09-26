import { commentStoresFreedBy } from "@repo/notes/comments/store-removal";
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

// A note's comment store goes with the note, a folder's with every note under it, by the one
// rule in `@repo/notes/comments/store-removal`; the deleted-notes restore brings both back from
// the same revision. The entry goes first: a store left behind is a leak, a store gone before its
// note is a loss. Answers every path it removed, the entry first.
export const removeEntryWithComments = async (
  service: VaultService,
  path: string,
  knowledge: Pick<KnowledgeRuntime, "noteIdOwners">,
): Promise<string[]> => {
  const docs = await docsUnder(service, path);
  const removedDocs = await mapWithConcurrency(docs, ID_READ_CONCURRENCY, async (doc) => {
    const content = await readForId(service, doc);
    return { noteId: content === null ? null : frontmatterId(content), path: doc };
  });
  await service.remove(path);
  const removedPaths = [path];
  const owners = new Map<string, readonly string[]>();
  for (const { noteId } of removedDocs) {
    if (noteId !== null && !owners.has(noteId)) {
      owners.set(noteId, await knowledge.noteIdOwners(noteId));
    }
  }
  for (const storePath of commentStoresFreedBy(removedDocs, (id) => owners.get(id) ?? [])) {
    try {
      await service.remove(storePath);
      removedPaths.push(storePath);
    } catch (error) {
      if (!(error instanceof VaultServiceError && error.code === "not_found")) {
        throw error;
      }
    }
  }
  return removedPaths;
};
