import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { configure } from "@zip.js/zip.js/lib/zip-core-native.js";
import { z } from "zod";

import { importCellOver } from "./import-cell";
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

    void readImport(ask.data, importCellOver(transport, sessionEnded), tell);
  },
  { once: true },
);
