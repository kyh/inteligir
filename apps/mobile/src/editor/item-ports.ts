// What an item's page asks the phone, answered from the account's library: the item as the cloud
// holds it now, or as this phone last read it while there is no connection; the items a link can
// name; and a file a note names, from the cache, which fetches it the first time. The page takes no
// edit, so nothing here writes. Pure: the screen binds it to the sign-in's library, and the suite
// drives it over a fake cell.

import type { QueryClient } from "@tanstack/react-query";
import { base64FromBytes } from "@repo/contract/bytes";
import type { V1Client } from "@repo/contract/v1";
import { isOrpcError } from "@repo/contract/v1/errors";
import type { PhoneLibrary } from "../lib/compose-runtime";
import type { EditorRequestPorts } from "./editor-host";

type ItemAnswer = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

type LinkTarget = Awaited<ReturnType<V1Client["library"]["listing"]["titles"]>>["targets"][number];

// the items whose name moved between two answers of every title, but `itemId`, which the page
// reads again as its own query moves
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
  readonly library: Pick<PhoneLibrary, "files" | "queries">;
  readonly queryClient: QueryClient;
}

export const createItemPorts = ({ library, queryClient }: ItemPortsArgs): EditorRequestPorts => {
  const { files, queries } = library;

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
      if (isOrpcError(error) && error.defined && error.code === "NOT_FOUND") {
        return null;
      }
      const held = queryClient.getQueryData(options.queryKey);
      if (held === undefined) {
        throw error;
      }
      return held;
    }
  };

  return {
    item: async ({ itemId }) => {
      const item = await itemNow(itemId);
      return { item: item === null ? null : { blocks: item.blocks, fields: item.fields } };
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
  };
};
