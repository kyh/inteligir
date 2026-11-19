import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { configure } from "@zip.js/zip.js/lib/zip-core-native.js";
import { z } from "zod";

import { exportCellOver } from "./export-cell";
import { exportAskSchema } from "./export-news";
import type { ExportNews } from "./export-news";
import { exportLibrary } from "./export-writing";

z.config({ jitless: true });

configure({ useWebWorkers: false });

const tell = (news: ExportNews) => {
  self.postMessage(news, { transfer: [] });
};

const sessionEnded = (end: SessionEnd) => {
  tell({ end, kind: "session-ended" });
};

self.addEventListener(
  "message",
  (event) => {
    const ask = exportAskSchema.parse(event.data);

    const transport: V1Transport = {
      fetch: async (request) => await fetch(request),
      origin: self.location.origin,
    };

    void exportLibrary(ask, exportCellOver(transport, sessionEnded), tell);
  },
  { once: true },
);
