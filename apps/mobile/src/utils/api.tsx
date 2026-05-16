import { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  loggerLink,
  splitLink,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "@repo/api";
import { getBaseUrl } from "./base-url";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
    },
  },
});

const url = `${getBaseUrl()}/api/trpc`;

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
      colorMode: "ansi",
    }),
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        transformer: superjson,
        url,
      }),
      false: httpBatchLink({
        transformer: superjson,
        url,
        headers() {
          return { "x-trpc-source": "expo-react" };
        },
      }),
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

export type { RouterInputs, RouterOutputs } from "@repo/api";
