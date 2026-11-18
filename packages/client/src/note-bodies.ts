// A note's body read and saved whole, as the tab and the phone each hand it the editor: read from
// the cloud, or as this device last read it while the cloud can't be reached, and saved over the
// version it was read at, an item gone answering as missing and a file the library doesn't hold as
// file-missing.

import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { BlobMissingError, isOrpcError, NotFoundError } from "@repo/contract/rpc/v1-errors";
import type { QueryClient } from "@tanstack/query-core";

import type { V1Queries } from "./library-cache";

type ItemAnswer = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

// how long a leave waits for the open note to say it holds every edit made here: one that hasn't
// said by then counts as not holding, so a stalled save asks the person instead of holding the leave
export const HOLDS_ANSWER_MS = 5000;

const heldOf = (item: ItemAnswer): HeldNote => ({
  blocks: item.blocks,
  deleted: item.fields.deletedAt !== null,
  title: item.fields.title,
  version: item.bodyVersion,
});

// null for an item the library holds none of; rejects when neither the cloud nor this device's
// last read answers
export const readNote = async (
  { library }: V1Queries,
  queryClient: QueryClient,
  id: string,
): Promise<HeldNote | null> => {
  const options = library.items.get.queryOptions({ input: { id } });
  try {
    return heldOf(
      await queryClient.query({
        ...options,
        networkMode: "offlineFirst",
        retry: false,
        staleTime: 0,
      }),
    );
  } catch (error) {
    if (isOrpcError(error) && error.code === NotFoundError.code) {
      return null;
    }
    const held = queryClient.getQueryData(options.queryKey);
    if (held === undefined) {
      throw error;
    }
    return heldOf(held);
  }
};

// rejects when the network failed the save, which is tried again
export const saveNote = async (client: V1Client, save: NoteSave): Promise<NoteSaved> => {
  try {
    const saved = await client.library.items.saveBody({ ...save, blocks: [...save.blocks] });
    return saved.kind === "saved"
      ? { kind: "saved", version: saved.version }
      : { kind: saved.kind };
  } catch (error) {
    if (isOrpcError(error) && error.code === NotFoundError.code) {
      return { kind: "missing" };
    }
    if (isOrpcError(error) && error.code === BlobMissingError.code) {
      return { kind: "file-missing" };
    }
    throw error;
  }
};
