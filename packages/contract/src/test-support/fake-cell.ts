// An account's library cell as a client's suites need it, in memory: `/v1/rpc` served by oRPC's
// own handler over the rows a client writes through, and `/v1/blobs/<sha>`, each device reaching
// it through a transport of its own whose network a suite can take down or whose next answers it
// can lose after the cell acted. It keeps the rules a client leans on: a write lands only on the
// bases it names (`@repo/notes/library/block-ops`) and answers CONFLICT with what moved, an op id
// is answered once, a file must be uploaded before a write names it, and every write takes the
// library's next sequence.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { V1_BLOBS_PATH } from "../cloud/library/library-blobs";
import type { conflictCurrentSchema, folderOpSchema } from "../cloud/library/library-wire";
import { folderRowSchema, liveItemRowSchema } from "../cloud/library/library-wire";
import { v1Contract, V1_RPC_PATH } from "../cloud/v1-contract";
import type { V1Client } from "../cloud/v1-contract";
import {
  BlobMissingError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "../cloud/v1-errors";
import { UNKNOWN_FILE_TYPE } from "@repo/notes/items/item-kind";
import { urlKey } from "@repo/notes/items/item-url";
import { blockHash } from "@repo/notes/library/block-hash";
import { applyOps } from "@repo/notes/library/block-ops";
import type { LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import { ordsBetween } from "@repo/notes/library/block-order";
import { deriveItem, titleKey } from "@repo/notes/library/derive-item";
import { fileSha } from "@repo/notes/library/file-sha";
import { fileFields, noteFields, pageFields, stubFields } from "@repo/notes/library/item-makes";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import { z } from "zod";

import type { V1Transport } from "../cloud/library/call-outcome";

type LiveRow = z.infer<typeof liveItemRowSchema>;
type ConflictCurrent = z.infer<typeof conflictCurrentSchema>;
type FolderOp = z.infer<typeof folderOpSchema>;
type FolderRow = z.infer<typeof folderRowSchema>;

interface CellItem {
  readonly fields: LibraryItemFields;
  readonly blocks: ReadonlyMap<string, StoredBlock>;
  readonly seq: number;
  readonly updatedAt: number;
}

/** @internal */
export interface FakeDevice {
  readonly transport: V1Transport;
  // the same door as a client of the suite's own, for another writer's calls
  readonly client: V1Client;
  readonly setOffline: (offline: boolean) => void;
  // the next answers are lost after the cell acted on their requests
  readonly loseAnswers: (count: number) => void;
}

/** @internal */
export interface FakeCell {
  readonly device: (name: string) => FakeDevice;
  readonly item: (id: string) => CellItem | null;
  readonly items: () => ReadonlyMap<string, CellItem>;
  // each call, as `<device> <procedure>` (`library/write`), and each upload by sha
  readonly calls: string[];
  readonly uploads: string[];
  // every call is refused as a revoked sign-in
  readonly signOut: () => void;
}

const NOW = 1_700_000_100_000;
const ORIGIN = "https://cell.test";

const placed = (block: LibraryBlock, ord: string, section: LibrarySection): StoredBlock => ({
  block,
  hash: blockHash(block),
  ord,
  section,
});

// a save's words as the one paragraph the real cell's codec would read them into; blank words are
// none
const noteBlocks = (id: string, note: string | undefined): [string, StoredBlock][] => {
  const blockId = `${id}-note`;
  const [ord] = ordsBetween(null, null, 1);
  return note === undefined || note.trim() === "" || ord === undefined
    ? []
    : [[blockId, placed({ children: [{ text: note }], id: blockId, type: "p" }, ord, "note")]];
};

// every sha the blocks a write carries name their bytes by
const SHA_KEY_RE = /"sha":"(?<sha>[0-9a-f]{64})"/gu;
const shasIn = (json: string): Set<string> =>
  new Set([...json.matchAll(SHA_KEY_RE)].flatMap((match) => match.groups?.sha ?? []));

// a folder as one op leaves it, at the sequence its write lands under
const folderAfter = (op: FolderOp, folder: FolderRow | null, seq: number): FolderRow | null => {
  if (op.op === "create") {
    return { deletedAt: null, id: op.id, name: op.name, parentId: op.parentId, seq, sort: op.sort };
  }
  if (folder === null) {
    return null;
  }
  switch (op.op) {
    case "rename": {
      return { ...folder, name: op.name, seq };
    }
    case "move": {
      return { ...folder, parentId: op.parentId, seq, sort: op.sort };
    }
    case "delete": {
      return { ...folder, deletedAt: NOW, seq };
    }
    // no default
  }
};

const throwConflicts = (current: readonly ConflictCurrent[]): void => {
  const [first, ...rest] = current;
  if (first !== undefined) {
    throw new ConflictError({ data: { current: [first, ...rest] } });
  }
};

type OpConflict = Extract<ReturnType<typeof applyOps>, { kind: "conflict" }>["conflicts"][number];

const currentOf = (itemId: string, conflict: OpConflict): ConflictCurrent => {
  switch (conflict.kind) {
    case "block": {
      return { blockId: conflict.blockId, current: conflict.current, itemId, kind: "block" };
    }
    case "order": {
      return { blockId: conflict.blockId, currentOrd: conflict.currentOrd, itemId, kind: "order" };
    }
    case "field": {
      return {
        current: z.json().parse(conflict.current),
        field: conflict.field,
        itemId,
        kind: "field",
      };
    }
    case "property": {
      return conflict.current === undefined
        ? { itemId, key: conflict.key, kind: "property" }
        : {
            current: z.json().parse(conflict.current),
            itemId,
            key: conflict.key,
            kind: "property",
          };
    }
    // no default
  }
};

/** @internal */
export const createFakeCell = (): FakeCell => {
  let head = 0;
  let signedOut = false;
  let signIns = 0;
  const items = new Map<string, CellItem>();
  const folders = new Map<string, FolderRow>();
  // each file's bytes, and its type as its upload named it
  const blobs = new Map<
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: string }
  >();
  const answers = new Map<string, unknown>();
  const calls: string[] = [];
  const uploads: string[] = [];

  const liveRow = (id: string, item: CellItem): LiveRow => {
    const { card } = deriveItem(item.fields, item.blocks);
    return {
      card: { ...card, outline: [...card.outline] },
      fields: item.fields,
      id,
      kind: "live",
      seq: item.seq,
      updatedAt: item.updatedAt,
    };
  };

  const land = (
    id: string,
    fields: LibraryItemFields,
    blocks: ReadonlyMap<string, StoredBlock>,
  ) => {
    head += 1;
    const item: CellItem = { blocks, fields, seq: head, updatedAt: NOW + head };
    items.set(id, item);
    return { item: liveRow(id, item) };
  };

  // an op id's first answer, every time it is asked again; a refusal is not kept
  const once = <T>(opId: string | undefined, schema: z.ZodType<T>, act: () => T): T => {
    const held = opId === undefined ? undefined : answers.get(opId);
    if (held !== undefined) {
      return schema.parse(held);
    }
    const answer = act();
    if (opId !== undefined) {
      answers.set(opId, answer);
    }
    return answer;
  };

  const needsBlobs = (shas: Iterable<string>): void => {
    const missing = [...shas].filter((sha) => !blobs.has(sha));
    const [first, ...rest] = missing;
    if (first !== undefined) {
      throw new BlobMissingError({ data: { shas: [first, ...rest] } });
    }
  };

  // the live item at an address, which a save folds onto
  const holderOf = (url: string): string | null => {
    const key = urlKey(url);
    for (const [id, item] of items) {
      const { deletedAt, url: address } = item.fields;
      if (key !== null && deletedAt === null && address !== null && urlKey(address) === key) {
        return id;
      }
    }
    return null;
  };

  // a write refused for leaving its item live at an address another live item holds
  const refuseHeldAddress = (itemId: string, fields: LibraryItemFields): void => {
    const holder = fields.url === null || fields.deletedAt !== null ? null : holderOf(fields.url);
    const item = holder === null || holder === itemId ? undefined : items.get(holder);
    if (holder !== null && item !== undefined) {
      throw new ConflictError({
        data: { current: [{ itemId: holder, kind: "item", seq: item.seq }] },
        message: "Another item in your library already holds this link.",
      });
    }
  };

  const write = (input: { readonly itemId: string; readonly ops: readonly LibraryOp[] }) => {
    const item = items.get(input.itemId);
    if (item === undefined) {
      throw new NotFoundError();
    }
    needsBlobs(shasIn(JSON.stringify(input.ops)));
    const outcome = applyOps({ blocks: item.blocks, fields: item.fields }, input.ops);
    throwConflicts(
      outcome.kind === "conflict"
        ? outcome.conflicts.map((conflict) => currentOf(input.itemId, conflict))
        : [],
    );
    if (outcome.kind === "invalid") {
      throw new PayloadTooLargeError();
    }
    if (outcome.kind !== "applied") {
      throw new Error("a write met a conflict it did not answer");
    }
    refuseHeldAddress(input.itemId, outcome.state.fields);
    const { touched } = outcome;
    // every op already true, a resend's after its answer was let go: the item as it stands
    if (touched.blocks.size === 0 && touched.dropped.size === 0 && !touched.fields) {
      return { item: liveRow(input.itemId, item) };
    }
    return land(input.itemId, outcome.state.fields, outcome.state.blocks);
  };

  const held = (id: string): CellItem => {
    const item = items.get(id);
    if (item === undefined) {
      throw new NotFoundError();
    }
    return item;
  };

  const made = (id: string): void => {
    const item = items.get(id);
    if (item !== undefined) {
      throw new ConflictError({ data: { current: [{ itemId: id, kind: "item", seq: item.seq }] } });
    }
  };

  // a save of the address an item holds: that item as it stands
  const answerHeld = (id: string) => ({ created: false, item: liveRow(id, held(id)) });

  // the live sibling a folder would share a name with, which the cell answers a CONFLICT naming
  const namesakeOf = (op: FolderOp, folder: FolderRow | null): FolderRow | null => {
    const parentId = op.op === "create" || op.op === "move" ? op.parentId : folder?.parentId;
    const name = op.op === "create" || op.op === "rename" ? op.name : folder?.name;
    if (op.op === "delete" || name === undefined) {
      return null;
    }
    return (
      [...folders.values()].find(
        (sibling) =>
          sibling.id !== op.id &&
          sibling.deletedAt === null &&
          sibling.parentId === parentId &&
          titleKey(sibling.name) === titleKey(name),
      ) ?? null
    );
  };

  const storeFolder = (row: FolderRow, landed: Map<string, FolderRow>): void => {
    folders.set(row.id, row);
    landed.set(row.id, row);
  };

  const deleteUnder = (parentId: string, landed: Map<string, FolderRow>): void => {
    for (const folder of folders.values()) {
      if (folder.parentId === parentId && folder.deletedAt === null) {
        storeFolder({ ...folder, deletedAt: NOW, seq: head }, landed);
        deleteUnder(folder.id, landed);
      }
    }
  };

  const folderWrite = (ops: readonly FolderOp[]) => {
    const conflicts: ConflictCurrent[] = [];
    for (const op of ops) {
      const folder = folders.get(op.id) ?? null;
      const moved =
        (op.op === "create" && folder !== null) ||
        (op.op !== "create" && folder === null) ||
        (op.op === "rename" && folder?.name !== op.base) ||
        (op.op === "move" && folder?.parentId !== op.baseParentId);
      const namesake = namesakeOf(op, folder);
      if (moved) {
        conflicts.push({ current: folder, id: op.id, kind: "folder" });
      } else if (namesake !== null) {
        conflicts.push({ current: namesake, id: namesake.id, kind: "folder" });
      }
    }
    throwConflicts(conflicts);
    head += 1;
    const landed = new Map<string, FolderRow>();
    for (const op of ops) {
      const next = folderAfter(op, folders.get(op.id) ?? null, head);
      if (next !== null) {
        storeFolder(next, landed);
      }
      if (op.op === "delete") {
        deleteUnder(op.id, landed);
      }
    }
    return { folders: [...landed.values()], seq: head };
  };

  const landedSchema = z.object({ item: liveItemRowSchema });
  const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
  const restoredSchema = z.object({
    addressHeld: z.array(z.string()),
    missing: z.array(z.string()),
    restored: z.array(z.string()),
  });
  const os = implement(v1Contract);

  const router = {
    account: {
      // a device's sign-in answers a credential of its own, as the Worker's does
      signIn: os.account.signIn.handler(({ input }) => {
        signIns += 1;
        return {
          credential: `igd_${signIns.toString(16).padStart(64, "0")}`,
          deviceId: `device-${String(signIns)}`,
          email: input.email,
          userId: "user-1",
        };
      }),
      signOut: os.account.signOut.handler(() => ({ revoked: true as const })),
      socketTicket: os.account.socketTicket.handler(() => ({
        expiresAt: NOW + 60_000,
        ticket: "a-ticket",
      })),
    },
    library: {
      folders: {
        write: os.library.folders.write.handler(({ input }) =>
          once(input.opId, foldersWrittenSchema, () => folderWrite(input.ops)),
        ),
      },
      items: {
        create: os.library.items.create.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            made(input.id);
            needsBlobs(shasIn(JSON.stringify(input.blocks)));
            return land(
              input.id,
              noteFields(input),
              new Map(
                input.blocks.map((block) => [
                  block.block.id,
                  placed(block.block, block.ord, block.section),
                ]),
              ),
            );
          }),
        ),
        createFile: os.library.items.createFile.handler(({ input }) =>
          once(input.opId, landedSchema, () => {
            made(input.id);
            needsBlobs([input.sha]);
            const mime = blobs.get(input.sha)?.mime ?? UNKNOWN_FILE_TYPE;
            return land(input.id, fileFields({ ...input, mime }), new Map());
          }),
        ),
        delete: os.library.items.delete.handler(({ input }) => {
          const deleted = input.ids.filter((id) => items.has(id));
          for (const id of deleted) {
            const item = held(id);
            land(id, { ...item.fields, deletedAt: NOW }, item.blocks);
          }
          return { deleted, missing: input.ids.filter((id) => !deleted.includes(id)) };
        }),
        restore: os.library.items.restore.handler(({ input }) =>
          once(input.opId, restoredSchema, () => {
            const known = input.ids.filter((id) => items.has(id));
            const addressHeld = known.filter((id) => {
              const address = held(id).fields.url;
              const holder = address === null ? null : holderOf(address);
              return holder !== null && holder !== id;
            });
            const restored = known.filter((id) => !addressHeld.includes(id));
            for (const id of restored) {
              const item = held(id);
              land(id, { ...item.fields, deletedAt: null }, item.blocks);
            }
            return {
              addressHeld,
              missing: input.ids.filter((id) => !known.includes(id)),
              restored,
            };
          }),
        ),
        save: os.library.items.save.handler(({ input }) =>
          once(input.opId, z.object({ created: z.boolean() }).and(landedSchema), () => {
            needsBlobs(input.coverSha === null ? [] : [input.coverSha]);
            const holder = holderOf(input.url);
            if (holder !== null) {
              return answerHeld(holder);
            }
            made(input.id);
            return {
              created: true,
              ...land(
                input.id,
                pageFields(input, NOW),
                new Map([
                  ...input.article.map((block): [string, StoredBlock] => [
                    block.block.id,
                    placed(block.block, block.ord, "article"),
                  ]),
                  ...noteBlocks(input.id, input.note),
                ]),
              ),
            };
          }),
        ),
        saveLink: os.library.items.saveLink.handler(({ input }) =>
          once(input.opId, z.object({ created: z.boolean() }).and(landedSchema), () => {
            const holder = holderOf(input.url);
            if (holder !== null) {
              return answerHeld(holder);
            }
            const folderId =
              input.folder !== undefined && input.folder !== null && "id" in input.folder
                ? input.folder.id
                : null;
            const id = input.id ?? "01900000-0000-7000-8000-cell00000000";
            made(id);
            return {
              created: true,
              ...land(
                id,
                stubFields({
                  folderId,
                  savedAt: input.savedAt ?? NOW,
                  tags: input.tags ?? [],
                  title: input.title,
                  url: input.url,
                }),
                new Map(noteBlocks(id, input.note)),
              ),
            };
          }),
        ),
      },
      write: os.library.write.handler(({ input }) =>
        once(input.opId, landedSchema, () => write(input)),
      ),
    },
  };

  const handler = new RPCHandler(router, {
    // the Worker refuses a revoked credential before any procedure, in the procedure's protocol
    clientInterceptors: [
      async (options) => {
        if (signedOut) {
          throw new UnauthorizedError();
        }
        return await options.next();
      },
    ],
    errorStatusMap: V1_ERROR_STATUS_MAP,
  });

  const upload = async (request: Request, sha: string): Promise<Response> => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (fileSha(bytes) !== sha) {
      return new Response(null, { status: 400 });
    }
    uploads.push(sha);
    blobs.set(sha, { bytes, mime: request.headers.get("content-type") ?? UNKNOWN_FILE_TYPE });
    return new Response(null, { status: 201 });
  };

  const download = (sha: string): Response => {
    const file = blobs.get(sha);
    return file === undefined
      ? new Response(null, { status: 404 })
      : new Response(file.bytes, { headers: { "content-type": file.mime } });
  };

  const serve = async (name: string, request: Request): Promise<Response> => {
    const path = request.url.slice(ORIGIN.length);
    if (path.startsWith(`${V1_BLOBS_PATH}/`)) {
      const sha = path.slice(V1_BLOBS_PATH.length + 1);
      return request.method === "PUT" ? await upload(request, sha) : download(sha);
    }
    calls.push(`${name} ${path.slice(V1_RPC_PATH.length + 1)}`);
    const { matched, response } = await handler.handle(request, { prefix: V1_RPC_PATH });
    return matched ? response : new Response(null, { status: 404 });
  };

  return {
    calls,
    device: (name) => {
      let offline = false;
      let lose = 0;
      const transport: V1Transport = {
        fetch: async (request) => {
          if (offline) {
            throw new TypeError("the network is down");
          }
          const response = await serve(name, request);
          if (lose > 0) {
            lose -= 1;
            await response.arrayBuffer();
            throw new TypeError("the answer was lost");
          }
          return response;
        },
        origin: ORIGIN,
      };
      return {
        client: createORPCClient<V1Client>(
          new RPCLink({
            fetch: async (url, init) => await transport.fetch(new Request(url, init)),
            origin: ORIGIN,
            url: V1_RPC_PATH,
          }),
        ),
        loseAnswers: (count) => {
          lose = count;
        },
        setOffline: (next) => {
          offline = next;
        },
        transport,
      };
    },
    item: (id) => items.get(id) ?? null,
    items: () => items,
    signOut: () => {
      signedOut = true;
    },
    uploads,
  };
};
