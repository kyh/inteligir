import type { QueryClient } from "@tanstack/react-query";
import { readNote, saveNote } from "@repo/client/note-bodies";
import { base64FromBytes, bytesFromBase64 } from "@repo/contract/bytes";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import type { PhoneLibrary } from "../lib/compose-runtime";
import type { LibraryActions } from "./page/library-actions";

export interface NoteActionsArgs {
  readonly itemId: string;
  readonly library: Pick<PhoneLibrary, "client" | "files" | "newId" | "queries" | "saves">;
  readonly queryClient: QueryClient;
  readonly openItem: (itemId: string) => void;
}

const orNone = async <T>(read: Promise<T>) => {
  try {
    return await read;
  } catch (error) {
    if (isOrpcError(error) && error.defined && error.code === "NOT_FOUND") {
      return null;
    }

    throw error;
  }
};

export const noteActions = ({ itemId, library, openItem, queryClient }: NoteActionsArgs) => {
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

      if (kept.kind !== "landed") {
        throw new Error(
          kept.kind === "refused" ? kept.message : `the file was not sent: ${kept.kind}`,
        );
      }

      return { sha: kept.answer };
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
    noteStanding: async (id) => {
      const row = await orNone(client.library.items.row({ id }));

      return row === null
        ? null
        : { deleted: row.fields.deletedAt !== null, version: row.bodyVersion };
    },
    openItem,
    readFile: async (sha) => {
      const file = await files.heldFile(sha);

      return file === null ? null : { base64: base64FromBytes(file.bytes), mediaType: file.mime };
    },
    readItem: async (id) => {
      const note = await readNote(queries, queryClient, id);

      return note?.blocks.map(({ block }) => block) ?? null;
    },
    readNote: async (id) => await readNote(queries, queryClient, id),
    saveNote: async (save) => await saveNote(client, save),
  } satisfies LibraryActions;
};
