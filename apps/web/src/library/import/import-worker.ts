// An import's own thread, a module worker the page starts for one file (`./import-run`): it reads
// the file and lands it in the library over `/v1` under the session cookie, as the page does, so a
// large zip never holds the page. Closing the tab ends it, and choosing the file again carries on,
// since what landed answers as held.

import { uploadBlob, v1Client } from "@repo/contract/library/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/library/call-outcome";
import { fileSha } from "@repo/contract/library/file-sha";
import { isOrpcError, QuotaError } from "@repo/contract/v1/errors";
import type { V1Client } from "@repo/contract/v1";
import { configure } from "@zip.js/zip.js/lib/zip-core-native.js";

import { newId } from "../library/new-id";
import { ImportStoppedError, LIBRARY_FULL } from "./import-landing";
import type { ImportCell } from "./import-landing";
import { importAskSchema } from "./import-news";
import type { ImportAsk, ImportNews } from "./import-news";
import { IMPORT_INTERRUPTED, readImport } from "./import-reading";

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

const cellOver = (client: V1Client, transport: V1Transport, ask: ImportAsk): ImportCell => {
  const importId = newId();
  return {
    keep: async (bytes, mime) => {
      const sha = fileSha(bytes);
      const outcome = await uploadBlob(transport, { bytes, mime, sha });
      switch (outcome.kind) {
        case "stored": {
          return sha;
        }
        case "refused": {
          if (outcome.code === QuotaError.code) {
            throw new ImportStoppedError(LIBRARY_FULL);
          }
          return null;
        }
        case "failed": {
          if (outcome.failure.kind === "session") {
            sessionEnded(outcome.failure.end);
          }
          throw new ImportStoppedError(IMPORT_INTERRUPTED);
        }
        // no default
      }
    },
    land: async (items) => {
      try {
        return await client.library.imports.land({
          importId,
          items: [...items],
          source: ask.source,
        });
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
    void readImport(
      ask.data,
      cellOver(v1Client(transport, sessionEnded), transport, ask.data),
      tell,
    );
  },
  { once: true },
);
