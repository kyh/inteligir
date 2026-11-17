// An import's own thread, a module worker the page starts for one file (`./import-run`): it reads
// the file and lands it in the library over `/v1` under the session cookie, as the page does, so a
// large zip never holds the page. Closing the tab ends it, and choosing the file again carries on,
// since what landed answers as held.

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

// the thread's policy refuses eval, as the page's does (`src/instrumentation-client.ts`)
z.config({ jitless: true });

// zip.js would start codec workers of its own from a script the build does not ship; this thread
// is already off the page
configure({ useWebWorkers: false });

// a worker's message has no target origin: it goes to the page that started it
const tell = (news: ImportNews): void => {
  self.postMessage(news, { transfer: [] });
};

const sessionEnded = (end: SessionEnd): void => {
  tell({ end, kind: "session-ended" });
};

const cellOver = (client: V1Client, transport: V1Transport): ImportCell => ({
  keep: async (bytes, mime) => {
    const sha = fileSha(bytes);
    try {
      await uploadBlob(transport, { bytes, mime, sha }, sessionEnded);
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
});

// one file a thread: the page starts another for the next
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
    // it tells its own end, a failure included, so nothing waits on it
    void readImport(ask.data, cellOver(v1Client(transport, sessionEnded), transport), tell);
  },
  { once: true },
);
