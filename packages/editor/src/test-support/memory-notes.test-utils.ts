import { deferred } from "@repo/contract/deferred";
import { sameBody } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import { BODY_MAX_BYTES, bodyBytes } from "@repo/contract/library/library-wire";

import type { NoteHost, NoteStanding, Reach } from "../host-io";

export interface StoredNote {
  readonly blocks: readonly BodyBlock[];
  readonly version: number;
  readonly title: string;
  readonly deleted: boolean;
}

interface SentSave {
  readonly save: NoteSave;
  readonly outlives: boolean;
}

type SaveGate = "answer" | "fail" | "hold";

export type MemoryNotes = ReturnType<typeof memoryNotes>;

export const memoryNotes = () => {
  const stored = new Map<string, StoredNote>();
  const followers = new Map<string, Set<(standing: NoteStanding) => void>>();
  const sent: SentSave[] = [];
  const held: (() => void)[] = [];
  const unheldFiles = new Set<string>();
  let gate: SaveGate = "answer";
  let reads = 0;

  const tell = (itemId: string) => {
    const note = stored.get(itemId);

    if (note === undefined) {
      return;
    }

    for (const listener of followers.get(itemId) ?? []) {
      listener({ deleted: note.deleted, version: note.version });
    }
  };

  const answer = ({ baseVersion, blocks, id }: NoteSave) => {
    const note = stored.get(id);

    if (note === undefined) {
      return { kind: "missing" } satisfies NoteSaved;
    }

    if (note.deleted) {
      return { kind: "deleted" } satisfies NoteSaved;
    }

    if (bodyBytes(blocks) > BODY_MAX_BYTES) {
      return { kind: "full" } satisfies NoteSaved;
    }

    if (blocks.some(({ block }) => unheldFiles.has(block.id))) {
      return { kind: "file-missing" } satisfies NoteSaved;
    }

    if (note.version !== baseVersion) {
      return (
        sameBody(note.blocks, blocks) ? { kind: "saved", version: note.version } : { kind: "stale" }
      ) satisfies NoteSaved;
    }

    stored.set(id, { ...note, blocks, version: note.version + 1 });
    tell(id);

    return { kind: "saved", version: note.version + 1 } satisfies NoteSaved;
  };

  const host = (reach: Reach) =>
    ({
      follow: (itemId, listener) => {
        const listeners = followers.get(itemId) ?? new Set();
        listeners.add(listener);
        followers.set(itemId, listeners);

        return () => {
          listeners.delete(listener);
        };
      },
      reach,
      read: async (itemId) => {
        reads += 1;

        if (!reach.get()) {
          throw new Error("no connection");
        }

        const note = stored.get(itemId);
        const read: HeldNote | null = note === undefined ? null : { ...note };

        return await Promise.resolve(read);
      },
      save: async (save, outlives) => {
        sent.push({ outlives, save });

        if (gate === "hold") {
          const through = deferred();
          held.push(() => {
            through.resolve();
          });
          await through.promise;
        }

        if (gate === "fail" || !reach.get()) {
          throw new Error("the network failed the save");
        }

        return answer(save);
      },
    }) satisfies NoteHost;

  return {
    host,
    note: (itemId: string) => stored.get(itemId),
    reads: () => reads,
    seed: (
      itemId: string,
      blocks: readonly BodyBlock[],
      options: { readonly title?: string; readonly deleted?: boolean } = {},
    ) => {
      stored.set(itemId, {
        blocks,
        deleted: options.deleted ?? false,
        title: options.title ?? "Item",
        version: 1,
      });
    },
    sent,
    gate: (next: SaveGate) => {
      gate = next;
    },
    release: () => {
      for (const through of held.splice(0)) {
        through();
      }
    },
    saveElsewhere: (itemId: string, blocks: readonly BodyBlock[]) => {
      const note = stored.get(itemId);

      if (note === undefined) {
        throw new Error(`no note ${itemId}`);
      }

      stored.set(itemId, { ...note, blocks, version: note.version + 1 });
      tell(itemId);
    },
    setDeleted: (itemId: string, deleted: boolean) => {
      const note = stored.get(itemId);

      if (note === undefined) {
        throw new Error(`no note ${itemId}`);
      }

      stored.set(itemId, { ...note, deleted });
      tell(itemId);
    },
    remove: (itemId: string) => {
      stored.delete(itemId);
    },
    loseFileOf: (blockId: string) => {
      unheldFiles.add(blockId);
    },
  };
};
