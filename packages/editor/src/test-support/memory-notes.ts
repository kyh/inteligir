// The library's note bodies in memory, read and saved as the cloud answers them (`write-body.ts`
// in @repo/service): a save over an older version is stale unless it holds the very blocks stored,
// one past the most a note holds is full, one in Deleted is refused, and a gone item is missing.
// Every landing tells the note's followers, as the library's changes do. A case can hold the saves
// in flight, fail them as the network would, or save as someone elsewhere.

import { deferred } from "@repo/contract/deferred";
import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import { sameBody } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";

import type { NoteHost, NoteStanding, Reach } from "../host-io";

export interface StoredNote {
  readonly blocks: readonly BodyBlock[];
  readonly version: number;
  readonly title: string;
  readonly deleted: boolean;
}

// a save the host was handed, and whether it was sent to outlive the page
interface SentSave {
  readonly save: NoteSave;
  readonly outlives: boolean;
}

// what a save meets: the store's answer, the network failing it, or a hold until the case lets
// it through
type SaveGate = "answer" | "fail" | "hold";

export type MemoryNotes = ReturnType<typeof memoryNotes>;

export const memoryNotes = () => {
  const stored = new Map<string, StoredNote>();
  const followers = new Map<string, Set<(standing: NoteStanding) => void>>();
  const sent: SentSave[] = [];
  const held: (() => void)[] = [];
  let gate: SaveGate = "answer";
  let reads = 0;

  const tell = (itemId: string): void => {
    const note = stored.get(itemId);
    if (note === undefined) {
      return;
    }
    for (const listener of followers.get(itemId) ?? []) {
      listener({ deleted: note.deleted, version: note.version });
    }
  };

  const answer = ({ baseVersion, blocks, id }: NoteSave): NoteSaved => {
    const note = stored.get(id);
    if (note === undefined) {
      return { kind: "missing" };
    }
    if (note.deleted) {
      return { kind: "deleted" };
    }
    if (utf8ByteLength(JSON.stringify(blocks)) > BODY_MAX_BYTES) {
      return { kind: "full" };
    }
    if (note.version !== baseVersion) {
      return sameBody(note.blocks, blocks)
        ? { kind: "saved", version: note.version }
        : { kind: "stale" };
    }
    stored.set(id, { ...note, blocks, version: note.version + 1 });
    tell(id);
    return { kind: "saved", version: note.version + 1 };
  };

  const host = (reach: Reach): NoteHost => ({
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
  });

  return {
    host,
    // the note as stored now
    note: (itemId: string): StoredNote | undefined => stored.get(itemId),
    reads: (): number => reads,
    // a note the library holds at version 1
    seed: (
      itemId: string,
      blocks: readonly BodyBlock[],
      options: { readonly title?: string; readonly deleted?: boolean } = {},
    ): void => {
      stored.set(itemId, {
        blocks,
        deleted: options.deleted ?? false,
        title: options.title ?? "Item",
        version: 1,
      });
    },
    sent,
    // saves from now on are answered, failed or held
    gate: (next: SaveGate): void => {
      gate = next;
    },
    // lets every held save through to the store as it stands then
    release: (): void => {
      for (const through of held.splice(0)) {
        through();
      }
    },
    // someone elsewhere saved `blocks`, and the library's changes say so
    saveElsewhere: (itemId: string, blocks: readonly BodyBlock[]): void => {
      const note = stored.get(itemId);
      if (note === undefined) {
        throw new Error(`no note ${itemId}`);
      }
      stored.set(itemId, { ...note, blocks, version: note.version + 1 });
      tell(itemId);
    },
    setDeleted: (itemId: string, deleted: boolean): void => {
      const note = stored.get(itemId);
      if (note === undefined) {
        throw new Error(`no note ${itemId}`);
      }
      stored.set(itemId, { ...note, deleted });
      tell(itemId);
    },
    remove: (itemId: string): void => {
      stored.delete(itemId);
    },
  };
};
