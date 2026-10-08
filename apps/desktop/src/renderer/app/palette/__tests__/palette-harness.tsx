// The palette reads its pages through the one oRPC client, so a test answers the wire rather
// than injecting a source, and each render gets a QueryClient of its own built with the shipped
// defaults, retries included: a cache the bus never sweeps stays stale here as it does there, and
// a refusal lands only as fast as the query's own retry policy lets it.

import type { ListThreadsResponse } from "@repo/contract/local/threads/threads-schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { z } from "zod";
import { CommandPalette } from "../command-palette";
import type { CommandPaletteProps, PaletteActions, PaletteRequest } from "../command-palette";
import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";

export interface PaletteFakes {
  // unset, the server finds no action
  threads?: (request: ThreadSearchRequest) => ListThreadsResponse;
}

const threadSearchRequestSchema = z.object({ limit: z.number(), query: z.string() });
type ThreadSearchRequest = z.infer<typeof threadSearchRequestSchema>;

// every procedure the palette's pages call; anything else is a 404 the query reports as an error
export const stubPaletteFetch = ({ threads }: PaletteFakes): void => {
  stubRpc({
    "threads/list": (input) => {
      const request = threadSearchRequestSchema.parse(input);
      return threads === undefined ? { nextCursor: null, threads: [] } : threads(request);
    },
  });
};

export const defaultRequest: PaletteRequest = { nonce: 1, page: "root" };

// Every verb the palette can run, each a mock typed by the contract it stands for. A test spreads
// its own over the ones it asserts on.
export const makeActions = () =>
  ({
    askAgent: vi.fn<PaletteActions["askAgent"]>(),
    openSettings: vi.fn<PaletteActions["openSettings"]>(),
    openThread: vi.fn<PaletteActions["openThread"]>(),
    syncNow: vi.fn<PaletteActions["syncNow"]>(),
  }) satisfies PaletteActions;

// keyed like the workspace keys it, so a rerender with a new nonce is a fresh open
const palette = (props: CommandPaletteProps) => (
  <CommandPalette key={props.request.nonce} {...props} />
);

export const renderWithQueries = (props: CommandPaletteProps) => {
  const queryClient = createWorkspaceQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(palette(props), { wrapper });
  return {
    queryClient,
    rerender: (next: CommandPaletteProps): void => {
      view.rerender(palette(next));
    },
  };
};
