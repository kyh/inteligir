// What an item's page asks the phone, answered from the account's library: the item as the cloud
// holds it now, or as this phone last read it while there is no connection; a pause's ops, written
// under the bases the page computed them from (a base that moved answers the item as it is now, for
// the page's own merge); the items a link can name; a file a note names, from the cache, which
// fetches it the first time, and one the page keeps, sent up by its sha before the write naming it;
// and a note the editor makes, in the folder of the item it was made from. A write that met no
// connection throws, so the page keeps the edit and says so. Pure: the screen binds it to the
// sign-in's library, and the suite drives it over a fake cell.

import type { QueryClient } from "@tanstack/react-query";
import { base64FromBytes, bytesFromBase64 } from "@repo/contract/cloud/bytes";
import type { V1Client } from "@repo/contract/cloud/v1";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";
import type { RequestPayload, RequestResult } from "@repo/editor-bridge/protocol";
import type { PhoneLibrary } from "../lib/compose-runtime";
import type { EditorRequestPorts } from "./editor-host";

type HeldItem = Exclude<RequestResult<"item">["item"], null>;

type ItemAnswer = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

type LinkTarget = Awaited<ReturnType<V1Client["library"]["listing"]["titles"]>>["targets"][number];

const heldOf = (item: ItemAnswer): HeldItem => ({
  blocks: item.blocks.map(({ block, hash, ord, section }) => ({ block, hash, ord, section })),
  bodyHeld: true,
  fields: item.fields,
});

const refusedAs = (cause: unknown, code: string): boolean =>
  isOrpcError(cause) && cause.defined && cause.code === code;

// the items whose name moved between two answers of every title, but `itemId`, which the page
// reads again by its own sequence
export const renamedTargets = (
  before: readonly LinkTarget[],
  now: readonly LinkTarget[],
  itemId: string,
): string[] => {
  const was = new Map(before.map(({ id, title }) => [id, title]));
  const is = new Map(now.map(({ id, title }) => [id, title]));
  return [...new Set([...was.keys(), ...is.keys()])].filter(
    (id) => id !== itemId && was.get(id) !== is.get(id),
  );
};

export interface ItemPortsArgs {
  readonly library: Pick<PhoneLibrary, "client" | "files" | "newId" | "queries" | "saves">;
  readonly queryClient: QueryClient;
  // a write of this page's landed, the item at the sequence it now holds
  readonly wrote: (itemId: string, seq: number) => void;
}

export const createItemPorts = ({
  library,
  queryClient,
  wrote,
}: ItemPortsArgs): EditorRequestPorts => {
  const { client, files, queries, saves } = library;

  // the cloud's answer, or with no connection the one this phone last read; null for an item the
  // cloud holds none of
  const itemNow = async (itemId: string): Promise<ItemAnswer | null> => {
    const options = queries.library.items.get.queryOptions({ input: { id: itemId } });
    try {
      return await queryClient.query({
        ...options,
        networkMode: "offlineFirst",
        retry: false,
        staleTime: 0,
      });
    } catch (error) {
      if (refusedAs(error, "NOT_FOUND")) {
        return null;
      }
      const held = queryClient.getQueryData(options.queryKey);
      if (held === undefined) {
        throw error;
      }
      return held;
    }
  };

  const writeItem = async ({
    itemId,
    ops,
  }: RequestPayload<"writeItem">): Promise<RequestResult<"writeItem">> => {
    if (ops.length === 0) {
      return { kind: "unchanged" };
    }
    try {
      const { item } = await client.library.write({ itemId, opId: library.newId(), ops });
      wrote(itemId, item.seq);
      return { kind: "queued" };
    } catch (error) {
      if (refusedAs(error, "NOT_FOUND")) {
        return { kind: "missing" };
      }
      if (!refusedAs(error, "CONFLICT")) {
        throw error;
      }
      const item = await itemNow(itemId);
      return item === null ? { kind: "missing" } : { item: heldOf(item), kind: "changed" };
    }
  };

  return {
    createNote: async ({ besideId, blocks, title }) => {
      const beside = await itemNow(besideId);
      const ids = saves.stamp();
      const { item } = await client.library.items.create({
        blocks: blocks.map(({ block, ord }) => ({ block, ord, section: "note" })),
        folderId: beside?.fields.folderId ?? null,
        id: ids.id,
        opId: ids.opId,
        savedAt: ids.savedAt,
        tags: [],
        title,
      });
      return { id: item.id };
    },
    item: async ({ itemId }) => {
      const item = await itemNow(itemId);
      return { item: item === null ? null : heldOf(item) };
    },
    keepFile: async ({ base64, mediaType }) => {
      const kept = await saves.keepFile({ bytes: bytesFromBase64(base64), mime: mediaType });
      switch (kept.kind) {
        case "kept": {
          return { sha: kept.sha };
        }
        case "refused": {
          throw new Error(kept.message);
        }
        case "unreachable":
        case "ended": {
          throw new Error("Needs a connection");
        }
        // no default
      }
    },
    linkTargets: async () => {
      const options = queries.library.listing.titles.queryOptions();
      let answer = queryClient.getQueryData(options.queryKey);
      try {
        answer = await queryClient.query({ ...options, networkMode: "offlineFirst", retry: false });
      } catch (error) {
        if (answer === undefined) {
          throw error;
        }
      }
      return { targets: answer.targets.toSorted((a, b) => a.title.localeCompare(b.title)) };
    },
    // drawn as the type it was kept or served as, so a recording plays as one
    readFile: async ({ sha }) => {
      const file = await files.heldFile(sha);
      return {
        file: file === null ? null : { base64: base64FromBytes(file.bytes), mediaType: file.mime },
      };
    },
    writeItem,
  };
};
