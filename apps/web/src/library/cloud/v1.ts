import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { retryUnlessRefused } from "@repo/client/library-cache";
import type { V1Queries } from "@repo/client/library-cache";
import { v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { QueryClient } from "@tanstack/react-query";

export interface CloudWire {
  readonly client: V1Client;
  readonly orpc: V1Queries;
  readonly outliving: V1Client;
}

export const createCloudWire = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
) => {
  const client = v1Client(transport, onSessionEnd);

  const outliving = v1Client(
    {
      fetch: async (request) => await transport.fetch(new Request(request, { keepalive: true })),
      origin: transport.origin,
    },
    onSessionEnd,
  );

  return { client, orpc: createTanstackQueryUtils(client), outliving } satisfies CloudWire;
};

export const createPageQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "online" },
      queries: {
        networkMode: "online",
        refetchOnWindowFocus: false,
        retry: retryUnlessRefused,
      },
    },
  }) satisfies QueryClient;
