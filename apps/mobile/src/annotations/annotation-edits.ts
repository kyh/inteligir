// What the annotations sheet writes, through the replica's outbox like any edit, each guarded by
// the note text it was read with, as the library's page writes them: a bare highlight's note, a
// reply, and a highlight gone with its replies. Each answers whether it was queued; the sheet reads
// the item's highlights again from the replica's change, so a write that lands on another opening
// of the sheet never draws over it. Pure: the suite drives it over a real replica.

import { foldAnnotations } from "@repo/notes/annotations/annotation-threads";
import type { AnnotationThread } from "@repo/notes/annotations/annotation-threads";
import { mintAnnotationId } from "@repo/notes/annotations/store-schema";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { deriveItem } from "@repo/notes/library/derive-item";
import type { LibraryReplica, ReplicaItem } from "@repo/library-replica/library-replica";

export interface AnnotationEdits {
  readonly note: (rootId: string, text: string) => Promise<boolean>;
  readonly reply: (rootId: string, text: string) => Promise<boolean>;
  readonly remove: (rootId: string) => Promise<boolean>;
}

const queued = (kind: string): boolean => kind === "queued" || kind === "unchanged";

export const createAnnotationEdits = (args: {
  readonly replica: LibraryReplica;
  readonly itemId: string;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
}): AnnotationEdits => {
  const { itemId, replica } = args;
  const held = async (id: string) => {
    const store = await replica.annotations(itemId);
    return store[id];
  };
  return {
    note: async (rootId, text) => {
      const entry = await held(rootId);
      if (entry === undefined) {
        return false;
      }
      const outcome = await replica.write(itemId, {
        annotations: [{ base: entry.text, id: rootId, op: "note", text }],
        ops: [],
      });
      return queued(outcome.kind);
    },
    remove: async (rootId) => {
      const entry = await held(rootId);
      if (entry === undefined) {
        return true;
      }
      const outcome = await replica.write(itemId, {
        annotations: [{ base: entry.text, id: rootId, op: "remove" }],
        ops: [],
      });
      return queued(outcome.kind);
    },
    reply: async (rootId, text) => {
      const outcome = await replica.write(itemId, {
        annotations: [
          {
            createdAt: Math.floor(args.now() / 1000),
            id: mintAnnotationId(args.randomBytes),
            occurrence: null,
            op: "add",
            parentId: rootId,
            quote: null,
            text,
          },
        ],
        ops: [],
      });
      return queued(outcome.kind);
    },
  };
};

// the item's highlights as threads, each said placed or not by the markers its blocks hold now
export const threadsOf = (store: AnnotationStore, item: ReplicaItem): AnnotationThread[] => {
  const blocks = new Map(item.blocks.map((stored) => [stored.block.id, stored]));
  const markers = new Set(
    [...deriveItem(item.fields, blocks).blocks.values()].flatMap((block) => block.annotationIds),
  );
  return foldAnnotations(store, item.bodyHeld ? markers : null).annotations;
};
