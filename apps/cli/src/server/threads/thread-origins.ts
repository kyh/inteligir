// an action binds to its note by the note's frontmatter `id`, which a move anywhere (Finder, a
// pull, an agent's `mv`) keeps; the path at compose time answers for a note that has none. a note
// that cannot take an id costs the action its id, never the action.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import type { KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { ensureNoteId } from "../vault/ensure-note-id";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

export interface ThreadOrigins {
  // the note's id, minted into it when it has none; null when it has none and cannot take one
  noteIdAt: (path: string) => Promise<string | null>;
  pathForNoteId: KnowledgeRuntime["pathForNoteId"];
}

export const createThreadOrigins = (
  vault: Pick<VaultService, "read" | "writeIfUnchanged">,
  knowledge: Pick<KnowledgeRuntime, "pathForNoteId">,
): ThreadOrigins => ({
  async noteIdAt(path) {
    try {
      const { content } = await vault.read(path);
      const outcome = await ensureNoteId(vault, path, content);
      return outcome.kind === "id" ? outcome.id : null;
    } catch (error) {
      // the cli may name a note that is not there, or a path the vault refuses
      if (error instanceof VaultServiceError || error instanceof VaultPathError) {
        return null;
      }
      throw error;
    }
  },
  pathForNoteId: knowledge.pathForNoteId,
});
