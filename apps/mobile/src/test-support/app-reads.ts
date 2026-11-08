// The contract's fake cell serves the rows a replica calls; the phone also reads an item whole and
// every title, which this answers from the fake cell's own items as the Worker's cell answers
// them, each other call going on to the fake cell over the device's own transport.

import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { V1Transport } from "@repo/contract/cloud/library/call-outcome";
import { v1Contract, V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { NotFoundError, V1_ERROR_STATUS_MAP } from "@repo/contract/cloud/v1/errors";
import type { FakeCell, FakeDevice } from "@repo/contract/test-support/fake-cell";
import { orderedBlocks } from "@repo/notes/library/block-ops";
import { deriveItem } from "@repo/notes/library/derive-item";

const os = implement(v1Contract);

const READS = new Set(["library/items/get", "library/listing/titles"]);

export interface AppReadsDevice {
  readonly transport: V1Transport;
  readonly setOffline: (offline: boolean) => void;
}

export const withAppReads = (cell: FakeCell, device: FakeDevice): AppReadsDevice => {
  let offline = false;
  const handler = new RPCHandler(
    {
      library: {
        items: {
          get: os.library.items.get.handler(({ input }) => {
            const item = cell.item(input.id);
            if (item === null) {
              throw new NotFoundError();
            }
            const { card } = deriveItem(item.fields, item.blocks);
            return {
              blocks: orderedBlocks(item.blocks),
              card: { ...card, outline: [...card.outline] },
              fields: item.fields,
              id: input.id,
              kind: "live" as const,
              seq: item.seq,
              updatedAt: item.updatedAt,
            };
          }),
        },
        listing: {
          titles: os.library.listing.titles.handler(() => ({
            targets: [...cell.items()]
              .filter(([, item]) => item.fields.deletedAt === null)
              .map(([id, item]) => ({ id, title: item.fields.title })),
          })),
        },
      },
    },
    { errorStatusMap: V1_ERROR_STATUS_MAP },
  );
  return {
    setOffline: (next) => {
      offline = next;
      device.setOffline(next);
    },
    transport: {
      fetch: async (request) => {
        const path = new URL(request.url).pathname.slice(V1_RPC_PATH.length + 1);
        if (!READS.has(path)) {
          return await device.transport.fetch(request);
        }
        if (offline) {
          throw new TypeError("the network is down");
        }
        const { response } = await handler.handle(request, { prefix: V1_RPC_PATH });
        return response ?? new Response(null, { status: 404 });
      },
      origin: device.transport.origin,
    },
  };
};
