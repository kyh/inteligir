// The writes a screen makes. Each is checked against the item as the screen reads it, so a base
// the screen no longer shows is answered at once for the editor's diff3 to settle, then queued in
// the replica's own transaction, which is the overlay's from that moment, and sent as soon as the
// replica can. A file a write names is staged by its SHA-256 with the row that names it, before
// the row, so no row waits on bytes the device never kept. A command's input is the wire's: one
// its schema refuses throws, and nothing is queued.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  annotationOpSchema,
  folderOpSchema,
  placedBlockSchema,
} from "@repo/contract/cloud/library/library-wire";
import { BULK_ITEMS_MAX } from "@repo/contract/cloud/library/library-wire";
import { applyOps } from "@repo/notes/library/block-ops";
import type { ApplyOutcome, LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import type { z } from "zod";

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
export interface NewFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

// the sha a block names a file by, which the host computes before it builds the block
export const fileSha = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

export type WriteOutcome =
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
    };

export interface WriteInput {
  readonly ops: readonly LibraryOp[];
  readonly annotations?: readonly AnnotationOp[];
  // the bytes of each file a block it puts embeds
  readonly files?: readonly NewFile[];
}

export interface NoteInput {
  readonly blocks: readonly PlacedBlock[];
  readonly folderId: string | null;
  readonly tags: readonly string[];
  readonly title: string;
  readonly files?: readonly NewFile[];
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

export interface FileInput {
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

const tagsOf = (tags: readonly string[]): LibraryItemFields["tags"] => [...new Set(tags)];

// what a row names of a command's files, once each by their bytes' sha, and the bytes the outbox
// stages with the row
interface Staging {
  readonly staged: StagedFile[];
  readonly bytes: StagedBytes[];
}

const staging = (files: readonly NewFile[]): Staging => {
  const staged: StagedFile[] = [];
  const bytes: StagedBytes[] = [];
  for (const file of files) {
    const sha = fileSha(file.bytes);
    if (staged.some((held) => held.sha === sha)) {
      continue;
    }
    staged.push({ mime: file.mime, sha });
    bytes.push({ bytes: file.bytes, mime: file.mime, sha });
  }
  return { bytes, staged };
};

export const createCommands = (context: CommandContext): ReplicaCommands => {
  const { clock, newId, outbox, sql } = context;
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
        const sha = fileSha(input.file.bytes);
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
        await enqueue(
          { input: made, kind: "createFile", staged: [{ mime: input.file.mime, sha }] },
          [{ bytes: input.file.bytes, mime: input.file.mime, sha }],
        );
        return { folded: false, id, sha };
      }),

    createNote: async (input) =>
      await serial(async () => {
        const id = newId();
        const files = staging(input.files ?? []);
        await enqueue(
          {
            input: {
              blocks: [...input.blocks],
              folderId: input.folderId,
              id,
              savedAt: clock.now(),
              tags: tagsOf(input.tags),
              title: input.title,
            },
            kind: "create",
            staged: files.staged,
          },
          files.bytes,
        );
        return { folded: false, id };
      }),

    deleteItems: async (ids) =>
      await serial(async () => {
        for (const part of chunks([...new Set(ids)], BULK_ITEMS_MAX)) {
          await enqueue({ ids: part, kind: "delete" });
        }
      }),

    restoreItems: async (ids) =>
      await serial(async () => {
        for (const part of chunks([...new Set(ids)], BULK_ITEMS_MAX)) {
          await enqueue({ ids: part, kind: "restore" });
        }
      }),

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
        const { cover: coverFile, tags, ...page } = input;
        const files = staging(coverFile === null ? [] : [coverFile]);
        await enqueue(
          {
            input: {
              ...page,
              coverSha: coverFile === null ? null : fileSha(coverFile.bytes),
              id,
              savedAt: clock.now(),
              tags: tagsOf(tags),
            },
            kind: "save",
            staged: files.staged,
          },
          files.bytes,
        );
        return holder === null ? { folded: false, id } : { folded: true, id: holder };
      }),

    write: async (itemId, input) =>
      await serial(async () => {
        const item = await runPlanAsync(
          sql,
          readReplicaItem(itemId, rowsNaming(outbox.rows(), itemId)),
        );
        if (item === null) {
          return { kind: "missing" };
        }
        const blocks = new Map(item.blocks.map((held) => [held.block.id, held]));
        const outcome = applyOps({ blocks, fields: item.fields }, input.ops);
        if (outcome.kind === "conflict") {
          return { conflicts: outcome.conflicts, item, kind: "changed" };
        }
        if (outcome.kind === "invalid") {
          return { fields: outcome.fields, kind: "invalid" };
        }
        const annotations = [...(input.annotations ?? [])];
        if (touchesNothing(outcome) && annotations.length === 0) {
          return { kind: "unchanged" };
        }
        const files = staging(input.files ?? []);
        await enqueue(
          {
            annotations,
            bases: basesOf(input.ops, blocks),
            itemId,
            kind: "write",
            ops: [...input.ops],
            staged: files.staged,
          },
          files.bytes,
        );
        return { kind: "queued" };
      }),

    writeFolders: async (ops) =>
      await serial(async () => {
        if (ops.length > 0) {
          await enqueue({ kind: "folders", ops: [...ops] });
        }
      }),
  };
};
