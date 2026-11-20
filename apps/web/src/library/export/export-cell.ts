import { deferred } from "@repo/contract/deferred";
import type { ListingFolder } from "@repo/contract/library/folder-rail";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { LISTING_PAGE_MAX } from "@repo/contract/library/library-wire";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { isOrpcError, NotFoundError } from "@repo/contract/rpc/v1-errors";

interface ListedPage {
  readonly items: readonly { readonly id: string; readonly fields: LibraryItemFields }[];
  readonly cursor: number | null;
}

export interface WholeItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
}

export interface ExportCell {
  readonly folders: () => Promise<readonly ListingFolder[]>;
  readonly listed: (cursor: number) => Promise<ListedPage>;
  readonly item: (id: string) => Promise<WholeItem | null>;
  readonly file: (sha: string) => Promise<Blob | null>;
}

const FILE_TRIES = 5;
const BUSY_STATUS = 429;
const MISSING_STATUS = 404;

const waitOut = async (retryAfter: string | null) => {
  const seconds = Number(retryAfter);
  const waited = deferred();
  setTimeout(waited.resolve, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000);
  await waited.promise;
};

export const exportCellOver = (transport: V1Transport, onSessionEnd: (end: SessionEnd) => void) => {
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
        limit: LISTING_PAGE_MAX,
        scope: { kind: "all" },
        sort: "saved",
      }),
  } satisfies ExportCell;
};
