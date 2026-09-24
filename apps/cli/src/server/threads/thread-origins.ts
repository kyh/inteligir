// an action binds to its note by the note's frontmatter `id`, which a move anywhere (Finder, a
// pull, an agent's `mv`) keeps; the path at compose time answers for a note that has none. a note
// that cannot take an id costs the action its id, never the action, and a file that is no doc
// (an image, a pdf) is never read for one: its bytes are not frontmatter, and a mint would
// rewrite them as text.

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import type { KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { ensureNoteId } from "../vault/ensure-note-id";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

export interface ThreadOrigins {
  // the note's id, minted into it when it has none; null when it has none and cannot take one
  noteIdAt: (path: string) => Promise<string | null>;
  // the note's id as its bytes stand, minting nothing: a listing reads, it never writes
  noteIdOf: (path: string) => Promise<string | null>;
  pathForNoteId: KnowledgeRuntime["pathForNoteId"];
}

// the cli may name a note that is not there, a path the vault refuses, or a file that is no doc
const orNull = async (path: string, read: () => Promise<string | null>): Promise<string | null> => {
  if (!isDocPath(path)) {
    return null;
  }
  try {
    return await read();
  } catch (error) {
    if (error instanceof VaultServiceError || error instanceof VaultPathError) {
      return null;
    }
    throw error;
  }
};

export const createThreadOrigins = (
  vault: Pick<VaultService, "read" | "writeIfUnchanged">,
  knowledge: Pick<KnowledgeRuntime, "pathForNoteId">,
): ThreadOrigins => ({
  noteIdAt: async (path) =>
    await orNull(path, async () => {
      const { content } = await vault.read(path);
      const outcome = await ensureNoteId(vault, path, content);
      return outcome.kind === "id" ? outcome.id : null;
    }),
  noteIdOf: async (path) =>
    await orNull(path, async () => {
      const { content } = await vault.read(path);
      return frontmatterId(content);
    }),
  pathForNoteId: knowledge.pathForNoteId,
});
