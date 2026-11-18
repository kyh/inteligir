// An import's own thread, a module worker the page starts for one file (`./import-run`): it reads
// the file and lands it in the library over `/v1` under the session cookie, as the page does, so a
// large zip never holds the page. Closing the tab ends it, and choosing the file again carries on,
// since what landed answers as held.

import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { configure } from "@zip.js/zip.js/lib/zip-core-native.js";
import { z } from "zod";

import { importCellOver } from "./import-cell";
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
    void readImport(ask.data, importCellOver(transport, sessionEnded), tell);
  },
  { once: true },
);
