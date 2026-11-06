// What an item's page asks the phone, answered from its replica and its file cache: the item as it
// reads now, with this phone's unsent writes laid over; a pause's ops, queued in the outbox under
// the bases the page computed them from (a base that moved answers the item as it is, for the
// page's own merge); the items a link can name; a file a note names, from the cache, which fetches
// it the first time, and one the page keeps, in the outbox, which sends it up ahead of the write
// naming it; a highlight's bare entry and its note, beside the markers the item's next write
// carries; and a note the editor makes, in the folder of the item it was made from, as the
// library's page writes them all. Pure: the screen binds it to the open item's replica, and the
// suite drives it over a real one.

import type { RequestPayload, RequestResult } from "@repo/editor-bridge/protocol";
import type { LibraryReplica, ReplicaItem } from "@repo/library-replica/library-replica";
import { sniffMedia } from "@repo/notes/items/sniff-media";
import type { FileCache } from "../files/file-cache";
import type { EditorRequestPorts } from "./editor-host";

type HeldItem = Exclude<RequestResult<"item">["item"], null>;

const heldOf = (item: ReplicaItem): HeldItem => ({
  blocks: item.blocks.map(({ block, hash, ord, section }) => ({ block, hash, ord, section })),
  bodyHeld: item.bodyHeld,
  fields: item.fields,
});

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

const base64Of = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const writeItem = async (
  replica: LibraryReplica,
  { itemId, ops }: RequestPayload<"writeItem">,
): Promise<RequestResult<"writeItem">> => {
  const outcome = await replica.write(itemId, { ops });
  switch (outcome.kind) {
    case "queued":
    case "unchanged":
    case "missing": {
      return { kind: outcome.kind };
    }
    case "changed": {
      return { item: heldOf(outcome.item), kind: "changed" };
    }
    case "invalid": {
      return { fields: [...outcome.fields], kind: "invalid" };
    }
    // no default
  }
};

const queued = (kind: string): boolean => kind === "queued" || kind === "unchanged";

export const createItemPorts = (args: {
  readonly replica: LibraryReplica;
  readonly files: Pick<FileCache, "fileBytes">;
  readonly now: () => number;
}): EditorRequestPorts => {
  const { files, replica } = args;
  return {
    addHighlight: async ({ id, itemId, quote }) => {
      const outcome = await replica.write(itemId, {
        annotations: [
          {
            createdAt: Math.floor(args.now() / 1000),
            id,
            occurrence: null,
            op: "add",
            parentId: null,
            quote,
            text: "",
          },
        ],
        ops: [],
      });
      return { queued: queued(outcome.kind) };
    },
    createNote: async ({ besideId, blocks, title }) => {
      const made = await replica.createNote({
        blocks: blocks.map(({ block, ord }) => ({ block, ord, section: "note" })),
        folderId: replica.row(besideId)?.fields.folderId ?? null,
        tags: [],
        title,
      });
      return { id: made.id };
    },
    item: async ({ itemId }) => {
      const item = await replica.item(itemId);
      return { item: item === null ? null : heldOf(item) };
    },
    keepFile: async ({ base64, mediaType }) =>
      await replica.keepFile({ bytes: bytesOf(base64), mime: mediaType }),
    linkTargets: async () => {
      const page = replica.listing({
        deleted: false,
        limit: Math.max(1, replica.scopes().total),
        offset: 0,
        sort: "title",
      });
      return await Promise.resolve({ targets: page.items.map(({ id, title }) => ({ id, title })) });
    },
    noteHighlight: async ({ id, itemId, text }) => {
      const store = await replica.annotations(itemId);
      const held = store[id];
      if (held === undefined) {
        return { queued: false };
      }
      const outcome = await replica.write(itemId, {
        annotations: [{ base: held.text, id, op: "note", text }],
        ops: [],
      });
      return { queued: queued(outcome.kind) };
    },
    // the type the file is drawn as is read from its bytes, which the cache keeps without one
    readFile: async ({ sha }) => {
      const bytes = await files.fileBytes(sha);
      return {
        file:
          bytes === null
            ? null
            : {
                base64: base64Of(bytes),
                mediaType: sniffMedia(bytes)?.mediaType ?? "application/octet-stream",
              },
      };
    },
    writeItem: async (payload) => await writeItem(replica, payload),
  };
};
