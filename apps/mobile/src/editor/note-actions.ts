// What the note page asks the phone, answered from the account's library: the socket's ticket; an
// item as the cloud holds it, or as this phone last read it while there is no connection; the items
// a link can name; a file a note names, from the cache, which fetches it the first time; a file
// pasted into the note, sent up and kept as it went; a note the editor makes, in the open item's
// folder; and the item a link opens, on the native stack. Every argument and answer is JSON and
// bytes are base64, since only that crosses into the page, where a refusal arrives as an Error
// carrying its message. Expo-free, so a node suite drives it over a fake cell.

import type { QueryClient } from "@tanstack/react-query";
import { base64FromBytes, bytesFromBase64 } from "@repo/contract/bytes";
import type { V1Client } from "@repo/contract/v1";
import { isOrpcError } from "@repo/contract/v1/errors";
import type { PhoneLibrary } from "../lib/compose-runtime";
import type { LibraryActions } from "./page/library-actions";

type ItemAnswer = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

export interface NoteActionsArgs {
  // the item the page shows, whose folder a note it makes lands in
  readonly itemId: string;
  readonly library: Pick<PhoneLibrary, "client" | "files" | "newId" | "queries" | "saves">;
  readonly queryClient: QueryClient;
  readonly openItem: (itemId: string) => void;
}

// a read the cell answers NOT_FOUND for is no item, and any other refusal is the read's failure
const orNone = async <T>(read: Promise<T>): Promise<T | null> => {
  try {
    return await read;
  } catch (error) {
    if (isOrpcError(error) && error.defined && error.code === "NOT_FOUND") {
      return null;
    }
    throw error;
  }
};

const blocksOf = (item: ItemAnswer) => item.blocks.map(({ block }) => block);

export const noteActions = ({
  itemId,
  library,
  openItem,
  queryClient,
}: NoteActionsArgs): LibraryActions => {
  const { client, files, newId, queries, saves } = library;
  return {
    createNote: async ({ blocks, title }) => {
      const beside = await orNone(client.library.items.row({ id: itemId }));
      const { item } = await client.library.items.create({
        blocks: blocks.map((block) => ({ block, section: "note" })),
        folderId: beside?.fields.folderId ?? null,
        id: newId(),
        opId: newId(),
        savedAt: Date.now(),
        tags: [],
        title,
      });
      return item.id;
    },
    keepFile: async ({ base64, mediaType }) => {
      const kept = await saves.keepFile({ bytes: bytesFromBase64(base64), mime: mediaType });
      if (kept.kind !== "kept") {
        throw new Error(
          kept.kind === "refused" ? kept.message : `the file was not sent: ${kept.kind}`,
        );
      }
      return { sha: kept.sha };
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
      return answer.targets.map(({ id, title }) => ({ id, title }));
    },
    openItem,
    // drawn as the type it was kept or served as, so a recording plays as one
    readFile: async (sha) => {
      const file = await files.heldFile(sha);
      return file === null ? null : { base64: base64FromBytes(file.bytes), mediaType: file.mime };
    },
    readItem: async (id) => {
      const options = queries.library.items.get.queryOptions({ input: { id } });
      try {
        const item = await orNone(
          queryClient.query({
            ...options,
            networkMode: "offlineFirst",
            retry: false,
            staleTime: 0,
          }),
        );
        return item === null ? null : blocksOf(item);
      } catch (error) {
        const held = queryClient.getQueryData(options.queryKey);
        if (held === undefined) {
          throw error;
        }
        return blocksOf(held);
      }
    },
    socketTicket: async () => {
      const { ticket } = await client.account.socketTicket();
      return ticket;
    },
  };
};
