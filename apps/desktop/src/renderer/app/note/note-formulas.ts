// A bound ref names its note by frontmatter id, and the index's listing already answers which
// path holds that id, so a ref costs one read of one note rather than a read of every doc.

import { vaultChangeTouches } from "@repo/editor/host-io";
import type { EditorHostIo, VaultChangedEvent } from "@repo/editor/host-io";
import { collectFormulas } from "@repo/notes/formulas/collect-formulas";
import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import { resolverEntriesOf } from "@repo/notes/knowledge/link-graph-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import type { WikiTargetWire } from "@repo/api/local/knowledge/knowledge-schema";

export interface NoteFormulaPorts {
  /** Must join the refetch a vault change set off, so an id is never looked up in a listing older than that change. */
  readonly listTargets: () => Promise<readonly WikiTargetWire[]>;
  readonly readFile: (path: string) => Promise<string>;
}

export interface NoteFormulas {
  readonly read: EditorHostIo["readNoteFormulas"];
  readonly forget: (event: VaultChangedEvent) => void;
}

export const createNoteFormulas = ({ listTargets, readFile }: NoteFormulaPorts): NoteFormulas => {
  // By path, not id: a change event names paths, and the id lives in the very bytes it evicts.
  const byPath = new Map<string, Promise<CollectedFormula[] | null>>();

  const collectAt = async (path: string): Promise<CollectedFormula[] | null> => {
    const content = await readFile(path).catch(() => null);
    return content === null ? null : collectFormulas(content);
  };

  const formulasAt = async (path: string): Promise<CollectedFormula[] | null> => {
    const cached = byPath.get(path);
    if (cached !== undefined) {
      return await cached;
    }
    const pending = collectAt(path);
    byPath.set(path, pending);
    const formulas = await pending;
    // a refused read is not remembered, so the next pass asks again
    if (formulas === null && byPath.get(path) === pending) {
      byPath.delete(path);
    }
    return formulas;
  };

  return {
    forget: (event) => {
      for (const path of byPath.keys()) {
        if (vaultChangeTouches(event, path)) {
          byPath.delete(path);
        }
      }
    },
    // the id tier's own pick, so a byte copy sharing the id answers as it does for a uuid link.
    read: async ({ noteId }) => {
      const { idEntries } = resolverEntriesOf(await listTargets());
      const path = buildResolver([], [], idEntries).resolveNoteId(noteId);
      if (path === null) {
        return null;
      }
      const formulas = await formulasAt(path);
      return formulas === null ? null : { formulas, path };
    },
  };
};
