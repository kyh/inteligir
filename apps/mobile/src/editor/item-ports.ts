// What an item's page asks the phone, answered from its replica and its file cache: the item as it
// reads now, with this phone's unsent writes laid over; a pause's ops, queued in the outbox under
// the bases the page computed them from (a base that moved answers the item as it is, for the
// page's own merge); the items a link can name; a file a note names, from the cache, which fetches
// it the first time, and one the page keeps, in the outbox, which sends it up ahead of the write
// naming it; and a note the editor makes, in the folder of the item it was made from, as the
// library's page writes them all. Pure: the screen binds it to the open
// item's replica, and the suite drives it over a real one.

import { base64FromBytes, bytesFromBase64 } from "@repo/contract/cloud/bytes";
import type { RequestPayload, RequestResult } from "@repo/editor-bridge/protocol";
import type { LibraryReplica, ReplicaItem } from "@repo/library-replica/library-replica";
import type { FileCache } from "../files/file-cache";
import type { EditorRequestPorts } from "./editor-host";

type HeldItem = Exclude<RequestResult<"item">["item"], null>;

const heldOf = (item: ReplicaItem): HeldItem => ({
  blocks: item.blocks.map(({ block, hash, ord, section }) => ({ block, hash, ord, section })),
  bodyHeld: item.bodyHeld,
  fields: item.fields,
});

const writeItem = async (
  replica: LibraryReplica,
  { itemId, ops }: RequestPayload<"writeItem">,
): Promise<RequestResult<"writeItem">> => {
  const outcome = await replica.write(itemId, { ops });
  switch (outcome.kind) {
    case "queued":
    case "unchanged":
    case "missing":
    case "waiting": {
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

export const createItemPorts = (args: {
  readonly replica: LibraryReplica;
  readonly files: Pick<FileCache, "heldFile">;
}): EditorRequestPorts => {
  const { files, replica } = args;
  return {
    createNote: async ({ besideId, blocks, title }) => {
      const beside = await replica.item(besideId);
      const made = await replica.createNote({
        blocks: blocks.map(({ block, ord }) => ({ block, ord, section: "note" })),
        folderId: beside?.fields.folderId ?? null,
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
      await replica.keepFile({ bytes: bytesFromBase64(base64), mime: mediaType }),
    linkTargets: async () => {
      const page = replica.listing({
        deleted: false,
        limit: Math.max(1, replica.scopes().total),
        offset: 0,
        sort: "title",
      });
      return await Promise.resolve({ targets: page.items.map(({ id, title }) => ({ id, title })) });
    },
    // drawn as the type it was kept or served as, so a recording plays as one
    readFile: async ({ sha }) => {
      const file = await files.heldFile(sha);
      return {
        file: file === null ? null : { base64: base64FromBytes(file.bytes), mediaType: file.mime },
      };
    },
    writeItem: async (payload) => await writeItem(replica, payload),
  };
};
