// The library as an export's thread reaches it (`./export-worker`): `/v1` over the thread's
// transport, under the session cookie, and each file whole from `/v1/blobs/<sha>`. A busy answer is
// waited out, the link's for a call (`@repo/contract/rpc/call-outcome`) and the cell's for a file,
// so a long export goes on past the session's minute.

import { deferred } from "@repo/contract/deferred";
import type { ListingFolder } from "@repo/contract/library/folder-rail";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { isOrpcError, NotFoundError } from "@repo/contract/rpc/v1-errors";

interface ListedPage {
  readonly items: readonly { readonly id: string; readonly fields: LibraryItemFields }[];
  // the next page's, null after the last
  readonly cursor: number | null;
}

export interface WholeItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
}

// the library as an export reads it; a call that cannot go on throws
export interface ExportCell {
  readonly folders: () => Promise<readonly ListingFolder[]>;
  // a page of every live item, from `cursor`
  readonly listed: (cursor: number) => Promise<ListedPage>;
  // an item whole, null once it is purged
  readonly item: (id: string) => Promise<WholeItem | null>;
  // a file's bytes, typed as they are kept, or null for one the library does not hold
  readonly file: (sha: string) => Promise<Blob | null>;
}

// the most items one page of the listing carries
const LISTING_PAGE = 1000;

// a file read asked again this many times while the cloud says it is busy, then given up on
const FILE_TRIES = 5;
const BUSY_STATUS = 429;
const MISSING_STATUS = 404;

const waitOut = async (retryAfter: string | null): Promise<void> => {
  const seconds = Number(retryAfter);
  const waited = deferred();
  setTimeout(waited.resolve, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000);
  await waited.promise;
};

export const exportCellOver = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
): ExportCell => {
  const { library } = v1Client(transport, onSessionEnd);
  return {
    file: async (sha) => {
      for (let tries = 1; tries <= FILE_TRIES; tries += 1) {
        const response = await transport.fetch(
          new Request(`${transport.origin}${V1_BLOBS_PATH}/${sha}`),
        );
        if (response.ok) {
          return await response.blob();
        }
        await response.body?.cancel();
        if (response.status === MISSING_STATUS) {
          return null;
        }
        if (response.status !== BUSY_STATUS) {
          throw new Error(`the file answered ${String(response.status)}`);
        }
        await waitOut(response.headers.get("retry-after"));
      }
      throw new Error("the library stayed busy");
    },
    folders: async () => {
      const { folders } = await library.listing.scopes();
      return folders;
    },
    item: async (id) => {
      try {
        return await library.items.get({ id });
      } catch (error) {
        if (isOrpcError(error) && error.code === NotFoundError.code) {
          return null;
        }
        throw error;
      }
    },
    listed: async (cursor) =>
      await library.listing.page({
        cursor,
        limit: LISTING_PAGE,
        scope: { kind: "all" },
        sort: "saved",
      }),
  };
};
