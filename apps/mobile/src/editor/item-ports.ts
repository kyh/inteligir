// What an item's page asks the phone, answered from its replica: the item as it reads now, with
// this phone's unsent writes laid over; a pause's ops, queued in the outbox under the bases the page
// computed them from (a base that moved answers the item as it is, for the page's own merge); the
// items a link can name; and a highlight's bare entry and its note, beside the markers the item's
// next write carries, as the library's page writes them. Pure: the screen binds it to the open
// item's replica, and the suite drives it over a real one.

import type { RequestPayload, RequestResult } from "@repo/editor-bridge/protocol";
import type { LibraryReplica, ReplicaItem } from "@repo/library-replica/library-replica";
import type { EditorRequestPorts } from "./editor-host";

type HeldItem = Exclude<RequestResult<"item">["item"], null>;

const heldOf = (item: ReplicaItem): HeldItem => ({
  blocks: item.blocks.map(({ block, hash, ord, section }) => ({ block, hash, ord, section })),
  bodyHeld: item.bodyHeld,
  fields: item.fields,
});

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

const writeItem = async (
  replica: LibraryReplica,
  { files, itemId, ops }: RequestPayload<"writeItem">,
): Promise<RequestResult<"writeItem">> => {
  const outcome = await replica.write(itemId, {
    files: files.map(({ base64, mediaType }) => ({ bytes: bytesOf(base64), mime: mediaType })),
    ops,
  });
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

// an item a link can name, by its id and by its title, under a path of its own so two items of
// one title are two targets
const targetOf = (row: { readonly id: string; readonly title: string }) => ({
  id: row.id,
  path: `${row.title.replaceAll("/", " ")}.md`,
  title: row.title,
  type: "doc" as const,
});

export const createItemPorts = (args: {
  readonly replica: LibraryReplica;
  readonly now: () => number;
}): EditorRequestPorts => {
  const { replica } = args;
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
    item: async ({ itemId }) => {
      const item = await replica.item(itemId);
      return { item: item === null ? null : heldOf(item) };
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
    wikiTargets: async () => {
      const page = replica.listing({
        deleted: false,
        limit: Math.max(1, replica.scopes().total),
        offset: 0,
        sort: "title",
      });
      return await Promise.resolve({ targets: page.items.map(targetOf) });
    },
    writeItem: async (payload) => await writeItem(replica, payload),
  };
};
