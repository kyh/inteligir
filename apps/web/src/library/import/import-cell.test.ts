// The import's cell over `/v1`, as its thread builds it: a session's spent minute that names its
// wait is waited out, and the import goes on to its end.

import { V1_RPC_PATH, v1Contract } from "@repo/contract/rpc/v1-contract";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import { TooManyRequestsError, V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { refusalResponse } from "@repo/contract/test-support/refusal-response";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";

import { importCellOver } from "./import-cell";
import type { ImportNews } from "./import-news";
import { readImport } from "./import-reading";

const ORIGIN = "http://localhost:5174";
const encoder = new TextEncoder();

// a library that holds every file, though no item names one, and lands every item, served by
// oRPC's own handler
const os = implement(v1Contract);
const handler = new RPCHandler(
  {
    library: {
      files: { reserve: os.library.files.reserve.handler(() => ({ kind: "held" as const })) },
      imports: {
        land: os.library.imports.land.handler(({ input }) => ({
          added: input.items.length,
          alreadySaved: 0,
          unreadable: 0,
        })),
        named: os.library.imports.named.handler(() => ({ named: [], originals: [] })),
        settle: os.library.imports.settle.handler(({ input }) => ({
          notes: input.notes.map((note) => ({ id: note.id, standing: "new" as const })),
        })),
      },
    },
  },
  { errorStatusMap: V1_ERROR_STATUS_MAP },
);

// every call's first try meets the session's minute spent, naming no wait to speak of
const busyFirst = () => {
  const asked: string[] = [];
  const transport: V1Transport = {
    fetch: async (request) => {
      asked.push(new URL(request.url).pathname);
      if (asked.length % 2 === 1) {
        const busy = refusalResponse(new TooManyRequestsError());
        busy.headers.set("retry-after", "0");
        return busy;
      }
      const { response } = await handler.handle(request, { prefix: V1_RPC_PATH });
      return response ?? new Response(null, { status: 404 });
    },
    origin: ORIGIN,
  };
  return { asked, transport };
};

const zipOf = async (entries: Readonly<Record<string, Uint8Array>>): Promise<Blob> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, bytes] of Object.entries(entries)) {
    await writer.add(path, new Uint8ArrayReader(bytes));
  }
  return await writer.close();
};

describe(importCellOver, () => {
  it("goes on past each busy answer that names its wait, to the import's end", async () => {
    const cloud = busyFirst();
    const news: ImportNews[] = [];
    const ended: SessionEnd[] = [];
    await readImport(
      {
        file: await zipOf({
          "Alpha.md": encoder.encode("# Alpha\n\n![[pic.png]]\n"),
          "Beta.md": encoder.encode("Beta.\n"),
          "pic.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
        }),
        source: "markdown",
      },
      importCellOver(cloud.transport, (end) => {
        ended.push(end);
      }),
      (heard) => {
        news.push(heard);
      },
    );

    expect(news.at(-1)).toStrictEqual({
      counts: { added: 3, alreadySaved: 0, unreadable: 0 },
      kind: "done",
    });
    expect(ended).toStrictEqual([]);
    expect(cloud.asked.map((path) => path.slice(V1_RPC_PATH.length + 1))).toStrictEqual([
      "library/imports/named",
      "library/imports/named",
      "library/files/reserve",
      "library/files/reserve",
      "library/imports/settle",
      "library/imports/settle",
      "library/imports/land",
      "library/imports/land",
      "library/imports/named",
      "library/imports/named",
      "library/imports/land",
      "library/imports/land",
    ]);
  });
});
