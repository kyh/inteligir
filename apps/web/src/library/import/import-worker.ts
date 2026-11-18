import { sharedFailure, uploadBlob, v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { fileSha } from "@repo/contract/library/file-sha";
import { isOrpcError, QuotaError } from "@repo/contract/rpc/v1-errors";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { configure } from "@zip.js/zip.js/lib/zip-core-native.js";
import { z } from "zod";

import { ImportStoppedError, LIBRARY_FULL } from "./import-landing";
import type { ImportCell } from "./import-landing";
import { importAskSchema } from "./import-news";
import type { ImportNews } from "./import-news";
import { readImport } from "./import-reading";

z.config({ jitless: true });

configure({ useWebWorkers: false });

const tell = (news: ImportNews) => {
  self.postMessage(news, { transfer: [] });
};

const sessionEnded = (end: SessionEnd) => {
  tell({ end, kind: "session-ended" });
};

const cellOver = (client: V1Client, transport: V1Transport) =>
  ({
    keep: async (bytes, mime) => {
      const sha = fileSha(bytes);

      try {
        await uploadBlob(transport, { bytes, mime, sha }, sessionEnded);
      } catch (error) {
        if (isOrpcError(error) && error.code === QuotaError.code) {
          throw new ImportStoppedError(LIBRARY_FULL);
        }

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
  }) satisfies ImportCell;

self.addEventListener(
  "message",
  (event) => {
    const ask = importAskSchema.safeParse(event.data);

    if (!ask.success) {
      return;
    }

    const transport: V1Transport = {
      fetch: async (request) => await fetch(request),
      origin: self.location.origin,
    };

    void readImport(ask.data, cellOver(v1Client(transport, sessionEnded), transport), tell);
  },
  { once: true },
);
