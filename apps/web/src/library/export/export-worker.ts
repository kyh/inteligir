// An export's own thread, a module worker the page starts for one zip (`./export-run`): it reads
// the library over `/v1` under the session cookie, as the page does, and writes the zip, so writing
// every item never holds the page. Closing the tab or Stop ends it, leaving no zip.

import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { configure } from "@zip.js/zip.js/lib/zip-core-native.js";
import { z } from "zod";

import { exportCellOver } from "./export-cell";
import { exportAskSchema } from "./export-news";
import type { ExportNews } from "./export-news";
import { exportLibrary } from "./export-writing";

// the thread's policy refuses eval, as the page's does (`src/instrumentation-client.ts`)
z.config({ jitless: true });

// zip.js would start codec workers of its own from a script the build does not ship; this thread
// is already off the page
configure({ useWebWorkers: false });

// a worker's message has no target origin: it goes to the page that started it
const tell = (news: ExportNews): void => {
  self.postMessage(news, { transfer: [] });
};

const sessionEnded = (end: SessionEnd): void => {
  tell({ end, kind: "session-ended" });
};

// one zip a thread: the page starts another for the next
self.addEventListener(
  "message",
  (event) => {
    // an ask the page could not have sent ends the thread, which the page hears as broken
    const ask = exportAskSchema.parse(event.data);
    const transport: V1Transport = {
      fetch: async (request) => await fetch(request),
      origin: self.location.origin,
    };
    // it tells its own end, a failure included, so nothing waits on it
    void exportLibrary(ask, exportCellOver(transport, sessionEnded), tell);
  },
  { once: true },
);
