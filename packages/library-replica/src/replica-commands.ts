// The writes a screen makes. Each is checked against the item as the screen reads it, so a base
// the screen no longer shows is answered at once for the editor's diff3 to settle, then queued in
// the replica's own transaction, which is the overlay's from that moment, and sent as soon as the
// replica can. A file is staged by its SHA-256 with the row that names it, before the row, so no
// row waits on bytes the device never kept: a file item's or a cover's with its make, and one a
// note's text embeds as it is kept, in a row of its own that uploads it, which the write or the
// new note naming it stages too. A command's input is the wire's: one its schema refuses throws,
// and nothing is queued.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  annotationOpSchema,
  folderOpSchema,
  placedBlockSchema,
} from "@repo/contract/cloud/library/library-wire";
import { BULK_ITEMS_MAX } from "@repo/contract/cloud/library/library-wire";
import { applyOps } from "@repo/notes/library/block-ops";
import type { ApplyOutcome, LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import type { z } from "zod";

import type { FoldedMakes } from "./folded-makes";
import { basesOf, outboxOpSchema } from "./outbox-ops";
import type { OutboxOp, StagedFile } from "./outbox-ops";
import type { Outbox, StagedBytes } from "./outbox";
import type { NewId, ReplicaClock, ReplicaSql } from "./replica-ports";
import { heldAtAddress, readReplicaItem, rowsNaming } from "./replica-listing";
import { serialLock } from "./serial-lock";
import type { ReplicaItem } from "./replica-listing";

type AnnotationOp = z.infer<typeof annotationOpSchema>;
type FolderOp = z.infer<typeof folderOpSchema>;
type PlacedBlock = z.infer<typeof placedBlockSchema>;
type SaveInput = Extract<OutboxOp, { kind: "save" }>["input"];

// a file's bytes as a screen hands them over, and the type they are sent as
interface NewFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

// the sha a block names a file by, which the host computes before it builds the block
export const fileSha = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

type WriteOutcome =
  // durable, and laid over what the screens read
  | { readonly kind: "queued" }
  // every op was already true
  | { readonly kind: "unchanged" }
  // the item is neither held nor made on this device
  | { readonly kind: "missing" }
  // a base the write names no longer holds against the item as it reads now: the editor settles
  // its edit over `item` and writes again
  | {
      readonly kind: "changed";
      readonly item: ReplicaItem;
      readonly conflicts: Extract<ApplyOutcome, { kind: "conflict" }>["conflicts"];
    }
  // the fields the write leaves break the item's caps
  | {
      readonly kind: "invalid";
      readonly fields: Extract<ApplyOutcome, { kind: "invalid" }>["fields"];
    }
  // the item's body is still to come, and the write names blocks of it or a base that moved, which
  // nothing can settle over no body: it goes once the body is here
  | { readonly kind: "waiting" };

interface WriteInput {
  readonly ops: readonly LibraryOp[];
  readonly annotations?: readonly AnnotationOp[];
}

interface NoteInput {
  readonly blocks: readonly PlacedBlock[];
  readonly folderId: string | null;
  readonly tags: readonly string[];
  readonly title: string;
}

export interface LinkInput {
  readonly url: string;
  readonly title?: string;
  // markdown the cell reads into the item's note
  readonly note?: string;
  readonly folderId: string | null;
  readonly tags: readonly string[];
}

// a page this device read itself, with its cover when it kept one
export interface PageInput extends Omit<SaveInput, "coverSha" | "id" | "savedAt" | "tags"> {
  readonly tags: readonly string[];
  readonly cover: NewFile | null;
}

interface FileInput {
  readonly name: string;
  readonly title?: string;
  readonly file: NewFile;
  readonly folderId: string | null;
  readonly tags: readonly string[];
}

// what a make answers: the item a screen opens, which is the item the library already holds at a
// saved page's address when the cell will fold the save onto it
export interface Made {
  readonly id: string;
  readonly folded: boolean;
}

export interface CommandContext {
  readonly sql: ReplicaSql;
  readonly outbox: Outbox;
  readonly folded: FoldedMakes;
  readonly clock: ReplicaClock;
  readonly newId: NewId;
  // a row was queued: the replica sends it as soon as it can
  readonly queued: () => void;
}

export interface ReplicaCommands {
  readonly write: (itemId: string, input: WriteInput) => Promise<WriteOutcome>;
  readonly createNote: (input: NoteInput) => Promise<Made>;
  readonly saveLink: (input: LinkInput) => Promise<Made>;
  readonly savePage: (input: PageInput) => Promise<Made>;
  readonly createFile: (input: FileInput) => Promise<Made & { readonly sha: string }>;
  // a file for a block still to be written (a picture pasted into a note): kept on the device and
  // sent up at once, its sha what the block names it by
  readonly keepFile: (file: NewFile) => Promise<{ readonly sha: string }>;
  readonly deleteItems: (ids: readonly string[]) => Promise<void>;
  readonly restoreItems: (ids: readonly string[]) => Promise<void>;
  readonly writeFolders: (ops: readonly FolderOp[]) => Promise<void>;
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
};

const touchesNothing = (outcome: Extract<ApplyOutcome, { kind: "applied" }>): boolean =>
  outcome.touched.blocks.size === 0 &&
  outcome.touched.dropped.size === 0 &&
  !outcome.touched.fields;

// a drop or a move of a block this device does not hold reads as already true, which a body still
// to come may not bear out
const shiftsUnheldBlock = (op: LibraryOp, blocks: ReadonlyMap<string, StoredBlock>): boolean =>
  (op.op === "drop" || op.op === "move") && !blocks.has(op.blockId);

const tagsOf = (tags: readonly string[]): LibraryItemFields["tags"] => [...new Set(tags)];

// a file as its row names it and as the outbox stages it with the row, from one sha, so neither
// goes without the other
interface Staging {
  readonly sha: string;
  readonly staged: [StagedFile];
  readonly bytes: [StagedBytes];
}

const staging = (file: NewFile): Staging => {
  const sha = fileSha(file.bytes);
  return {
    bytes: [{ bytes: file.bytes, mime: file.mime, sha }],
    sha,
    staged: [{ mime: file.mime, sha }],
  };
};

export const createCommands = (context: CommandContext): ReplicaCommands => {
  const { clock, folded, newId, outbox, sql } = context;
  // one command at a time, so each checks the item the one before it left
  const serial = serialLock();

  const enqueue = async (op: OutboxOp, files: readonly StagedBytes[] = []): Promise<void> => {
    await outbox.enqueue(outboxOpSchema.parse(op), files);
    context.queued();
  };

  return {
    createFile: async (input) =>
      await serial(async () => {
        const id = newId();
        const { bytes, sha, staged } = staging(input.file);
        const made: Extract<OutboxOp, { kind: "createFile" }>["input"] = {
          folderId: input.folderId,
          id,
          name: input.name,
          savedAt: clock.now(),
          sha,
          tags: tagsOf(input.tags),
        };
        if (input.title !== undefined) {
          made.title = input.title;
        }
        await enqueue({ input: made, kind: "createFile", staged }, bytes);
        return { folded: false, id, sha };
      }),

    createNote: async (input) =>
      await serial(async () => {
        const id = newId();
        await enqueue({
          input: {
            blocks: [...input.blocks],
            folderId: input.folderId,
            id,
            savedAt: clock.now(),
            tags: tagsOf(input.tags),
            title: input.title,
          },
          kind: "create",
          staged: [],
        });
        return { folded: false, id };
      }),

    deleteItems: async (ids) => {
      await serial(async () => {
        for (const part of chunks([...new Set(ids)], BULK_ITEMS_MAX)) {
          await enqueue({ ids: part, kind: "delete" });
        }
      });
    },

    keepFile: async (file) =>
      await serial(async () => {
        const { bytes, sha, staged } = staging(file);
        await enqueue({ kind: "keep", staged }, bytes);
        return { sha };
      }),

    restoreItems: async (ids) => {
      await serial(async () => {
        for (const part of chunks([...new Set(ids)], BULK_ITEMS_MAX)) {
          await enqueue({ ids: part, kind: "restore" });
        }
      });
    },

    saveLink: async (input) =>
      await serial(async () => {
        const id = newId();
        const holder = await runPlanAsync(sql, heldAtAddress(input.url));
        const link: Extract<OutboxOp, { kind: "saveLink" }>["input"] = {
          folder: input.folderId === null ? null : { id: input.folderId },
          id,
          savedAt: clock.now(),
          tags: tagsOf(input.tags),
          url: input.url,
        };
        if (input.title !== undefined) {
          link.title = input.title;
        }
        if (input.note !== undefined) {
          link.note = input.note;
        }
        await enqueue({ input: link, kind: "saveLink" });
        return holder === null ? { folded: false, id } : { folded: true, id: holder };
      }),

    savePage: async (input) =>
      await serial(async () => {
        const id = newId();
        const holder = await runPlanAsync(sql, heldAtAddress(input.url));
        const { cover, tags, ...page } = input;
        const file = cover === null ? null : staging(cover);
        await enqueue(
          {
            input: {
              ...page,
              coverSha: file?.sha ?? null,
              id,
              savedAt: clock.now(),
              tags: tagsOf(tags),
            },
            kind: "save",
            staged: file?.staged ?? [],
          },
          file?.bytes ?? [],
        );
        return holder === null ? { folded: false, id } : { folded: true, id: holder };
      }),

    write: async (asked, input) =>
      await serial(async () => {
        const itemId = folded.landedAs(asked);
        const item = await runPlanAsync(
          sql,
          readReplicaItem(itemId, rowsNaming(outbox.rows(), itemId)),
        );
        if (item === null) {
          return { kind: "missing" };
        }
        const blocks = new Map(item.blocks.map((held) => [held.block.id, held]));
        if (!item.bodyHeld && input.ops.some((op) => shiftsUnheldBlock(op, blocks))) {
          return { kind: "waiting" };
        }
        const outcome = applyOps({ blocks, fields: item.fields }, input.ops);
        if (outcome.kind === "conflict") {
          return item.bodyHeld
            ? { conflicts: outcome.conflicts, item, kind: "changed" }
            : { kind: "waiting" };
        }
        if (outcome.kind === "invalid") {
          return { fields: outcome.fields, kind: "invalid" };
        }
        const annotations = [...(input.annotations ?? [])];
        if (touchesNothing(outcome) && annotations.length === 0) {
          return { kind: "unchanged" };
        }
        await enqueue({
          annotations,
          bases: basesOf(input.ops, blocks),
          itemId,
          kind: "write",
          ops: [...input.ops],
          staged: [],
        });
        return { kind: "queued" };
      }),

    writeFolders: async (ops) => {
      await serial(async () => {
        if (ops.length > 0) {
          await enqueue({ kind: "folders", ops: [...ops] });
        }
      });
    },
  };
};
