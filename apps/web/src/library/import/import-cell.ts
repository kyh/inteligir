// The library as an import's thread reaches it (`./import-worker`): `/v1` over the thread's
// transport, under the session cookie, each file kept by its sha through the store. A full library
// stops the import in the person's words, a file refused alone is left out, and a busy answer is
// the link's to wait out (`@repo/contract/rpc/call-outcome`), so a long import goes on past the
// session's minute.

import { sharedFailure, uploadBlob, v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { fileSha } from "@repo/contract/library/file-sha";
import { isOrpcError, QuotaError } from "@repo/contract/rpc/v1-errors";

import { ImportStoppedError, LIBRARY_FULL } from "./import-landing";
import type { ImportCell } from "./import-landing";

export const importCellOver = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
): ImportCell => {
  const client = v1Client(transport, onSessionEnd);
  return {
    keep: async (bytes, mime) => {
      const sha = fileSha(bytes);
      try {
        await uploadBlob(transport, { bytes, mime, sha }, onSessionEnd);
      } catch (error) {
        if (isOrpcError(error) && error.code === QuotaError.code) {
          throw new ImportStoppedError(LIBRARY_FULL);
        }
        // a refusal of this file alone leaves it out, and the import goes on
        if (error instanceof Error && sharedFailure(error) === null) {
          return null;
        }
        throw error;
      }
      return sha;
    },
    land: async (items) => {
      try {
        return await client.library.imports.land({ items: [...items] });
      } catch (error) {
        if (isOrpcError(error) && error.code === QuotaError.code) {
          throw new ImportStoppedError(LIBRARY_FULL);
        }
        throw error;
      }
    },
    named: async (shas) => await client.library.imports.named({ shas: [...shas] }),
    settle: async (notes) => {
      const settled = await client.library.imports.settle({ notes: [...notes] });
      return settled.notes;
    },
  };
};
